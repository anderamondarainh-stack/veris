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

  // Anthropic separa el system prompt del array de mensajes.
  private toAnthropic(req: ChatCompletionRequest) {
    const system = req.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n");
    const messages = req.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: m.content }));
    return { system, messages };
  }

  async complete(
    upstreamId: string,
    req: ChatCompletionRequest,
  ): Promise<ChatCompletionResponse> {
    const { system, messages } = this.toAnthropic(req);
    const res = await fetch(`${this.base}/messages`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: upstreamId,
        system: system || undefined,
        messages,
        max_tokens: req.max_tokens ?? 4096,
        temperature: req.temperature,
      }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    const json: any = await res.json();
    const text = (json.content ?? [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");
    return buildResponse(upstreamId, text);
  }

  async *stream(upstreamId: string, req: ChatCompletionRequest) {
    const { system, messages } = this.toAnthropic(req);
    const res = await fetch(`${this.base}/messages`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: upstreamId,
        system: system || undefined,
        messages,
        max_tokens: req.max_tokens ?? 4096,
        temperature: req.temperature,
        stream: true,
      }),
    });
    if (!res.ok || !res.body) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);

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
          if (json.type === "content_block_delta" && json.delta?.text) {
            yield json.delta.text as string;
          }
        } catch {
          /* ignora */
        }
      }
    }
  }
}
