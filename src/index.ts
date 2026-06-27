import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { ChatCompletionRequest } from "./types/index.js";
import { Registry } from "./providers/registry.js";
import { route } from "./router/index.js";
import { CATALOG } from "./router/catalog.js";
import { loadConfig } from "./config.js";
import { Ledger } from "./ledger.js";
import { ResponseCache } from "./cache.js";
import { completeWithResilience } from "./orchestrator.js";

const cfg = loadConfig();
const registry = new Registry(process.env);
const ledger = new Ledger();
const cache = new ResponseCache(cfg.cacheTtlSeconds);
const app = new Hono();

// ── Auth opcional del propio gateway ──────────────────────────────────────
if (cfg.gatewayApiKey) {
  app.use("/v1/*", async (c, next) => {
    const auth = c.req.header("authorization") ?? "";
    if (auth !== `Bearer ${cfg.gatewayApiKey}`) {
      return c.json({ error: "no autorizado" }, 401);
    }
    await next();
  });
}

// ── Salud / info ──────────────────────────────────────────────────────────
app.get("/", (c) =>
  c.json({
    name: "byoa-gateway",
    status: "ok",
    strategy: cfg.strategy,
    providers: [...registry.availableProviderNames()],
    cache: cache.enabled() ? `${cfg.cacheTtlSeconds}s` : "off",
  }),
);

// ── Modelos (OpenAI-compatible) ───────────────────────────────────────────
app.get("/v1/models", (c) => {
  const available = registry.availableProviderNames();
  const data: Array<{ id: string; object: "model"; owned_by: string }> = CATALOG.filter((m) =>
    available.has(m.provider),
  ).map((m) => ({ id: m.id, object: "model" as const, owned_by: m.provider }));
  data.unshift({ id: "auto", object: "model", owned_by: "byoa-router" });
  return c.json({ object: "list", data });
});

// ── Uso y coste acumulado ─────────────────────────────────────────────────
app.get("/v1/usage", (c) => c.json(ledger.rollup()));

// ── Chat completions ──────────────────────────────────────────────────────
app.post("/v1/chat/completions", async (c) => {
  if (registry.isEmpty()) {
    return c.json({ error: "No hay providers configurados. Añade una API key en .env." }, 503);
  }

  let body: ChatCompletionRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "JSON inválido" }, 400);
  }
  if (!body.messages?.length) {
    return c.json({ error: "Falta 'messages'" }, 400);
  }

  // Router.
  let decision;
  try {
    decision = route(body, registry.availableProviderNames(), cfg.strategy);
  } catch (e: any) {
    return c.json({ error: e.message }, 503);
  }

  c.header("x-byoa-model", decision.model.id);
  c.header("x-byoa-task", decision.task);
  c.header("x-byoa-reason", decision.reason);
  c.header("x-byoa-prompt-tokens", String(decision.promptTokens));

  // Streaming: no se cachea ni se hace fallback (semántica de stream).
  if (body.stream) {
    const provider = registry.get(decision.model.provider);
    if (!provider) return c.json({ error: "provider no disponible" }, 503);
    return streamSSE(c, provider, decision.model.upstreamId, decision.model.id, body);
  }

  // Caché de respuestas idénticas.
  const cached = cache.get(body);
  if (cached) {
    c.header("x-byoa-cache", "hit");
    return c.json(cached);
  }

  // Completion resiliente (fallback + reintentos + coste).
  try {
    const outcome = await completeWithResilience(registry, decision, body, cfg, ledger);
    c.header("x-byoa-model", outcome.model.id);
    c.header("x-byoa-cost-usd", outcome.costUsd.toFixed(6));
    c.header("x-byoa-attempts", String(outcome.attempts.length));
    c.header("x-byoa-cache", "miss");
    cache.set(body, outcome.response);
    return c.json(outcome.response);
  } catch (e: any) {
    return c.json({ error: e.message }, 502);
  }
});

// ── Streaming SSE compatible con OpenAI ────────────────────────────────────
function streamSSE(
  c: any,
  provider: any,
  upstreamId: string,
  modelId: string,
  req: ChatCompletionRequest,
) {
  const encoder = new TextEncoder();
  const created = Math.floor(Date.now() / 1000);
  const id = `chatcmpl-byoa-${created}`;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        for await (const delta of provider.stream(upstreamId, req)) {
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
      } catch (e: any) {
        send({ error: e.message });
      } finally {
        controller.close();
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
  console.log(`\n  byoa-gateway · http://localhost:${info.port}`);
  console.log(`  router=${cfg.strategy}  fallback=${cfg.enableFallback}  cache=${cache.enabled() ? cfg.cacheTtlSeconds + "s" : "off"}`);
  console.log(`  auth=${cfg.gatewayApiKey ? "on" : "off"}`);
  console.log(
    provs.length
      ? `  providers: ${provs.join(", ")}\n`
      : `  ⚠️  ningún provider. Copia .env.example a .env y añade una API key.\n`,
  );
});
