import type { ChatCompletionRequest, ChatCompletionResponse } from "./types/index.js";

// Caché TTL en memoria para completions NO-streaming idénticas. Clave = hash
// estable del request (modelo + mensajes + params). Ahorra dinero y latencia en
// prompts repetidos (muy común en pipelines). Streaming no se cachea.

function canonical(req: ChatCompletionRequest): string {
  // Incluimos TODOS los campos que cambian la respuesta. Omitir tools/
  // response_format/stop/n provocaría servir una respuesta de texto cacheada a
  // una request que pide tool_calls o JSON mode (cache poisoning silencioso).
  return JSON.stringify({
    model: req.model,
    temperature: req.temperature ?? null,
    max_tokens: req.max_tokens ?? null,
    top_p: req.top_p ?? null,
    stop: req.stop ?? null,
    n: req.n ?? null,
    tools: req.tools ?? null,
    tool_choice: req.tool_choice ?? null,
    response_format: req.response_format ?? null,
    messages: req.messages.map((m) => [m.role, m.content, m.name ?? null, m.tool_call_id ?? null]),
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
  // Techo de entradas para que la caché no crezca sin límite con TTL alto.
  // Map mantiene orden de inserción → al superar el techo desalojamos la más
  // antigua (FIFO, aproximación a LRU suficiente para este caso).
  constructor(
    private ttlSeconds: number,
    private maxEntries = 5000,
  ) {}

  enabled(): boolean {
    return this.ttlSeconds > 0;
  }

  // `nowMs` inyectable para tests deterministas.
  get(req: ChatCompletionRequest, nowMs = Date.now()): ChatCompletionResponse | undefined {
    if (!this.enabled()) return undefined;
    const canon = canonical(req);
    const key = stableKey(canon);
    const e = this.store.get(key);
    if (!e) return undefined;
    if (e.expiresAtMs <= nowMs) {
      this.store.delete(key);
      return undefined;
    }
    if (e.canon !== canon) return undefined; // colisión de hash → no servir
    return e.value;
  }

  set(req: ChatCompletionRequest, value: ChatCompletionResponse, nowMs = Date.now()): void {
    if (!this.enabled()) return;
    const canon = canonical(req);
    const key = stableKey(canon);
    this.store.delete(key); // reinserta al final para refrescar el orden
    this.store.set(key, { canon, value, expiresAtMs: nowMs + this.ttlSeconds * 1000 });
    if (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
  }
}
