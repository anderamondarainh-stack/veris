import { readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { ChatCompletionRequest, EmbeddingsRequest } from "./types/index.js";
import { Registry } from "./providers/registry.js";
import { route, routeEmbeddings } from "./router/index.js";
import { CATALOG, applyCatalogOverride } from "./router/catalog.js";
import { loadConfig } from "./config.js";
import { Ledger } from "./ledger.js";
import { ResponseCache } from "./cache.js";
import { Metrics } from "./metrics.js";
import { completeWithResilience } from "./orchestrator.js";
import { estimateCost } from "./router/tokens.js";

const cfg = loadConfig();

// Override del catálogo desde fichero (MODELS_FILE), si se configuró.
if (cfg.modelsFile) {
  try {
    const { applied, skipped } = applyCatalogOverride(JSON.parse(readFileSync(cfg.modelsFile, "utf8")));
    console.log(`  catálogo: override de ${cfg.modelsFile} (${applied} aplicados, ${skipped} ignorados)`);
  } catch (e: any) {
    console.warn(`  ⚠️  no se pudo leer MODELS_FILE (${cfg.modelsFile}): ${e.message}`);
  }
}

const registry = new Registry(process.env);
const ledger = new Ledger();
const cache = new ResponseCache(cfg.cacheTtlSeconds);
const metrics = new Metrics();
const app = new Hono();

// Coste estimado de las requests EN VUELO (aún sin registrar en el ledger). Se
// suma al gasto comprometido para el tope, evitando que N requests concurrentes
// pasen todas el check antes de que ninguna termine (TOCTOU / overshoot).
let pendingCostUsd = 0;

// ¿Aceptamos una request más sin pasarnos del tope de gasto? Reserva el coste
// estimado si la acepta. Devuelve un liberador (llamar siempre al terminar).
function reserveBudget(estMaxUsd: number): { ok: boolean; release: () => void } {
  if (cfg.spendCapUsd > 0 && ledger.rollup().totalCostUsd + pendingCostUsd >= cfg.spendCapUsd) {
    return { ok: false, release: () => {} };
  }
  pendingCostUsd += estMaxUsd;
  let released = false;
  return {
    ok: true,
    release: () => {
      if (released) return;
      released = true;
      pendingCostUsd = Math.max(0, pendingCostUsd - estMaxUsd);
    },
  };
}

// Error en formato OpenAI ({ error: { message, type, code } }) para que los
// SDKs lo parseen igual que un error nativo del proveedor.
function oaiError(message: string, type = "invalid_request_error", code?: string) {
  return { error: { message, type, code: code ?? null } };
}

// ── Logging estructurado + métricas + latencia ────────────────────────────
if (cfg.logRequests || cfg.metricsEnabled) {
  app.use("/v1/*", async (c, next) => {
    const start = performance.now();
    await next();
    const ms = performance.now() - start;
    if (cfg.metricsEnabled) metrics.recordLatency(ms);
    if (cfg.logRequests) {
      console.log(
        JSON.stringify({
          t: new Date().toISOString(),
          method: c.req.method,
          path: new URL(c.req.url).pathname,
          status: c.res.status,
          ms: Math.round(ms),
          model: c.res.headers.get("x-byoa-model") ?? undefined,
        }),
      );
    }
  });
}

// ── Auth opcional del propio gateway ──────────────────────────────────────
if (cfg.gatewayApiKey) {
  app.use("/v1/*", async (c, next) => {
    const auth = c.req.header("authorization") ?? "";
    if (auth !== `Bearer ${cfg.gatewayApiKey}`) {
      return c.json(oaiError("no autorizado", "authentication_error"), 401);
    }
    await next();
  });
}

// ── Salud / info / observabilidad ─────────────────────────────────────────
app.get("/", (c) =>
  c.json({
    name: "veris",
    status: "ok",
    strategy: cfg.strategy,
    providers: [...registry.availableProviderNames()],
    cache: cache.enabled() ? `${cfg.cacheTtlSeconds}s` : "off",
    spendCapUsd: cfg.spendCapUsd || null,
  }),
);
app.get("/healthz", (c) => c.json({ status: "ok" }));
app.get("/readyz", (c) =>
  registry.isEmpty() ? c.json({ status: "no-providers" }, 503) : c.json({ status: "ready" }),
);
app.get("/metrics", (c) =>
  cfg.metricsEnabled
    ? c.text(metrics.render(), 200, { "Content-Type": "text/plain; version=0.0.4" })
    : c.text("metrics disabled\n", 404),
);

// ── Modelos (OpenAI-compatible) ───────────────────────────────────────────
app.get("/v1/models", (c) => {
  const available = registry.availableProviderNames();
  const data: Array<{ id: string; object: "model"; owned_by: string }> = CATALOG.filter((m) =>
    available.has(m.provider),
  ).map((m) => ({ id: m.id, object: "model" as const, owned_by: m.provider }));
  data.unshift({ id: "auto", object: "model", owned_by: "veris-router" });
  return c.json({ object: "list", data });
});

// ── Uso y coste acumulado ─────────────────────────────────────────────────
app.get("/v1/usage", (c) => c.json(ledger.rollup()));

// ── Chat completions ──────────────────────────────────────────────────────
app.post("/v1/chat/completions", async (c) => {
  if (registry.isEmpty()) {
    return c.json(oaiError("No hay providers configurados. Añade una API key.", "no_providers"), 503);
  }

  let body: ChatCompletionRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json(oaiError("JSON inválido"), 400);
  }
  if (!body.messages?.length) {
    return c.json(oaiError("Falta 'messages'"), 400);
  }
  // `n>1` con streaming no se soporta (solo emitimos choices[0]); fallar claro
  // en vez de truncar en silencio.
  if (body.stream && typeof body.n === "number" && body.n > 1) {
    return c.json(oaiError("n>1 no soportado con stream", "unsupported"), 400);
  }

  let decision;
  try {
    decision = route(body, registry.availableProviderNames(), cfg.strategy);
  } catch (e: any) {
    return c.json(oaiError(e.message, "no_viable_model"), 503);
  }

  c.header("x-byoa-model", decision.model.id);
  c.header("x-byoa-task", decision.task);
  c.header("x-byoa-reason", decision.reason);
  c.header("x-byoa-prompt-tokens", String(decision.promptTokens));

  // Tope de gasto (con reserva del coste estimado para acotar el overshoot
  // bajo concurrencia). Cubre TODOS los paths, incluido streaming.
  const estMax = estimateCost(decision.model, decision.promptTokens, body.max_tokens ?? 1024);
  const budget = reserveBudget(estMax);
  if (!budget.ok) {
    return c.json(oaiError(`tope de gasto alcanzado ($${cfg.spendCapUsd})`, "spend_cap_exceeded"), 402);
  }
  if (cfg.metricsEnabled) metrics.recordRequest(decision.model.id);

  // Streaming: no se cachea ni se hace fallback (semántica de stream). Registra
  // el coste real al cerrar el stream (antes evadía ledger y tope de gasto).
  if (body.stream) {
    const provider = registry.get(decision.model.provider);
    if (!provider) {
      budget.release();
      return c.json(oaiError("provider no disponible", "no_providers"), 503);
    }
    return streamSSE(c, provider, decision, body, budget.release);
  }

  const cached = cache.get(body);
  if (cached) {
    budget.release();
    c.header("x-byoa-cache", "hit");
    return c.json(cached);
  }

  try {
    const outcome = await completeWithResilience(registry, decision, body, cfg, ledger);
    c.header("x-byoa-model", outcome.model.id);
    c.header("x-byoa-cost-usd", outcome.costUsd.toFixed(6));
    c.header("x-byoa-attempts", String(outcome.attempts.length));
    c.header("x-byoa-cache", "miss");
    if (cfg.metricsEnabled && outcome.response.usage) {
      metrics.recordUsage(
        outcome.response.usage.prompt_tokens,
        outcome.response.usage.completion_tokens,
        outcome.costUsd,
      );
    }
    cache.set(body, outcome.response);
    return c.json(outcome.response);
  } catch (e: any) {
    if (cfg.metricsEnabled) metrics.recordError();
    console.error(`[upstream-error] ${decision.model.id}: ${e?.message}`);
    return c.json(oaiError("error del proveedor upstream (ver logs del gateway)", "upstream_error"), 502);
  } finally {
    budget.release();
  }
});

