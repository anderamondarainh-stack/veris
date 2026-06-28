import type { ChatCompletionRequest, ChatMessage, ModelSpec, TaskKind } from "../types/index.js";
import { CATALOG, findModel } from "./catalog.js";
import { classify } from "./classify.js";
import { estimateTokens, fitsContext } from "./tokens.js";

export type RouterStrategy = "cheapest" | "best" | "balanced";

export interface RouteDecision {
  // Modelo elegido (el primero del ranking).
  model: ModelSpec;
  // Ranking completo: el gateway prueba en orden si hay fallback.
  ranked: ModelSpec[];
  task: TaskKind;
  promptTokens: number;
  needsVision: boolean;
  reason: string;
}

function blendedCost(m: ModelSpec): number {
  return m.input_per_mtok * 0.75 + m.output_per_mtok * 0.25;
}

// Capacidad "cruda" del modelo: proxy por su coste (más caro ≈ más capaz).
// En producción esto sería una métrica de calidad por benchmark, no el precio.
function capability(m: ModelSpec): number {
  return blendedCost(m);
}

// ¿El request trae imágenes? Soportamos content multimodal estilo OpenAI
// (array de partes) o data URLs embebidas en texto.
export function detectVision(messages: ChatMessage[]): boolean {
  return messages.some((m) => {
    const c: unknown = m.content;
    if (Array.isArray(c)) return c.some((p: any) => p?.type === "image_url" || p?.type === "image");
    return typeof c === "string" && /data:image\//.test(c);
  });
}

// Puntuación de un modelo para una tarea bajo una estrategia. Mayor = mejor.
function score(m: ModelSpec, task: TaskKind, strategy: RouterStrategy): number {
  const specialized = m.good_at.includes(task) ? 1 : 0;
  const cap = capability(m);
  const cheapness = 1 / (blendedCost(m) + 0.5);
  switch (strategy) {
    case "cheapest":
      return cheapness * 2 + specialized;
    case "best":
      return cap + specialized * 3;
    case "balanced":
    default:
      // Tareas duras priorizan capacidad; el resto, equilibrio coste/idoneidad.
      return task === "code" || task === "reasoning"
        ? cap + specialized * 2
        : cheapness + specialized * 2;
  }
}

export function route(
  req: ChatCompletionRequest,
  availableProviders: Set<string>,
  strategy: RouterStrategy,
  // Lista blanca opcional de ids de modelo permitidos (p. ej. de una virtual
  // key). Si se pasa, tanto el modelo explícito como el routing `auto` solo
  // pueden elegir de aquí. undefined = sin restricción.
  restrictModels?: Set<string>,
): RouteDecision {
  const promptTokens = estimateTokens(req.messages);
  const needsVision = detectVision(req.messages);

  // 1) Modelo explícito: respétalo si existe, hay provider, soporta visión si
  //    hace falta y le cabe el contexto. Si no cumple, caemos a auto.
  if (req.model && req.model !== "auto") {
    const explicit = findModel(req.model);
    if (
      explicit &&
      explicit.kind !== "embedding" && // no se enruta un modelo de embeddings a chat
      (!restrictModels || restrictModels.has(explicit.id)) &&
      availableProviders.has(explicit.provider) &&
      (!needsVision || explicit.vision) &&
      fitsContext(explicit, promptTokens, req.max_tokens ?? 1024)
    ) {
      return {
        model: explicit,
        ranked: [explicit],
        task: req.task_hint ?? "chat",
        promptTokens,
        needsVision,
        reason: "explicit",
      };
    }
  }

  // 2) Auto: clasifica y construye un ranking de candidatos viables.
  const task = req.task_hint ?? classify(req.messages);

  const reservedOutput = req.max_tokens ?? 1024;
  const viable = CATALOG.filter(
    (m) =>
      m.kind !== "embedding" && // los modelos de embeddings no sirven para chat
      (!restrictModels || restrictModels.has(m.id)) &&
      availableProviders.has(m.provider) &&
      fitsContext(m, promptTokens, reservedOutput) &&
      (!needsVision || m.vision),
  );

  // La especialización (good_at) no filtra: solo afecta al score; aquí solo
  // exigimos provider disponible, que quepa el contexto y visión si hace falta.
  if (viable.length === 0) {
    throw new Error(
      `No hay modelo viable (vision=${needsVision}, ~${promptTokens} tok, providers=${[...availableProviders].join("/") || "ninguno"}).`,
    );
  }

  const ranked = [...viable].sort((a, b) => score(b, task, strategy) - score(a, task, strategy));

  return {
    model: ranked[0],
    ranked,
    task,
    promptTokens,
    needsVision,
    reason: `auto:${strategy}:${task}`,
  };
}

// Enruta una petición de embeddings: respeta el modelo explícito si es de tipo
// embedding y está disponible; si no, elige el embedding más barato disponible.
export function routeEmbeddings(
  model: string,
  availableProviders: Set<string>,
): ModelSpec {
  if (model && model !== "auto") {
    const explicit = findModel(model);
    if (explicit && explicit.kind === "embedding" && availableProviders.has(explicit.provider)) {
      return explicit;
    }
  }
  const candidates = CATALOG.filter(
    (m) => m.kind === "embedding" && availableProviders.has(m.provider),
  ).sort((a, b) => a.input_per_mtok - b.input_per_mtok);
  if (candidates.length === 0) {
    throw new Error("No hay modelo de embeddings disponible (configura un provider que los soporte).");
  }
  return candidates[0];
}
