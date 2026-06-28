import { randomUUID } from "node:crypto";
import type { ChatCompletionRequest, ChatCompletionResponse } from "../types/index.js";
import { buildResponse, type Provider } from "./base.js";

// Provider BYOK de Anthropic. Traduce nuestro formato (OpenAI) al de la
// Messages API de Anthropic y viceversa.
export class AnthropicProvider implements Provider {
  readonly name = "anthropic";
  private base = "https://api.anthropic.com/v1";

  constructor(private apiKey: string | undefined) {}

  isReady() {
    return !!this.apiKey;
  }

  private headers() {
    return {
      "Content-Type": "application/json",
      "x-api-key": this.apiKey ?? "",
      "anthropic-version": "2023-06-01",
    };
  }

  // Mapea las tools de OpenAI → formato Anthropic (input_schema en vez de
  // parameters). Devuelve undefined si no hay tools.
  private toAnthropicTools(tools: unknown): unknown[] | undefined {
    if (!Array.isArray(tools) || tools.length === 0) return undefined;
    return tools.map((t: any) => ({
      name: t.function?.name,
      description: t.function?.description,
      input_schema: t.function?.parameters ?? { type: "object", properties: {} },
    }));
  }

  // Mapea tool_choice de OpenAI → formato Anthropic.
  private toAnthropicToolChoice(choice: unknown): unknown {
    if (choice === "auto") return { type: "auto" };
    if (choice === "required") return { type: "any" };
    // "none" → no forzar nada (no enviamos tool_choice; las tools se omiten aparte).
    if (choice === "none") return undefined;
    if (choice && typeof choice === "object") {
      const name = (choice as any).function?.name;
      if (name) return { type: "tool", name };
    }
    return undefined;
  }

  // Anthropic separa el system prompt del array de mensajes. Además, los
  // tool_calls del assistant y los mensajes role:"tool" se traducen a content
  // blocks (tool_use / tool_result).
  private toAnthropic(req: ChatCompletionRequest) {
    const system = req.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n");

    const messages: Array<{ role: string; content: unknown }> = [];
    for (const m of req.messages) {
      if (m.role === "tool") {
        // Resultado de herramienta → user message con block tool_result.
        messages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: m.tool_call_id,
              content: m.content,
            },
          ],
        });
        continue;
      }
      if (m.role === "user") {
        messages.push({ role: "user", content: m.content });
        continue;
      }
      if (m.role === "assistant") {
        const toolCalls = (m as any).tool_calls;
        if (Array.isArray(toolCalls) && toolCalls.length > 0) {
          // assistant con llamadas → blocks (texto opcional + tool_use).
          const blocks: unknown[] = [];
          if (m.content) blocks.push({ type: "text", text: m.content });
          for (const tc of toolCalls) {
            let input: unknown = {};
            try {
              input = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
            } catch {
              input = {};
            }
            blocks.push({ type: "tool_use", id: tc.id, name: tc.function?.name, input });
          }
          messages.push({ role: "assistant", content: blocks });
        } else {
          messages.push({ role: "assistant", content: m.content });
        }
        continue;
      }
      // system ya se extrajo arriba; se ignora aquí.
    }

    return { system, messages };
  }

  async complete(
    upstreamId: string,
    req: ChatCompletionRequest,
  ): Promise<ChatCompletionResponse> {
    const { system, messages } = this.toAnthropic(req);
    // Si tool_choice es "none" omitimos las tools para no forzar su uso.
    const tools =
      req.tool_choice === "none" ? undefined : this.toAnthropicTools(req.tools);
    const res = await fetch(`${this.base}/messages`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: upstreamId,
        system: system || undefined,
        messages,
        max_tokens: req.max_tokens ?? 4096,
        temperature: req.temperature,
        top_p: req.top_p,
        stop_sequences: typeof req.stop === "string" ? [req.stop] : req.stop,
        tools,
        tool_choice: tools ? this.toAnthropicToolChoice(req.tool_choice) : undefined,
      }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    const json: any = await res.json();
    const blocks: any[] = json.content ?? [];
    const text = blocks
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");

    // Usa el usage REAL que devuelve Anthropic (input/output_tokens). Importante
    // para el coste: una respuesta solo-tool_use tiene content vacío y, sin
    // esto, se estimaría 0 tokens de salida.
    const usage = json.usage
      ? {
          prompt_tokens: json.usage.input_tokens ?? 0,
          completion_tokens: json.usage.output_tokens ?? 0,
          total_tokens: (json.usage.input_tokens ?? 0) + (json.usage.output_tokens ?? 0),
        }
      : undefined;

    // Si la respuesta trae bloques tool_use, construimos a mano un message
    // OpenAI con tool_calls (buildResponse no soporta tool_calls).
    const toolUse = blocks.filter((b: any) => b.type === "tool_use");
    if (toolUse.length > 0) {
      const tool_calls = toolUse.map((b: any) => ({
        id: b.id,
        type: "function" as const,
        function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
      }));
      return {
        id: `chatcmpl-veris-${randomUUID()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: upstreamId,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: text,
              tool_calls,
            },
            finish_reason: json.stop_reason === "tool_use" ? "tool_calls" : "stop",
          },
        ],
        usage,
      };
    }

    return buildResponse(upstreamId, text, usage);
  }

  // LIMITACIÓN: el streaming de tool-calls queda FUERA DE ALCANCE. Este stream
  // solo emite el texto incremental (content_block_delta de tipo text). Los
  // bloques tool_use que lleguen en streaming se ignoran; para function-calling
  // usa el path no-streaming complete().
  async *stream(upstreamId: string, req: ChatCompletionRequest) {
    const { system, messages } = this.toAnthropic(req);
    // Reenviamos tools/tool_choice también en streaming: si no, el modelo no
    // sabría que hay herramientas y cambiaría de comportamiento en silencio.
    const tools = req.tool_choice === "none" ? undefined : this.toAnthropicTools(req.tools);
    const res = await fetch(`${this.base}/messages`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: upstreamId,
        system: system || undefined,
        messages,
        max_tokens: req.max_tokens ?? 4096,
        temperature: req.temperature,
        top_p: req.top_p,
        stop_sequences: typeof req.stop === "string" ? [req.stop] : req.stop,
        tools,
        tool_choice: tools ? this.toAnthropicToolChoice(req.tool_choice) : undefined,
        stream: true,
      }),
    });
    if (!res.ok || !res.body) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    try {
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
            if (json.type === "content_block_delta" && json.delta?.text) {
              yield json.delta.text as string;
            }
          } catch {
            /* ignora líneas parciales del stream */
          }
        }
      }
    } finally {
      reader.cancel().catch(() => {});
    }
  }
}
