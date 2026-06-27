import type { ChatCompletionRequest, ChatCompletionResponse } from "./types/index.js";

// Caché TTL en memoria para completions NO-streaming idénticas. Clave = hash
// estable del request (modelo + mensajes + params). Ahorra dinero y latencia en
// prompts repetidos (muy común en pipelines). Streaming no se cachea.

function canonical(req: ChatCompletionRequest): string {
  return JSON.stringify({
    model: req.model,
    temperature: req.temperature ?? null,
    max_tokens: req.max_tokens ?? null,
    messages: req.messages.map((m) => [m.role, m.content]),
  });
}

function stableKey(canon: string): string {
  // Hash FNV-1a de 32 bits para indexar barato. NO confiamos solo en el hash:
  // guardamos la cadena canónica y la verificamos en `get` para descartar
  // colisiones (un hash de 32 bits colisiona ~1% con 10k entradas).
  let h = 0x811c9dc5;
  for (let i = 0; i < canon.length; i++) {
    h ^= canon.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

interface Entry {
  canon: string; // cadena canónica original, para verificar contra colisiones
  value: ChatCompletionResponse;
  expiresAtMs: number;
}

export class ResponseCache {
  private store = new Map<string, Entry>();
  constructor(private ttlSeconds: number) {}

  enabled(): boolean {
    return this.ttlSeconds > 0;
  }

  // `nowMs` inyectable para tests deterministas.
  get(req: ChatCompletionRequest, nowMs = Date.now()): ChatCompletionResponse | undefined {
    if (!this.enabled()) return undefined;
    const canon = canonical(req);
    const e = this.store.get(stableKey(canon));
    if (!e) return undefined;
    if (e.expiresAtMs <= nowMs) {
      this.store.delete(stableKey(canon));
      return undefined;
    }
    if (e.canon !== canon) return undefined; // colisión de hash → no servir
    return e.value;
  }

  set(req: ChatCompletionRequest, value: ChatCompletionResponse, nowMs = Date.now()): void {
    if (!this.enabled()) return;
    const canon = canonical(req);
    this.store.set(stableKey(canon), { canon, value, expiresAtMs: nowMs + this.ttlSeconds * 1000 });
  }
}
