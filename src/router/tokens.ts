import type { ChatMessage, ModelSpec } from "../types/index.js";

// Estimación de tokens SIN dependencias de tokenizer. Heurística ~4 chars/token
// para texto latino, con un suelo por mensaje (overhead de rol/formato). Es
// aproximada a propósito: sirve para (a) descartar modelos cuyo contexto no
// cabe y (b) estimar coste. Para precisión exacta, enchufar tiktoken/@anthropic.
const CHARS_PER_TOKEN = 4;
const PER_MESSAGE_OVERHEAD = 4;

export function estimateTokens(messages: ChatMessage[]): number {
  let total = 0;
  for (const m of messages) {
    total += PER_MESSAGE_OVERHEAD;
    total += Math.ceil((m.content?.length ?? 0) / CHARS_PER_TOKEN);
    if (m.name) total += Math.ceil(m.name.length / CHARS_PER_TOKEN);
  }
  return total;
}

// Coste estimado en USD dados tokens de entrada y salida y el spec del modelo.
export function estimateCost(
  model: ModelSpec,
  inputTokens: number,
  outputTokens: number,
): number {
  return (
    (inputTokens / 1_000_000) * model.input_per_mtok +
    (outputTokens / 1_000_000) * model.output_per_mtok
  );
}

// ¿Cabe el prompt (más un margen para la respuesta) en la ventana del modelo?
export function fitsContext(
  model: ModelSpec,
  promptTokens: number,
  reservedForOutput = 1024,
): boolean {
  return promptTokens + reservedForOutput <= model.context;
}
