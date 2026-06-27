import { describe, it, expect } from "vitest";
import { withRetry, isRetryable, buildResponse } from "../src/providers/base.js";
import { ResponseCache } from "../src/cache.js";
import { Ledger } from "../src/ledger.js";
import { completeWithResilience } from "../src/orchestrator.js";
import { Registry } from "../src/providers/registry.js";
import { route } from "../src/router/index.js";
import type { Provider } from "../src/providers/base.js";
import type { ChatCompletionRequest, ChatCompletionResponse } from "../src/types/index.js";

const noSleep = async () => {};

describe("isRetryable", () => {
  it("reintenta 429 y 5xx, no 4xx", () => {
    expect(isRetryable(new Error("OpenAI 429: rate"))).toBe(true);
    expect(isRetryable(new Error("OpenAI 503: down"))).toBe(true);
    expect(isRetryable(new Error("OpenAI 400: bad"))).toBe(false);
    expect(isRetryable(new Error("ECONNRESET"))).toBe(true);
  });
});

describe("withRetry", () => {
  it("reintenta hasta éxito en errores reintentables", async () => {
    let n = 0;
    const r = await withRetry(
      async () => {
        if (++n < 3) throw new Error("503 transitorio");
        return "ok";
      },
      { retries: 3, baseMs: 1, sleep: noSleep },
    );
    expect(r).toBe("ok");
    expect(n).toBe(3);
  });
  it("no reintenta errores 4xx", async () => {
    let n = 0;
    await expect(
      withRetry(async () => { n++; throw new Error("400 mala"); }, { retries: 3, baseMs: 1, sleep: noSleep }),
    ).rejects.toThrow("400");
    expect(n).toBe(1);
  });
});

describe("ResponseCache", () => {
  const req: ChatCompletionRequest = { model: "auto", messages: [{ role: "user", content: "hola" }] };
  const res = buildResponse("m", "respuesta");
  it("desactivada con ttl 0", () => {
    const c = new ResponseCache(0);
    c.set(req, res);
    expect(c.get(req)).toBeUndefined();
  });
  it("hit dentro del ttl, miss tras expirar", () => {
    const c = new ResponseCache(60);
    c.set(req, res, 1000);
    expect(c.get(req, 1000)).toEqual(res);
    expect(c.get(req, 1000 + 61_000)).toBeUndefined();
  });
});

describe("Ledger", () => {
  it("agrega coste y tokens por modelo", () => {
    const l = new Ledger();
    l.record({ model: "a", provider: "p", task: "chat", promptTokens: 10, completionTokens: 5, costUsd: 0.01 });
    l.record({ model: "a", provider: "p", task: "chat", promptTokens: 20, completionTokens: 10, costUsd: 0.02 });
    const r = l.rollup();
    expect(r.totalRequests).toBe(2);
    expect(r.totalCostUsd).toBeCloseTo(0.03, 6);
    expect(r.byModel["a"].requests).toBe(2);
    expect(r.byModel["a"].tokens).toBe(45);
  });
});

// Provider falso para probar fallback sin red.
class FakeProvider implements Provider {
  constructor(public name: string, private behavior: "ok" | "429" | "400") {}
  isReady() { return true; }
  async complete(_id: string, _req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    if (this.behavior === "429") throw new Error("429 rate limit");
    if (this.behavior === "400") throw new Error("400 bad request");
    return buildResponse(this.name, "ok-" + this.name, {
      prompt_tokens: 5, completion_tokens: 3, total_tokens: 8,
    });
  }
  async *stream() { yield ""; }
}

describe("completeWithResilience", () => {
  const cfg = { maxRetries: 1, retryBaseMs: 1, enableFallback: true, sleep: noSleep };
  const reqBody: ChatCompletionRequest = { model: "auto", messages: [{ role: "user", content: "hola" }] };

  it("cae al segundo candidato si el primero da 429", async () => {
    const registry = new Registry({ OPENAI_API_KEY: "x", ANTHROPIC_API_KEY: "y" } as any);
    // Inyectamos providers falsos por encima del registry real.
    (registry as any).providers.set("openai", new FakeProvider("openai", "429"));
    (registry as any).providers.set("anthropic", new FakeProvider("anthropic", "ok"));

    const decision = route(reqBody, new Set(["openai", "anthropic"]), "cheapest");
    // Forzamos un ranking conocido: openai primero, anthropic después.
    decision.ranked = [
      { ...decision.model, provider: "openai", id: "openai/x", upstreamId: "x" } as any,
      { ...decision.model, provider: "anthropic", id: "anthropic/y", upstreamId: "y" } as any,
    ];
    decision.model = decision.ranked[0];

    const ledger = new Ledger();
    const out = await completeWithResilience(registry, decision, reqBody, cfg, ledger);
    expect(out.model.provider).toBe("anthropic");
    expect(out.attempts.some((a) => a.model === "openai/x" && !a.ok)).toBe(true);
    expect(ledger.rollup().totalRequests).toBe(1);
  });

  it("aborta el fallback ante un 400 (request mala)", async () => {
    const registry = new Registry({ OPENAI_API_KEY: "x" } as any);
    (registry as any).providers.set("openai", new FakeProvider("openai", "400"));
    (registry as any).providers.set("anthropic", new FakeProvider("anthropic", "ok"));

    const decision = route(reqBody, new Set(["openai", "anthropic"]), "cheapest");
    decision.ranked = [
      { ...decision.model, provider: "openai", id: "openai/x", upstreamId: "x" } as any,
      { ...decision.model, provider: "anthropic", id: "anthropic/y", upstreamId: "y" } as any,
    ];
    decision.model = decision.ranked[0];

    await expect(
      completeWithResilience(registry, decision, reqBody, cfg, new Ledger()),
    ).rejects.toThrow("400");
  });
});
