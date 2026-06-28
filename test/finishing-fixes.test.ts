import { describe, it, expect, vi, afterEach } from "vitest";
import { ResponseCache } from "../src/cache.js";
import { Ledger } from "../src/ledger.js";
import { loadConfig } from "../src/config.js";
import { classify } from "../src/router/classify.js";
import { estimateTokens } from "../src/router/tokens.js";
import { GeminiProvider } from "../src/providers/gemini.js";
import { buildResponse } from "../src/providers/base.js";
import type { ChatCompletionRequest } from "../src/types/index.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const base = (over: Partial<ChatCompletionRequest>): ChatCompletionRequest => ({
  model: "m",
  messages: [{ role: "user", content: "hola" }],
  ...over,
});

describe("cache: no sirve respuesta de texto a request con tools (cache poisoning)", () => {
  it("distingue por tools/response_format", () => {
    const c = new ResponseCache(60);
    const plain = base({});
    const withTools = base({ tools: [{ type: "function", function: { name: "f" } }] });
    c.set(plain, buildResponse("m", "texto"), 1000);
    expect(c.get(plain, 1000)).toBeDefined();
    // misma conversación pero con tools → clave distinta → miss
    expect(c.get(withTools, 1000)).toBeUndefined();
  });
  it("respeta el techo de entradas (no crece sin límite)", () => {
    const c = new ResponseCache(60, 3);
    for (let i = 0; i < 10; i++) c.set(base({ model: `m${i}` }), buildResponse("m", "x"), 1000);
    // No podemos inspeccionar size directamente, pero la primera ya fue desalojada.
    expect(c.get(base({ model: "m0" }), 1000)).toBeUndefined();
    expect(c.get(base({ model: "m9" }), 1000)).toBeDefined();
  });
});

describe("ledger: total histórico no se trunca con la ventana", () => {
  it("totalCost acumula más allá del cap de entradas", () => {
    const l = new Ledger(2); // ventana de solo 2 entradas
    for (let i = 0; i < 5; i++) {
      l.record({ model: "m", provider: "p", task: "chat", promptTokens: 1, completionTokens: 1, costUsd: 1 });
    }
    expect(l.totalCost()).toBe(5);
    const r = l.rollup();
    expect(r.totalRequests).toBe(5); // histórico
    expect(r.recentWindow).toBe(2); // ventana truncada
  });
});

describe("config: alias VERIS_/BYOA_, validación y decimales", () => {
  it("VERIS_ tiene prioridad sobre BYOA_", () => {
    const cfg = loadConfig({ VERIS_MAX_RETRIES: "5", BYOA_MAX_RETRIES: "9" } as any);
    expect(cfg.maxRetries).toBe(5);
  });
  it("acepta el alias BYOA_ si no hay VERIS_", () => {
    const cfg = loadConfig({ BYOA_FALLBACK: "false" } as any);
    expect(cfg.enableFallback).toBe(false);
  });
  it("spendCap admite decimales y strategy inválida cae a balanced", () => {
    const cfg = loadConfig({ BYOA_SPEND_CAP_USD: "0.5", ROUTER_STRATEGY: "fastest" } as any);
    expect(cfg.spendCapUsd).toBe(0.5);
    expect(cfg.strategy).toBe("balanced");
  });
  it("int trunca decimales en puerto", () => {
    expect(loadConfig({ PORT: "8787.9" } as any).port).toBe(8787);
  });
});

describe("classify/tokens: multimodal sin falsos positivos de visión", () => {
  it("array de solo texto NO es visión", () => {
    const msgs: any = [{ role: "user", content: [{ type: "text", text: "describe esto en detalle ".repeat(10) }] }];
    expect(classify(msgs)).not.toBe("vision");
  });
  it("array con imagen SÍ es visión", () => {
    const msgs: any = [{ role: "user", content: [{ type: "image_url", image_url: { url: "x" } }] }];
    expect(classify(msgs)).toBe("vision");
  });
  it("estima tokens del texto en content multimodal", () => {
    const msgs: any = [{ role: "user", content: [{ type: "text", text: "x".repeat(400) }] }];
    expect(estimateTokens(msgs)).toBeGreaterThan(90);
  });
});

describe("virtual keys: restricción de modelos", () => {
  it("'auto' en la lista = sin restricción; lista concreta restringe", async () => {
    const { VirtualKeyStore } = await import("../src/virtual-keys.js");
    const store = new VirtualKeyStore();
    const kAuto = store.create({ label: "a", models: ["auto"] }).key;
    const kConcrete = store.create({ label: "b", models: ["openai/gpt-4o-mini"] }).key;
    // "auto" → permite cualquier modelo resuelto y NO impone restricción al router.
    expect(store.allowsModel(kAuto, "openai/gpt-4o")).toBe(true);
    expect(store.restrictModelsFor(kAuto)).toBeUndefined();
    // lista concreta → restringe y solo permite los de la lista.
    expect(store.allowsModel(kConcrete, "openai/gpt-4o")).toBe(false);
    expect(store.allowsModel(kConcrete, "openai/gpt-4o-mini")).toBe(true);
    expect(store.restrictModelsFor(kConcrete)).toEqual(new Set(["openai/gpt-4o-mini"]));
  });
  it("route respeta restrictModels", async () => {
    const { route } = await import("../src/router/index.js");
    const providers = new Set(["openai", "groq"]);
    const d = route(base({ model: "auto" }), providers, "cheapest", new Set(["openai/gpt-4o-mini"]));
    expect(d.model.id).toBe("openai/gpt-4o-mini");
  });
});

describe("gemini: mapea usageMetadata a usage", () => {
  it("usa el usage real del proveedor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: "hola" }] } }],
          usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 7, totalTokenCount: 18 },
        }),
      })),
    );
    const res = await new GeminiProvider("k").complete("gemini-x", base({}));
    expect(res.usage).toEqual({ prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 });
  });
});
