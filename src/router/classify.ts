import type { ChatMessage, TaskKind } from "../types/index.js";

// Clasificador de tareas por reglas (fase 1: rápido, barato, sin red).
// Mira el contenido de los mensajes y decide qué tipo de tarea es, para que
// el router elija el modelo adecuado. Más adelante se puede sustituir/combinar
// con un clasificador por embeddings (fase 2) sin tocar el router.

const CODE_SIGNS = [
  /```/, // bloque de código
  /\b(function|class|def|import|const|let|var|async|await|return)\b/,
  /\b(refactor|bug|stack ?trace|compile|typescript|python|rust|sql)\b/i,
  /\b(escribe|genera|arregla|implementa)\b.*\b(código|funci[oó]n|script|test)\b/i,
];

const REASONING_SIGNS = [
  /\b(demuestra|razona|analiza|compara|estrategia|plan(ifica)?|paso a paso)\b/i,
  /\b(prove|reason|analyze|step[- ]by[- ]step|trade[- ]?offs?)\b/i,
  /\b(matem[aá]tic|teorema|ecuaci[oó]n|optimiza)\b/i,
];

export function classify(messages: ChatMessage[]): TaskKind {
  const hasImage = messages.some(
    (m) => typeof m.content !== "string" || /data:image\//.test(m.content),
  );
  if (hasImage) return "vision";

  const text = messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("\n");

  if (CODE_SIGNS.some((re) => re.test(text))) return "code";
  if (REASONING_SIGNS.some((re) => re.test(text))) return "reasoning";

  // Heurística de "trivial": entrada muy corta => tarea barata.
  if (text.trim().length < 120) return "cheap";

  return "chat";
}