// ── Embeddings (OpenAI-compatible) ─────────────────────────────────────────
app.post("/v1/embeddings", async (c) => {
  if (registry.isEmpty()) {
    return c.json(oaiError("No hay providers configurados.", "no_providers"), 503);
  }
  let body: EmbeddingsRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json(oaiError("JSON inválido"), 400);
  }
  if (body.input === undefined || body.input === null) {
    return c.json(oaiError("Falta 'input'"), 400);
  }

  let model;
  try {
    model = routeEmbeddings(body.model, registry.availableProviderNames());
  } catch (e: any) {
    return c.json(oaiError(e.message, "no_viable_model"), 503);
  }
  const provider = registry.get(model.provider);
  if (!provider?.embeddings) {
    return c.json(oaiError(`provider ${model.provider} no soporta embeddings`, "unsupported"), 503);
  }

  c.header("x-byoa-model", model.id);
  if (cfg.metricsEnabled) metrics.recordRequest(model.id);
  try {
    const res = await provider.embeddings(model.upstreamId, body);
    if (cfg.metricsEnabled && res.usage) {
      const cost = estimateCost(model, res.usage.prompt_tokens ?? 0, 0);
      metrics.recordUsage(res.usage.prompt_tokens ?? 0, 0, cost);
    }
    return c.json(res);
  } catch (e: any) {
    if (cfg.metricsEnabled) metrics.recordError();
    return c.json(oaiError(e.message, "upstream_error"), 502);
  }
});

