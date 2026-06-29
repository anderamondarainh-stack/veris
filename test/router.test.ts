import { describe, it, expect } from "vitest";
import { classify } from "../src/router/classify.js";
import { route, detectVision } from "../src/router/index.js";
import { estimateTokens, estimateCost, fitsContext } from "../src/router/tokens.js";
import { findModel } from "../src/router/catalog.js";
import type { ChatCompletionRequest } from "../src/types/index.js";

const ALL = new Set(["openai", "anthropic", "gemini"]);
const req = (content: string, extra: Partial<ChatCompletionRequest> = {}): ChatCompletionRequest => ({
  model: "auto",
  messages: [{ role: "user", content }],
  ...extra,
});

describe("classify", () => {
  it("detecta tareas de código", () => {
    expect(classify([{ role: "user", content: "escribe una function en typescript" }])).toBe("code");
    expect(classify([{ role: "user", content: "```js\nconst x=1\n```" }])).toBe("code");
  });
  it("detecta razonamiento", () => {
    expect(classify([{ role: "user", content: "razona paso a paso este teorema matemático complejo" }])).toBe(
      "reasoning",
    );
  });
  it("trata entradas triviales cortas como cheap", () => {
    expect(classify([{ role: "user", content: "hola" }])).toBe("cheap");
  });
  it("clasifica texto largo neutro como chat", () => {
    expect(classify([{ role: "user", content: "x ".repeat(100) }])).toBe("chat");
  });
});

describe("tokens", () => {
  it("estima tokens crecientes con la longitud", () => {
    const a = estimateTokens([{ role: "user", content: "corto" }]);
    const b = estimateTokens([{ role: "user", content: "x".repeat(400) }]);
    expect(b).toBeGreaterThan(a);
  });
  it("calcula coste proporcional a tokens y precio", () => {
    const m = findModel("openai/gpt-4o")!;
    const c = estimateCost(m, 1_000_000, 0);
    expect(c).toBeCloseTo(m.input_per_mtok, 5);
  });
  it("fitsContext rechaza prompts mayores que la ventana", () => {
    const m = findModel("openai/gpt-4o")!;
    expect(fitsContext(m, 10)).toBe(true);
    expect(fitsContext(m, m.context + 1)).toBe(false);
  });
});

describe("detectVision", () => {
  it("detecta data URLs de imagen", () => {
    expect(detectVision([{ role: "user", content: "mira data:image/png;base64,AAA" }])).toBe(true);
  });
  it("detecta content multimodal estilo OpenAI", () => {
    const msgs: any = [{ role: "user", content: [{ type: "image_url", image_url: { url: "x" } }] }];
    expect(detectVision(msgs)).toBe(true);
  });
  it("texto normal no es visión", () => {
    expect(detectVision([{ role: "user", content: "hola" }])).toBe(false);
  });
});

describe("route", () => {
  it("código en balanced va a un modelo capaz", () => {
    const d = route(req("arregla este bug en la function typescript"), ALL, "balanced");
    expect(d.task).toBe("code");
    expect(["anthropic/claude-opus", "anthropic/claude-sonnet", "gemini/pro", "openai/gpt-4o"]).toContain(d.model.id);
  });
  it("cheapest elige el más barato", () => {
    const d = route(req("hola"), ALL, "cheapest");
    // gemini/flash es el más barato del catálogo.
    expect(d.model.id).toBe("gemini/flash");
  });
  it("devuelve un ranking para fallback", () => {
    const d = route(req("hola"), ALL, "balanced");
    expect(d.ranked.length).toBeGreaterThan(1);
    expect(d.ranked[0]).toBe(d.model);
  });
  it("respeta modelo explícito si es viable", () => {
    const d = route(req("hola", { model: "anthropic/claude-sonnet" }), ALL, "balanced");
    expect(d.model.id).toBe("anthropic/claude-sonnet");
    expect(d.reason).toBe("explicit");
  });
  it("si se pide visión, solo elige modelos con visión", () => {
    const d = route(req("describe data:image/png;base64,AAA"), ALL, "cheapest");
    expect(d.needsVision).toBe(true);
    expect(d.model.vision).toBe(true);
  });
  it("lanza si no hay providers", () => {
    expect(() => route(req("hola"), new Set(), "balanced")).toThrow();
  });
  it("un modelo explícito desconocido lanza model_not_found (no sustituye en silencio)", () => {
    try {
      route(req("hola", { model: "no/existe" }), ALL, "balanced");
      throw new Error("debería haber lanzado");
    } catch (e: any) {
      expect(e.code).toBe("model_not_found");
    }
  });
});
