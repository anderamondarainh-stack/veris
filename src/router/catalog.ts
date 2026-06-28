import type { ModelSpec } from "../types/index.js";

// Catálogo de modelos que el router puede elegir.
//
// ⚠️ Los precios/ids son ILUSTRATIVOS y cambian a menudo. Antes de usar en
// serio, actualízalos contra la doc oficial de cada proveedor. Mantener este
// archivo al día es la única "verdad" que necesita el router.
//
// Convención de id canónico: "<provider>/<nombre-corto>".
export const CATALOG: ModelSpec[] = [
  // ── OpenAI ──────────────────────────────────────────────────────────────
  {
    id: "openai/gpt-4o-mini",
    provider: "openai",
    upstreamId: "gpt-4o-mini",
    good_at: ["cheap", "chat", "vision"],
    input_per_mtok: 0.15,
    output_per_mtok: 0.6,
    context: 128_000,
    vision: true,
  },
  {
    id: "openai/gpt-4o",
    provider: "openai",
    upstreamId: "gpt-4o",
    good_at: ["chat", "vision", "reasoning"],
    input_per_mtok: 2.5,
    output_per_mtok: 10,
    context: 128_000,
    vision: true,
  },
  // ── Anthropic ───────────────────────────────────────────────────────────
  {
    id: "anthropic/claude-haiku",
    provider: "anthropic",
    upstreamId: "claude-haiku-4-5-20251001",
    good_at: ["cheap", "chat", "code"],
    input_per_mtok: 1,
    output_per_mtok: 5,
    context: 200_000,
    vision: true,
  },
  {
    id: "anthropic/claude-sonnet",
    provider: "anthropic",
    upstreamId: "claude-sonnet-4-6",
    good_at: ["code", "reasoning", "chat"],
    input_per_mtok: 3,
    output_per_mtok: 15,
    context: 200_000,
    vision: true,
  },
  {
    id: "anthropic/claude-opus",
    provider: "anthropic",
    upstreamId: "claude-opus-4-8",
    good_at: ["code", "reasoning"],
    input_per_mtok: 15,
    output_per_mtok: 75,
    context: 200_000,
    vision: true,
  },
  // ── Google Gemini ─────────────────────────────────────────────────────────
  {
    id: "gemini/flash",
    provider: "gemini",
    upstreamId: "gemini-2.0-flash",
    good_at: ["cheap", "chat", "vision"],
    input_per_mtok: 0.1,
    output_per_mtok: 0.4,
    context: 1_000_000,
    vision: true,
  },
  {
    id: "gemini/pro",
    provider: "gemini",
    upstreamId: "gemini-2.5-pro",
    good_at: ["reasoning", "code", "vision"],
    input_per_mtok: 1.25,
    output_per_mtok: 10,
    context: 2_000_000,
    vision: true,
  },
  // ── Groq (inferencia ultrarrápida de modelos abiertos) ────────────────────
  {
    id: "groq/llama-3.3-70b",
    provider: "groq",
    upstreamId: "llama-3.3-70b-versatile",
    good_at: ["chat", "code", "reasoning"],
    input_per_mtok: 0.59,
    output_per_mtok: 0.79,
    context: 128_000,
    vision: false,
  },
  {
    id: "groq/llama-3.1-8b",
    provider: "groq",
    upstreamId: "llama-3.1-8b-instant",
    good_at: ["cheap", "chat"],
    input_per_mtok: 0.05,
    output_per_mtok: 0.08,
    context: 128_000,
    vision: false,
  },
  // ── DeepSeek ──────────────────────────────────────────────────────────────
  {
    id: "deepseek/chat",
    provider: "deepseek",
    upstreamId: "deepseek-chat",
    good_at: ["cheap", "chat", "code"],
    input_per_mtok: 0.27,
    output_per_mtok: 1.1,
    context: 64_000,
    vision: false,
  },
  {
    id: "deepseek/reasoner",
    provider: "deepseek",
    upstreamId: "deepseek-reasoner",
    good_at: ["reasoning", "code"],
    input_per_mtok: 0.55,
    output_per_mtok: 2.19,
    context: 64_000,
    vision: false,
  },
  // ── Mistral ───────────────────────────────────────────────────────────────
  {
    id: "mistral/large",
    provider: "mistral",
    upstreamId: "mistral-large-latest",
    good_at: ["chat", "code", "reasoning"],
    input_per_mtok: 2,
    output_per_mtok: 6,
    context: 128_000,
    vision: false,
  },
  {
    id: "mistral/small",
    provider: "mistral",
    upstreamId: "mistral-small-latest",
    good_at: ["cheap", "chat"],
    input_per_mtok: 0.2,
    output_per_mtok: 0.6,
    context: 128_000,
    vision: false,
  },
  // ── xAI Grok ──────────────────────────────────────────────────────────────
  {
    id: "xai/grok",
    provider: "xai",
    upstreamId: "grok-2-latest",
    good_at: ["chat", "reasoning"],
    input_per_mtok: 2,
    output_per_mtok: 10,
    context: 131_000,
    vision: false,
  },
  // ── Ollama (local, sin coste) ─────────────────────────────────────────────
  {
    id: "ollama/llama3.1",
    provider: "ollama",
    upstreamId: "llama3.1",
    good_at: ["cheap", "chat"],
    input_per_mtok: 0,
    output_per_mtok: 0,
    context: 128_000,
    vision: false,
  },
  {
    id: "ollama/qwen2.5-coder",
    provider: "ollama",
    upstreamId: "qwen2.5-coder",
    good_at: ["cheap", "code"],
    input_per_mtok: 0,
    output_per_mtok: 0,
    context: 32_000,
    vision: false,
  },
  // ── Embeddings ────────────────────────────────────────────────────────────
  {
    id: "openai/text-embedding-3-small",
    provider: "openai",
    upstreamId: "text-embedding-3-small",
    good_at: [],
    input_per_mtok: 0.02,
    output_per_mtok: 0,
    context: 8_191,
    vision: false,
    kind: "embedding",
  },
  {
    id: "openai/text-embedding-3-large",
    provider: "openai",
    upstreamId: "text-embedding-3-large",
    good_at: [],
    input_per_mtok: 0.13,
    output_per_mtok: 0,
    context: 8_191,
    vision: false,
    kind: "embedding",
  },
];

