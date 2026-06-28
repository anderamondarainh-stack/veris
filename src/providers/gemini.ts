import type { ChatCompletionRequest, ChatCompletionResponse } from "../types/index.js";
import { buildResponse, type Provider } from "./base.js";

// Provider BYOK de Google Gemini. Traduce al formato generateContent.
export class GeminiProvider implements Provider {
  readonly name = "gemini";
  private base = "https://generativelanguage.googleapis.com/v1beta";

  constructor(private apiKey: string | undefined) {}

  isReady() {
    return !!this.apiKey;
  }

  // Mapea las tools de OpenAI → functionDeclarations de Gemini.
  private toGeminiTools(tools: unknown): unknown[] | undefined {
    if (!Array.isArray(tools) || tools.length === 0) return undefined;
    return [
      {
        functionDeclarations: tools.map((t: any) => ({
          name: t.function?.name,
          description: t.function?.description,
          parameters: t.function?.parameters,
        })),
      },
    ];
  }

  // Mapea tool_choice de OpenAI → toolConfig.functionCallingConfig.mode.
  private toGeminiToolConfig(choice: unknown): unknown {
    let mode: string | undefined;
    if (choice === "auto") mode = "AUTO";
    else if (choice === "required") mode = "ANY";
    else if (choice === "none") mode = "NONE";
    else if (choice && typeof choice === "object") {
      // {function:{name}} → fuerza herramienta(s) concretas con ANY.
      const name = (choice as any).function?.name;
      if (name) {
        return {
          functionCallingConfig: { mode: "ANY", allowedFunctionNames: [name] },
        };
      }
    }
    if (!mode) return undefined;
    return { functionCallingConfig: { mode } };
  }

  private toGemini(req: ChatCompletionRequest) {
    const systemText = req.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n");

    // Gemini exige en functionResponse el NOMBRE de la función, pero un mensaje
    // role:"tool" de OpenAI solo trae tool_call_id. Construimos un índice
    // id→nombre a partir de los tool_calls de los assistant previos.
    const idToName = new Map<string, string>();
    for (const m of req.messages) {
      const calls = (m as any).tool_calls;
      if (Array.isArray(calls)) {
        for (const tc of calls) if (tc?.id && tc.function?.name) idToName.set(tc.id, tc.function.name);
      }
    }

    const contents: Array<{ role: string; parts: unknown[] }> = [];
    for (const m of req.messages) {
      if (m.role === "system") continue;
      if (m.role === "tool") {
        // Resultado de herramienta → functionResponse con el nombre real de la
        // función (buscado por tool_call_id); fallbacks si no se encuentra.
        const fnName =
          m.name ?? (m.tool_call_id ? idToName.get(m.tool_call_id) : undefined) ?? m.tool_call_id ?? "tool";
        contents.push({
          role: "user",
          parts: [{ functionResponse: { name: fnName, response: { content: m.content } } }],
        });
        continue;
      }
      if (m.role === "assistant") {
        const toolCalls = (m as any).tool_calls;
        if (Array.isArray(toolCalls) && toolCalls.length > 0) {
          const parts: unknown[] = [];
          if (m.content) parts.push({ text: m.content });
          for (const tc of toolCalls) {
            let args: unknown = {};
            try {
              args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
            } catch {
              args = {};
            }
            parts.push({ functionCall: { name: tc.function?.name, args } });
          }
          contents.push({ role: "model", parts });
        } else {
          contents.push({ role: "model", parts: [{ text: m.content }] });
        }
        continue;
      }
      // user
      contents.push({ role: "user", parts: [{ text: m.content }] });
    }

    const tools = req.tool_choice === "none" ? undefined : this.toGeminiTools(req.tools);
    return {
      contents,
      systemInstruction: systemText ? { parts: [{ text: systemText }] } : undefined,
      tools,
      toolConfig: tools ? this.toGeminiToolConfig(req.tool_choice) : undefined,
      generationConfig: {
        temperature: req.temperature,
        maxOutputTokens: req.max_tokens,
        topP: req.top_p,
        stopSequences: typeof req.stop === "string" ? [req.stop] : (req.stop as string[] | undefined),
      },
    };
  }

  async complete(
    upstreamId: string,
    req: ChatCompletionRequest,
  ): Promise<ChatCompletionResponse> {
    const res = await fetch(
      `${this.base}/models/${upstreamId}:generateContent?key=${this.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(this.toGemini(req)),
      },
    );
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
    const json: any = await res.json();
    const parts: any[] = json.candidates?.[0]?.content?.parts ?? [];
    const text = parts
      .filter((p: any) => typeof p.text === "string")
      .map((p: any) => p.text)
      .join("");

    // Si hay functionCall(s), construimos un message OpenAI con tool_calls.
    // Gemini no devuelve id de llamada, así que generamos uno sintético.
    const calls = parts.filter((p: any) => p.functionCall);
    if (calls.length > 0) {
      const uniq = Math.random().toString(36).slice(2, 8);
      const tool_calls = calls.map((p: any, i: number) => ({
        id: `call_${uniq}_${i}`,
        type: "function" as const,
        function: {
          name: p.functionCall.name,
          arguments: JSON.stringify(p.functionCall.args ?? {}),
        },
      }));
      return {
        id: `chatcmpl-byoa-${Math.round(performance.now())}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: upstreamId,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: text, tool_calls },
            finish_reason: "tool_calls",
          },
        ],
      };
    }

    return buildResponse(upstreamId, text);
  }

  // LIMITACIÓN: el streaming de tool-calls queda FUERA DE ALCANCE. Este stream
  // solo emite el texto incremental; los parts con functionCall que lleguen en
  // streaming se ignoran. Para function-calling usa el path no-streaming.
  async *stream(upstreamId: string, req: ChatCompletionRequest) {
    const res = await fetch(
      `${this.base}/models/${upstreamId}:streamGenerateContent?alt=sse&key=${this.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(this.toGemini(req)),
      },
    );
    if (!res.ok || !res.body) throw new Error(`Gemini ${res.status}: ${await res.text()}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        try {
          const json = JSON.parse(trimmed.slice(5).trim());
          const text = json.candidates?.[0]?.content?.parts
            ?.map((p: any) => p.text)
            .join("");
          if (text) yield text as string;
        } catch {
          /* ignora */
        }
      }
    }
  }
}
