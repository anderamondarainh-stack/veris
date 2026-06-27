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

  private toGemini(req: ChatCompletionRequest) {
    const systemText = req.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n");
    const contents = req.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));
    return {
      contents,
      systemInstruction: systemText ? { parts: [{ text: systemText }] } : undefined,
      generationConfig: {
        temperature: req.temperature,
        maxOutputTokens: req.max_tokens,
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
    const text =
      json.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "";
    return buildResponse(upstreamId, text);
  }

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