export function findModel(id: string): ModelSpec | undefined {
  return CATALOG.find((m) => m.id === id || m.upstreamId === id);
}

// Valida que un objeto tenga la forma mínima de un ModelSpec usable. Rechaza
// entradas malformadas (que romperían el routing o las etiquetas de /metrics).
function isValidSpec(s: any): s is ModelSpec {
  return (
    s &&
    typeof s.id === "string" &&
    s.id.length > 0 &&
    !/["\n\r\\]/.test(s.id) && // ids con comillas/saltos romperían labels Prometheus
    typeof s.provider === "string" &&
    s.provider.length > 0 &&
    typeof s.upstreamId === "string" &&
    s.upstreamId.length > 0 &&
    typeof s.input_per_mtok === "number" &&
    typeof s.output_per_mtok === "number" &&
    typeof s.context === "number"
  );
}

// Carga modelos extra/override desde un fichero JSON (MODELS_FILE). Permite a
// cada usuario añadir modelos o corregir precios sin tocar el código. El JSON
// es un array de ModelSpec; los ids que ya existan se reemplazan, los nuevos se
// añaden. Muta CATALOG en sitio para preservar los imports vivos. Devuelve
// cuántos se aplicaron e ignora (avisando) los inválidos.
export function applyCatalogOverride(specs: unknown): { applied: number; skipped: number } {
  if (!Array.isArray(specs)) throw new Error("MODELS_FILE debe ser un array de modelos");
  let applied = 0;
  let skipped = 0;
  for (const spec of specs) {
    if (!isValidSpec(spec)) {
      skipped++;
      continue;
    }
    // Normaliza campos opcionales para no arrastrar basura.
    const clean: ModelSpec = {
      id: spec.id,
      provider: spec.provider,
      upstreamId: spec.upstreamId,
      good_at: Array.isArray(spec.good_at) ? spec.good_at : [],
      input_per_mtok: spec.input_per_mtok,
      output_per_mtok: spec.output_per_mtok,
      context: spec.context,
      vision: !!spec.vision,
      kind: spec.kind === "embedding" ? "embedding" : "chat",
    };
    const idx = CATALOG.findIndex((m) => m.id === clean.id);
    if (idx >= 0) CATALOG[idx] = clean;
    else CATALOG.push(clean);
    applied++;
  }
  return { applied, skipped };
}
