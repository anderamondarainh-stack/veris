import { readFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
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
import { VirtualKeyStore } from "./virtual-keys.js";

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
// Store de claves virtuales (multi-tenant). Solo se usa si está activado.
const vkeys = new VirtualKeyStore(cfg.vkeysFile);
const app = new Hono<{ Variables: { vkey?: string } }>();

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

// Comparación de secretos en tiempo constante (evita timing attacks sobre las
// claves de auth/admin). Guarda de longitud para no lanzar con buffers desiguales.
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// Reserva de presupuesto POR CLAVE VIRTUAL (mismo patrón que reserveBudget pero
// por vkey), para acotar el overshoot cuando varias requests de la misma clave
// llegan concurrentes antes de que ninguna registre su gasto.
const pendingByVkey = new Map<string, number>();
function reserveVkey(key: string, estMax: number): { ok: boolean; release: () => void } {
  const vk = vkeys.validate(key);
  if (vk && vk.budgetUsd !== undefined) {
    const pending = pendingByVkey.get(key) ?? 0;
    if (vk.spentUsd + pending >= vk.budgetUsd) return { ok: false, release: () => {} };
    pendingByVkey.set(key, pending + estMax);
  }
  let released = false;
  return {
    ok: true,
    release: () => {
      if (released) return;
      released = true;
      const p = (pendingByVkey.get(key) ?? 0) - estMax;
      if (p <= 0) pendingByVkey.delete(key);
      else pendingByVkey.set(key, p);
    },
  };
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
// Con virtual keys activas, la auth por gatewayApiKey se sustituye por la
// validación de la clave virtual para /v1/* (no conviven en la misma ruta).
if (cfg.gatewayApiKey && !cfg.virtualKeysEnabled) {
  app.use("/v1/*", async (c, next) => {
    const auth = c.req.header("authorization") ?? "";
    if (!safeEqual(auth, `Bearer ${cfg.gatewayApiKey}`)) {
      return c.json(oaiError("no autorizado", "authentication_error"), 401);
    }
    await next();
  });
}

// ── Virtual keys (multi-tenant) ───────────────────────────────────────────
// Exige `Authorization: Bearer vk-...`, valida la clave y comprueba presupuesto
// (pre-check rápido, 402), y guarda la clave en el contexto. El rate-limit y la
// reserva precisa de presupuesto se aplican en los handlers JUSTO antes de
// llamar al upstream, para no consumir cuota de rate en requests que se rechazan
// luego (modelo no permitido, tope global, etc.). El check de modelos (403) se
// hace en el handler de chat tras conocer el modelo elegido por el router.
if (cfg.virtualKeysEnabled) {
  app.use("/v1/*", async (c, next) => {
    const auth = c.req.header("authorization") ?? "";
    const key = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const vk = vkeys.validate(key);
    if (!vk) {
      return c.json(oaiError("clave virtual inválida o revocada", "authentication_error"), 401);
    }
    if (!vkeys.checkBudget(key)) {
      return c.json(oaiError("presupuesto de la clave agotado", "insufficient_quota"), 402);
    }
    c.set("vkey", key);
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

  // Virtual keys: si la clave restringe modelos y el elegido no está, 403.
  const vkey = c.get("vkey");
  if (vkey && !vkeys.allowsModel(vkey, decision.model.id)) {
    return c.json(oaiError(`modelo '${decision.model.id}' no permitido para esta clave`, "model_not_allowed"), 403);
  }

  c.header("x-byoa-model", decision.model.id);
  c.header("x-byoa-task", decision.task);
  c.header("x-byoa-reason", decision.reason);
  c.header("x-byoa-prompt-tokens", String(decision.promptTokens));

  // Reservas de gasto (global y por vkey) y rate-limit, en este orden, para
  // que un hit de rate solo se consuma si la request va a procesarse de verdad.
  const estMax = estimateCost(decision.model, decision.promptTokens, body.max_tokens ?? 1024);
  const budget = reserveBudget(estMax);
  if (!budget.ok) {
    return c.json(oaiError(`tope de gasto alcanzado ($${cfg.spendCapUsd})`, "spend_cap_exceeded"), 402);
  }
  const vkBudget = vkey ? reserveVkey(vkey, estMax) : { ok: true, release: () => {} };
  if (!vkBudget.ok) {
    budget.release();
    return c.json(oaiError("presupuesto de la clave agotado", "insufficient_quota"), 402);
  }
  if (vkey && !vkeys.checkRateLimit(vkey, Date.now())) {
    budget.release();
    vkBudget.release();
    return c.json(oaiError("rate limit de la clave excedido", "rate_limit_exceeded"), 429);
  }
  const releaseAll = () => {
    budget.release();
    vkBudget.release();
  };
  if (cfg.metricsEnabled) metrics.recordRequest(decision.model.id);

  // Streaming: no se cachea ni se hace fallback (semántica de stream). Registra
  // el coste real al cerrar el stream (antes evadía ledger y tope de gasto).
  if (body.stream) {
    const provider = registry.get(decision.model.provider);
    if (!provider) {
      releaseAll();
      return c.json(oaiError("provider no disponible", "no_providers"), 503);
    }
    return streamSSE(c, provider, decision, body, releaseAll, vkey);
  }

  const cached = cache.get(body);
  if (cached) {
    releaseAll();
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
    // Atribuye el coste real a la clave virtual (multi-tenant).
    if (vkey) vkeys.recordSpend(vkey, outcome.costUsd);
    return c.json(outcome.response);
  } catch (e: any) {
    if (cfg.metricsEnabled) metrics.recordError();
    console.error(`[upstream-error] ${decision.model.id}: ${e?.message}`);
    return c.json(oaiError("error del proveedor upstream (ver logs del gateway)", "upstream_error"), 502);
  } finally {
    releaseAll();
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

  // Virtual keys: modelo permitido (403) y rate-limit (429).
  const vkey = c.get("vkey");
  if (vkey && !vkeys.allowsModel(vkey, model.id)) {
    return c.json(oaiError(`modelo '${model.id}' no permitido para esta clave`, "model_not_allowed"), 403);
  }
  if (vkey && !vkeys.checkRateLimit(vkey, Date.now())) {
    return c.json(oaiError("rate limit de la clave excedido", "rate_limit_exceeded"), 429);
  }

  c.header("x-byoa-model", model.id);
  if (cfg.metricsEnabled) metrics.recordRequest(model.id);
  try {
    const res = await provider.embeddings(model.upstreamId, body);
    const cost = estimateCost(model, res.usage?.prompt_tokens ?? 0, 0);
    if (cfg.metricsEnabled && res.usage) {
      metrics.recordUsage(res.usage.prompt_tokens ?? 0, 0, cost);
    }
    if (vkey) vkeys.recordSpend(vkey, cost);
    return c.json(res);
  } catch (e: any) {
    if (cfg.metricsEnabled) metrics.recordError();
    console.error(`[upstream-error embeddings] ${model.id}: ${e?.message}`);
    return c.json(oaiError("error del proveedor upstream (ver logs del gateway)", "upstream_error"), 502);
  }
});

// ── Streaming SSE compatible con OpenAI ────────────────────────────────────
function streamSSE(
  c: any,
  provider: any,
  decision: { model: { id: string; provider: string; upstreamId: string }; promptTokens: number; task: string },
  req: ChatCompletionRequest,
  releaseBudget: () => void,
  vkey?: string,
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
        // Atribuye el coste estimado del stream a la clave virtual.
        if (vkey) vkeys.recordSpend(vkey, costUsd);
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

// ── Rutas admin de virtual keys ───────────────────────────────────────────
// Protegidas por `Authorization: Bearer <adminKey>`. Si no hay adminKey
// configurada, las rutas no existen (404) para no filtrar su presencia.
function requireAdmin(c: any): Response | null {
  if (!cfg.adminKey) return c.json(oaiError("no encontrado", "not_found"), 404);
  const auth = c.req.header("authorization") ?? "";
  if (!safeEqual(auth, `Bearer ${cfg.adminKey}`)) {
    return c.json(oaiError("no autorizado", "authentication_error"), 401);
  }
  return null;
}

// Crea una clave y la DEVUELVE entera (única vez que se ve completa).
app.post("/admin/keys", async (c) => {
  const denied = requireAdmin(c);
  if (denied) return denied;
  let body: { label?: string; budgetUsd?: number; rpm?: number; models?: string[] };
  try {
    body = await c.req.json();
  } catch {
    return c.json(oaiError("JSON inválido"), 400);
  }
  if (!body.label) return c.json(oaiError("Falta 'label'"), 400);
  const vk = vkeys.create({
    label: body.label,
    budgetUsd: body.budgetUsd,
    rpm: body.rpm,
    models: body.models,
  });
  return c.json(vk, 201);
});

// Lista las claves.
app.get("/admin/keys", (c) => {
  const denied = requireAdmin(c);
  if (denied) return denied;
  return c.json({ object: "list", data: vkeys.list() });
});

// Revoca una clave.
app.delete("/admin/keys/:key", (c) => {
  const denied = requireAdmin(c);
  if (denied) return denied;
  const key = c.req.param("key");
  if (!vkeys.validate(key)) {
    return c.json(oaiError("clave no encontrada", "not_found"), 404);
  }
  vkeys.revoke(key);
  return c.json({ revoked: true, key });
});

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
