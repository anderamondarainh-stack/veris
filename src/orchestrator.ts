import type { ChatCompletionRequest, ChatCompletionResponse, ModelSpec } from "./types/index.js";
import type { Registry } from "./providers/registry.js";
import { withRetry, isRetryable } from "./providers/base.js";
import { estimateTokens, estimateCost } from "./router/tokens.js";
import type { RouteDecision } from "./router/index.js";
import { Ledger } from "./ledger.js";

export interface OrchestratorOpts {
  maxRetries: number;
  retryBaseMs: number;
  enableFallback: boolean;
  sleep?: (ms: number) => Promise<void>;
}

export interface CompletionOutcome {
  response: ChatCompletionResponse;
  model: ModelSpec;
  attempts: Array<{ model: string; ok: boolean; error?: string }>;
  costUsd: number;
}

// Rellena usage si el provider no lo devolvió, estimándolo. Así el ledger y las
// cabeceras de coste funcionan con cualquier provider (Anthropic/Gemini no
// siempre traen el mismo formato; OpenAI sí).
function ensureUsage(
  res: ChatCompletionResponse,
  model: ModelSpec,
  promptTokens: number,
): ChatCompletionResponse {
  if (res.usage && res.usage.total_tokens != null) return res;
  const text = res.choices?.[0]?.message?.content ?? "";
  const completion = Math.ceil(text.length / 4);
  res.usage = {
    prompt_tokens: promptTokens,
    completion_tokens: completion,
    total_tokens: promptTokens + completion,
  };
  return res;
}

// Ejecuta una completion con fallback sobre los candidatos rankeados del router
// y reintentos con backoff por candidato. Anota coste en el ledger.
export async function completeWithResilience(
  registry: Registry,
  decision: RouteDecision,
  req: ChatCompletionRequest,
  opts: OrchestratorOpts,
  ledger: Ledger,
): Promise<CompletionOutcome> {
  const candidates = opts.enableFallback ? decision.ranked : [decision.model];
  const attempts: CompletionOutcome["attempts"] = [];
  let lastErr: unknown;

  for (const model of candidates) {
    const provider = registry.get(model.provider);
    if (!provider) {
      attempts.push({ model: model.id, ok: false, error: "provider no disponible" });
      continue;
    }
    try {
      const raw = await withRetry(() => provider.complete(model.upstreamId, req), {
        retries: opts.maxRetries,
        baseMs: opts.retryBaseMs,
        sleep: opts.sleep,
      });
      const res = ensureUsage(raw, model, decision.promptTokens);
      const costUsd = estimateCost(
        model,
        res.usage!.prompt_tokens,
        res.usage!.completion_tokens,
      );
      attempts.push({ model: model.id, ok: true });
      ledger.record({
        model: model.id,
        provider: model.provider,
        task: decision.task,
        promptTokens: res.usage!.prompt_tokens,
        completionTokens: res.usage!.completion_tokens,
        costUsd,
      });
      return { response: res, model, attempts, costUsd };
    } catch (err) {
      lastErr = err;
      attempts.push({ model: model.id, ok: false, error: err instanceof Error ? err.message : String(err) });
      const msg = String(err);
      // Decidir si seguir probando otros modelos:
      //  - 429/5xx/red: transitorio (withRetry ya agotó reintentos en ESTE
      //    provider) → otro provider puede no estar saturado, sigue.
      //  - 401/403: este provider rechazó la auth → prueba el siguiente.
      //  - otro 4xx (400/404/422...): request inválida → fallará igual en
      //    todos, aborta el fallback.
      //  - desconocido sin código: prueba el siguiente por si acaso.
      if (isRetryable(err)) continue;
      if (/\b40[13]\b/.test(msg)) continue;
      if (/\b4\d{2}\b/.test(msg)) break;
    }
  }
  throw lastErr ?? new Error("sin candidatos para completar la request");
}

// Reexport para conveniencia de quien orquesta.
export { estimateTokens };
