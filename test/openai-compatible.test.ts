import { describe, it, expect, vi, afterEach } from "vitest";
import { OpenAICompatibleProvider } from "../src/providers/openai-compatible.js";
import type { ChatCompletionRequest, EmbeddingsRequest } from "../src/types/index.js";

// Respuesta fetch mockeada genérica (ok=true) con json/text.
function okResponse(json: unknown = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => json,
    text: async () => JSON.stringify(json),
  } as unknown as Response;
}

function errorResponse(status: number, text = "rate limited") {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => text,
  } as unknown as Response;
}

// Devuelve el body parseado de la n-ésima llamada al mock de fetch.
function bodyOf(fetchMock: ReturnType<typeof vi.fn>, call = 0): any {
  const init = fetchMock.mock.calls[call][1] as RequestInit;
  return JSON.parse(init.body as string);
}

function headersOf(fetchMock: ReturnType<typeof vi.fn>, call = 0): Record<string, string> {
  const init = fetchMock.mock.calls[call][1] as RequestInit;
  return init.headers as Record<string, string>;
}

const chatReq = (extra: Partial<ChatCompletionRequest> = {}): ChatCompletionRequest => ({
  model: "ignorado-por-el-cliente",
  messages: [{ role: "user", content: "hola" }],
  ...extra,
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("OpenAICompatibleProvider passthrough", () => {
  it("reenvía campos arbitrarios y elimina task_hint, fijando model y stream:false", async () => {
    const fetchMock = vi.fn(async () => okResponse({ id: "x" }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAICompatibleProvider({
      name: "groq",
      baseUrl: "https://api.groq.com/openai/v1",
      keys: ["k1"],
    });

    await provider.complete("llama-3.3-70b-versatile", chatReq({
      tools: [{ type: "function", function: { name: "f" } }],
      response_format: { type: "json_object" },
      top_p: 0.9,
      task_hint: "code",
    }));

    const body = bodyOf(fetchMock);
    expect(body.tools).toEqual([{ type: "function", function: { name: "f" } }]);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.top_p).toBe(0.9);
    expect(body.task_hint).toBeUndefined();
    expect(body.model).toBe("llama-3.3-70b-versatile");
    expect(body.stream).toBe(false);

    // El endpoint correcto.
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.groq.com/openai/v1/chat/completions");
  });
});

describe("OpenAICompatibleProvider multi-key round-robin", () => {
  it("rota las keys entre llamadas (k1 luego k2)", async () => {
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAICompatibleProvider({
      name: "openai",
      baseUrl: "https://api.openai.com/v1",
      keys: ["k1", "k2"],
    });

    await provider.complete("gpt-4o", chatReq());
    await provider.complete("gpt-4o", chatReq());

    expect(headersOf(fetchMock, 0).Authorization).toBe("Bearer k1");
    expect(headersOf(fetchMock, 1).Authorization).toBe("Bearer k2");
  });
});

describe("OpenAICompatibleProvider keyless (Ollama)", () => {
  it("isReady es true sin keys y no manda Authorization", async () => {
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAICompatibleProvider({
      name: "ollama",
      baseUrl: "http://localhost:11434/v1",
      keys: [],
      keyless: true,
    });

    expect(provider.isReady()).toBe(true);

    await provider.complete("llama3.1", chatReq());
    expect(headersOf(fetchMock, 0).Authorization).toBeUndefined();
  });
});

describe("OpenAICompatibleProvider embeddings", () => {
  it("hace POST a /embeddings con el model override", async () => {
    const fetchMock = vi.fn(async () => okResponse({ object: "list", data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAICompatibleProvider({
      name: "openai",
      baseUrl: "https://api.openai.com/v1",
      keys: ["k1"],
    });

    const req: EmbeddingsRequest = { model: "loquesea", input: "texto" };
    await provider.embeddings("text-embedding-3-small", req);

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.openai.com/v1/embeddings");
    const body = bodyOf(fetchMock);
    expect(body.model).toBe("text-embedding-3-small");
    expect(body.input).toBe("texto");
  });
});

describe("OpenAICompatibleProvider error", () => {
  it("lanza con el status en el mensaje si fetch responde !ok", async () => {
    const fetchMock = vi.fn(async () => errorResponse(429, "slow down"));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAICompatibleProvider({
      name: "groq",
      baseUrl: "https://api.groq.com/openai/v1",
      keys: ["k1"],
    });

    await expect(provider.complete("gpt-4o", chatReq())).rejects.toThrow(/429/);
  });
});
