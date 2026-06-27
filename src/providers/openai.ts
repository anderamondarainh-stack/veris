import type { ChatCompletionRequest, ChatCompletionResponse } from "../types/index.js";
import { type Provider } from "./base.js";

// Provider BYOK de OpenAI. Habla el API nativo de OpenAI, que ya es
// exactamente nuestro formato, así que es casi un passthrough.
export class OpenAIProvider implements Provider {
  readonly name = "openai";
  private base = "https://api.openai.com/v1";

  constructor(private apiKey: string | undefined) {}

  isReady() {
    return !!this.apiKey;
  }

  private headers() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  async complete(
    upstreamId: string,
    req: ChatCompletionRequest,
  ): Promise<ChatCompletionResponse> {
    const res = await fetch(`${this.base}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: upstreamId,
        messages: req.messages,
        temperature: req.temperature,
        max_tokens: req.max_tokens,
        stream: false,
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
    return (await res.json()) as ChatCompletionResponse;
  }

  async *stream(upstreamId: string, req: ChatCompletionRequest) {
    const res = await fetch(`${this.base}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: upstreamId,
        messages: req.messages,
        temperature: req.temperature,
        max_tokens: req.max_tokens,
        stream: true,
      }),
    });
    if (!res.ok || !res.body) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);

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
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") return;
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) yield delta as string;
        } catch {
          /* ignora líneas parciales */
        }
      }
    }
  }
}
