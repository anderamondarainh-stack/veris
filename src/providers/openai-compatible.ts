import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  EmbeddingsRequest,
  EmbeddingsResponse,
} from "../types/index.js";
import { type Provider } from "./base.js";

// ─────────────────────────────────────────────────────────────────────────
//  PROVIDER GENÉRICO OPENAI-COMPATIBLE
// ─────────────────────────────────────────────────────────────────────────
//  La mayoría de proveedores hablan el MISMO protocolo que OpenAI
//  (/chat/completions, /embeddings). Con una sola clase + base URL + key
//  soportamos OpenAI, Groq, OpenRouter, DeepSeek, Mistral, xAI, Together,
//  Fireworks, Perplexity y Ollama (local), entre otros.
//
//  Claves de diseño:
//   • PASSTHROUGH REAL: reenviamos el body del cliente tal cual (tools,
//     response_format, top_p, stop, seed...), solo sobreescribiendo `model` y
//     `stream`. Antes se descartaban esos campos y se rompía function-calling.
//   • MULTI-KEY: acepta varias keys (lista) y rota entre ellas (round-robin)
//     para repartir carga/límites entre cuentas del mismo proveedor.

// Campos internos nuestros que NO deben viajar al upstream.
const INTERNAL_FIELDS = new Set(["task_hint"]);

function stripInternal(req: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(req)) {
    if (!INTERNAL_FIELDS.has(k) && v !== undefined) out[k] = v;
  }
  return out;
}

export interface OpenAICompatibleOptions {
  name: string;
  baseUrl: string; // sin barra final, ej. "https://api.groq.com/openai/v1"
  keys: string[]; // puede estar vacío si keyless (p. ej. Ollama local)
  keyless?: boolean; // true = no requiere Authorization (Ollama)
  // Cabeceras extra fijas (p. ej. OpenRouter recomienda HTTP-Referer/X-Title).
  extraHeaders?: Record<string, string>;
}

export class OpenAICompatibleProvider implements Provider {
  readonly name: string;
  private baseUrl: string;
  private keys: string[];
  private keyless: boolean;
  private extraHeaders: Record<string, string>;
  private rr = 0; // cursor round-robin de keys

  constructor(opts: OpenAICompatibleOptions) {
    this.name = opts.name;
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.keys = opts.keys.filter((k) => k && k.trim().length > 0);
    this.keyless = opts.keyless ?? false;
    this.extraHeaders = opts.extraHeaders ?? {};
  }

  isReady(): boolean {
    return this.keyless || this.keys.length > 0;
  }

  /** Nº de keys configuradas (para diagnóstico / balanceo). */
  keyCount(): number {
    return this.keys.length;
  }

  private nextKey(): string | undefined {
    if (this.keys.length === 0) return undefined;
    const k = this.keys[this.rr % this.keys.length];
    this.rr++;
    return k;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.extraHeaders,
    };
    const key = this.nextKey();
    if (key) h.Authorization = `Bearer ${key}`;
    return h;
  }

  async complete(
    upstreamId: string,
    req: ChatCompletionRequest,
  ): Promise<ChatCompletionResponse> {
    const body = { ...stripInternal(req), model: upstreamId, stream: false };
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${this.name} ${res.status}: ${await res.text()}`);
    return (await res.json()) as ChatCompletionResponse;
  }

  async *stream(upstreamId: string, req: ChatCompletionRequest) {
    const body = { ...stripInternal(req), model: upstreamId, stream: true };
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.body) throw new Error(`${this.name} ${res.status}: ${await res.text()}`);

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
          /* ignora líneas parciales del stream */
        }
      }
    }
  }

  async embeddings(
    upstreamId: string,
    req: EmbeddingsRequest,
  ): Promise<EmbeddingsResponse> {
    const body = { ...stripInternal(req), model: upstreamId };
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${this.name} ${res.status}: ${await res.text()}`);
    return (await res.json()) as EmbeddingsResponse;
  }
}