// ── Streaming SSE compatible con OpenAI ────────────────────────────────────
function streamSSE(
  c: any,
  provider: any,
  decision: { model: { id: string; provider: string; upstreamId: string }; promptTokens: number; task: string },
  req: ChatCompletionRequest,
  releaseBudget: () => void,
) {
  const encoder = new TextEncoder();
  const created = Math.floor(Date.now() / 1000);
  const id = `chatcmpl-byoa-${created}`;
  const modelId = decision.model.id;
  let outChars = 0;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        for await (const delta of provider.stream(decision.model.upstreamId, req)) {
          outChars += delta.length;
          send({
            id,
            object: "chat.completion.chunk",
            created,
            model: modelId,
            choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
          });
        }
        send({
          id,
          object: "chat.completion.chunk",
          created,
          model: modelId,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        // Contabiliza el stream en el ledger y métricas (estimación: el stream
        // no devuelve usage, así que estimamos tokens de salida por longitud).
        const completionTokens = Math.ceil(outChars / 4);
        const costUsd = estimateCost(decision.model as any, decision.promptTokens, completionTokens);
        ledger.record({
          model: modelId,
          provider: decision.model.provider,
          task: decision.task,
          promptTokens: decision.promptTokens,
          completionTokens,
          costUsd,
        });
        if (cfg.metricsEnabled) metrics.recordUsage(decision.promptTokens, completionTokens, costUsd);
      } catch (e: any) {
        if (cfg.metricsEnabled) metrics.recordError();
        console.error(`[upstream-error stream] ${modelId}: ${e?.message}`);
        send({ error: { message: "error del proveedor upstream (ver logs del gateway)", type: "upstream_error" } });
      } finally {
        controller.close();
        releaseBudget();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "x-byoa-model": modelId,
    },
  });
}

serve({ fetch: app.fetch, port: cfg.port }, (info) => {
  const provs = [...registry.availableProviderNames()];
  console.log(`\n  veris · http://localhost:${info.port}`);
  console.log(
    `  router=${cfg.strategy}  fallback=${cfg.enableFallback}  cache=${cache.enabled() ? cfg.cacheTtlSeconds + "s" : "off"}  spendCap=${cfg.spendCapUsd || "off"}`,
  );
  console.log(`  auth=${cfg.gatewayApiKey ? "on" : "off"}  metrics=${cfg.metricsEnabled ? "on" : "off"}`);
  console.log(
    provs.length
      ? `  providers: ${provs.join(", ")}\n`
      : `  ⚠️  ningún provider. Copia .env.example a .env y añade una API key.\n`,
  );
});

export { app };
