import { describe, it, expect, vi, afterEach } from "vitest";
import { AnthropicProvider } from "../src/providers/anthropic.js";
import { GeminiProvider } from "../src/providers/gemini.js";
import type { ChatCompletionRequest } from "../src/types/index.js";

// Helper: respuesta fetch mockeada (ok=true) con json/text.
function okResponse(json: unknown = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => json,
    text: async () => JSON.stringify(json),
  } as unknown as Response;
}

// Body parseado de la n-ésima llamada al mock de fetch.
function bodyOf(fetchMock: ReturnType<typeof vi.fn>, call = 0): any {
  const init = fetchMock.mock.calls[call][1] as RequestInit;
  return JSON.parse(init.body as string);
}

// Una tool de ejemplo en formato OpenAI.
const weatherTool = {
  type: "function",
  function: {
    name: "get_weather",
    description: "Obtiene el tiempo de una ciudad",
    parameters: {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    },
  },
};

const baseReq = (extra: Partial<ChatCompletionRequest> = {}): ChatCompletionRequest => ({
  model: "x",
  messages: [{ role: "user", content: "¿qué tiempo hace en Madrid?" }],
  ...extra,
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ── ANTHROPIC ──────────────────────────────────────────────────────────────
describe("AnthropicProvider tool-calling", () => {
  it("mapea tools y tool_choice al formato nativo de Anthropic", async () => {
    const fetchMock = vi.fn(async () => okResponse({ content: [{ type: "text", text: "ok" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new AnthropicProvider("k1");
    await provider.complete("claude-x", baseReq({ tools: [weatherTool], tool_choice: "required" }));

    const body = bodyOf(fetchMock);
    expect(body.tools).toEqual([
      {
        name: "get_weather",
        description: "Obtiene el tiempo de una ciudad",
        input_schema: weatherTool.function.parameters,
      },
    ]);
    expect(body.tool_choice).toEqual({ type: "any" });
  });

  it("tool_choice {function:{name}} → {type:'tool', name}", async () => {
    const fetchMock = vi.fn(async () => okResponse({ content: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new AnthropicProvider("k1");
    await provider.complete(
      "claude-x",
      baseReq({ tools: [weatherTool], tool_choice: { type: "function", function: { name: "get_weather" } } }),
    );

    expect(bodyOf(fetchMock).tool_choice).toEqual({ type: "tool", name: "get_weather" });
  });

  it("convierte respuesta con tool_use en message con tool_calls y finish_reason tool_calls", async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({
        stop_reason: "tool_use",
        content: [
          { type: "text", text: "Voy a consultarlo" },
          { type: "tool_use", id: "toolu_1", name: "get_weather", input: { city: "Madrid" } },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new AnthropicProvider("k1");
    const res = await provider.complete("claude-x", baseReq({ tools: [weatherTool] }));

    const choice = res.choices[0];
    expect(choice.finish_reason).toBe("tool_calls");
    expect(choice.message.content).toBe("Voy a consultarlo");
    expect(choice.message.tool_calls).toEqual([
      {
        id: "toolu_1",
        type: "function",
        function: { name: "get_weather", arguments: JSON.stringify({ city: "Madrid" }) },
      },
    ]);
  });

  it("mapea una conversación con assistant tool_calls + role:'tool' sin error", async () => {
    const fetchMock = vi.fn(async () => okResponse({ content: [{ type: "text", text: "hace sol" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new AnthropicProvider("k1");
    await provider.complete(
      "claude-x",
      baseReq({
        messages: [
          { role: "user", content: "¿tiempo en Madrid?" },
          {
            role: "assistant",
            content: "",
            tool_calls: [
              { id: "toolu_1", type: "function", function: { name: "get_weather", arguments: '{"city":"Madrid"}' } },
            ],
          },
          { role: "tool", content: "soleado", tool_call_id: "toolu_1" },
        ],
      }),
    );

    const body = bodyOf(fetchMock);
    // assistant → block tool_use
    const assistant = body.messages.find((m: any) => m.role === "assistant");
    expect(assistant.content).toEqual([
      { type: "tool_use", id: "toolu_1", name: "get_weather", input: { city: "Madrid" } },
    ]);
    // tool → user con block tool_result
    const toolResult = body.messages.find(
      (m: any) => Array.isArray(m.content) && m.content[0]?.type === "tool_result",
    );
    expect(toolResult).toEqual({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "soleado" }],
    });
  });
});

// ── GEMINI ───────────────────────────────────────────────────────────────
describe("GeminiProvider tool-calling", () => {
  it("mapea tools y tool_choice al formato nativo de Gemini", async () => {
    const fetchMock = vi.fn(async () => okResponse({ candidates: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new GeminiProvider("k1");
    await provider.complete("gemini-x", baseReq({ tools: [weatherTool], tool_choice: "required" }));

    const body = bodyOf(fetchMock);
    expect(body.tools).toEqual([
      {
        functionDeclarations: [
          {
            name: "get_weather",
            description: "Obtiene el tiempo de una ciudad",
            parameters: weatherTool.function.parameters,
          },
        ],
      },
    ]);
    expect(body.toolConfig).toEqual({ functionCallingConfig: { mode: "ANY" } });
  });

  it("convierte respuesta con functionCall en tool_calls con id sintético", async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({
        candidates: [
          {
            content: {
              parts: [{ functionCall: { name: "get_weather", args: { city: "Madrid" } } }],
            },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new GeminiProvider("k1");
    const res = await provider.complete("gemini-x", baseReq({ tools: [weatherTool] }));

    const choice = res.choices[0];
    expect(choice.finish_reason).toBe("tool_calls");
    const calls = choice.message.tool_calls as any[];
    expect(calls).toHaveLength(1);
    // El id es sintético y único (Gemini no devuelve id); validamos formato.
    expect(calls[0].id).toMatch(/^call_/);
    expect(calls[0].type).toBe("function");
    expect(calls[0].function).toEqual({
      name: "get_weather",
      arguments: JSON.stringify({ city: "Madrid" }),
    });
  });

  it("mapea una conversación con assistant tool_calls + role:'tool' sin error", async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({ candidates: [{ content: { parts: [{ text: "hace sol" }] } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new GeminiProvider("k1");
    await provider.complete(
      "gemini-x",
      baseReq({
        messages: [
          { role: "user", content: "¿tiempo en Madrid?" },
          {
            role: "assistant",
            content: "",
            tool_calls: [
              { id: "call_0", type: "function", function: { name: "get_weather", arguments: '{"city":"Madrid"}' } },
            ],
          },
          { role: "tool", content: "soleado", name: "get_weather", tool_call_id: "call_0" },
        ],
      }),
    );

    const body = bodyOf(fetchMock);
    const model = body.contents.find((c: any) => c.role === "model");
    expect(model.parts).toEqual([{ functionCall: { name: "get_weather", args: { city: "Madrid" } } }]);
    const fnResp = body.contents.find(
      (c: any) => c.parts[0]?.functionResponse,
    );
    expect(fnResp).toEqual({
      role: "user",
      parts: [{ functionResponse: { name: "get_weather", response: { content: "soleado" } } }],
    });
  });

  it("Gemini multi-turn: resuelve el nombre de función por tool_call_id cuando el mensaje tool no trae name", async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new GeminiProvider("k1");
    await provider.complete(
      "gemini-x",
      baseReq({
        messages: [
          { role: "user", content: "¿tiempo?" },
          {
            role: "assistant",
            content: "",
            tool_calls: [
              { id: "call_xyz", type: "function", function: { name: "get_weather", arguments: "{}" } },
            ],
          },
          // SIN name: solo tool_call_id. Antes mandaba "call_xyz" como nombre y
          // Gemini fallaba; ahora debe resolverse a "get_weather".
          { role: "tool", content: "soleado", tool_call_id: "call_xyz" },
        ],
      }),
    );
    const body = bodyOf(fetchMock);
    const fnResp = body.contents.find((c: any) => c.parts[0]?.functionResponse);
    expect(fnResp.parts[0].functionResponse.name).toBe("get_weather");
  });
});
