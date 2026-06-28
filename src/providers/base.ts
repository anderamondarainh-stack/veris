import { randomUUID } from "node:crypto";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  EmbeddingsRequest,
  EmbeddingsResponse,
} from "../types/index.js";

// Contrato que cumple TODO provider, sea una API key (BYOK) o una cuenta
// automatizada (account-provider). El router no necesita saber cuál es:
// para él todos hablan el mismo idioma.
export interface Provider {
  /** Identificador, ej. "openai", "anthropic", "account:openai". */
  readonly name: string;

  /** ¿Está configurado y listo para usarse? (hay key / sesión válida). */
  isReady(): boolean;

  /** Ejecuta una completion no-streaming. `upstreamId` es el modelo real. */
  complete(
    upstreamId: string,
    req: ChatCompletionRequest,
  ): Promise<ChatCompletionResponse>;

  /** Ejecuta una completion en streaming (SSE). Devuelve trozos de texto. */
  stream(
    upstreamId: string,
    req: ChatCompletionRequest,
  ): AsyncGenerator<string, void, unknown>;

  /** Embeddings (opcional; solo providers que los soportan). */
  embeddings?(
    upstreamId: string,
    req: EmbeddingsRequest,
  ): Promise<EmbeddingsResponse>;
}

// Helper compartido: construye una respuesta OpenAI-compatible a partir
// del texto completo, para providers que no devuelven ya ese formato.
export function buildResponse(
  model: string,
  text: string,
  usage?: ChatCompletionResponse["usage"],
): ChatCompletionResponse {
  return {
    id: `chatcmpl-veris-${randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: "stop",
      },
    ],
    usage,
  };
}

// ¿Merece la pena reintentar este error? 429 (rate limit) y 5xx sí; 4xx no
// (request mala, auth inválida) — reintentar no ayuda y gasta cuota.
export function isRetryable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/\b(\d{3})\b/);
  if (m) {
    const code = Number(m[1]);
    return code === 429 || (code >= 500 && code < 600);
  }
  // Errores de red sin código (ECONNRESET, timeouts) → reintentables.
  return /ECONNRESET|ETIMEDOUT|fetch failed|network|socket/i.test(msg);
}

// Reintenta `fn` con backoff exponencial + jitter. `sleep` es inyectable para
// que los tests no esperen de verdad.
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries: number; baseMs: number; sleep?: (ms: number) => Promise<void> },
): Promise<T> {
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  let lastErr: unknown;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === opts.retries || !isRetryable(err)) break;
      const backoff = opts.baseMs * 2 ** attempt;
      // Jitter aleatorio (full jitter) para evitar thundering herd cuando varias
      // instancias reintentan a la vez. Los tests inyectan sleep=noop, así que
      // el valor exacto no afecta a su determinismo.
      const jitter = backoff * 0.25 * Math.random();
      await sleep(backoff + jitter);
    }
  }
  throw lastErr;
}
