import { describe, it, expect } from "vitest";
import { route, routeEmbeddings } from "../src/router/index.js";
import type { ChatCompletionRequest } from "../src/types/index.js";

const chatReq = (content: string, extra: Partial<ChatCompletionRequest> = {}): ChatCompletionRequest => ({
  model: "auto",
  messages: [{ role: "user", content }],
  ...extra,
});

describe("routeEmbeddings", () => {
  it("respeta un modelo de embeddings explícito disponible", () => {
    const m = routeEmbeddings("openai/text-embedding-3-large", new Set(["openai"]));
    expect(m.id).toBe("openai/text-embedding-3-large");
  });

  it("con 'auto' elige el embedding más barato disponible", () => {
    const m = routeEmbeddings("auto", new Set(["openai"]));
    // text-embedding-3-small (0.02) es más barato que -large (0.13).
    expect(m.id).toBe("openai/text-embedding-3-small");
  });

  it("cae a 'auto' si el modelo explícito no es de embeddings", () => {
    const m = routeEmbeddings("openai/gpt-4o", new Set(["openai"]));
    expect(m.kind).toBe("embedding");
  });

  it("lanza si no hay ningún embedding disponible", () => {
    expect(() => routeEmbeddings("auto", new Set(["groq"]))).toThrow();
    expect(() => routeEmbeddings("auto", new Set())).toThrow();
  });
});

describe("route (chat) nunca devuelve embeddings", () => {
  it("el modelo elegido no tiene kind 'embedding'", () => {
    const d = route(chatReq("hola"), new Set(["openai"]), "cheapest");
    expect(d.model.kind).not.toBe("embedding");
    expect(d.ranked.every((m) => m.kind !== "embedding")).toBe(true);
  });

  it("un modelo de embeddings explícito no se enruta a chat (cae a auto)", () => {
    const d = route(chatReq("hola", { model: "openai/text-embedding-3-small" }), new Set(["openai"]), "cheapest");
    expect(d.model.kind).not.toBe("embedding");
    expect(d.reason).not.toBe("explicit");
  });
});
