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
];

export function findModel(id: string): ModelSpec | undefined {
  return CATALOG.find((m) => m.id === id || m.upstreamId === id);
}
