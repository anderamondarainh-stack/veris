// Tipos compartidos del gateway. Mantenemos compatibilidad con el formato
// de OpenAI Chat Completions para que cualquier cliente OpenAI SDK funcione.

export type Role = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: Role;
  content: string;
  name?: string;
  // Function/tool-calling (formato OpenAI). En un assistant message lleva las
  // llamadas a herramientas; en un message role:"tool" enlaza la respuesta con
  // la llamada previa vía tool_call_id.
  tool_calls?: unknown;
  tool_call_id?: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  // Parámetros estándar de OpenAI que reenviamos tal cual (passthrough). Antes
  // se descartaban silenciosamente, lo que rompía function-calling, JSON mode,
  // etc. en apps reales.
  tools?: unknown;
  tool_choice?: unknown;
  response_format?: unknown;
  top_p?: number;
  stop?: unknown;
  seed?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  n?: number;
  user?: string;
  // Extensión propia: pista de tarea para el router. Opcional.
  // Si no se envía, el router la infiere.
  task_hint?: TaskKind;
  // Cualquier otro campo que el cliente envíe se reenvía sin tocar.
  [k: string]: unknown;
}

// ── Embeddings (OpenAI-compatible) ─────────────────────────────────────────
export interface EmbeddingsRequest {
  model: string;
  input: string | string[];
  [k: string]: unknown;
}

export interface EmbeddingsResponse {
  object: "list";
  data: Array<{ object: "embedding"; embedding: number[]; index: number }>;
  model: string;
  usage?: { prompt_tokens: number; total_tokens: number };
}

export type TaskKind =
  | "code"        // generar/editar código
  | "reasoning"   // razonamiento complejo, matemáticas, planificación
  | "chat"        // conversación general, redacción
  | "vision"      // entrada con imágenes
  | "cheap";      // tareas triviales (clasificar, extraer, formatear)

export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: { role?: Role; content?: string };
    finish_reason: string | null;
  }>;
}

export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: ChatMessage & { tool_calls?: unknown };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// Capacidades y coste de cada modelo del catálogo. Lo usa el router.
export interface ModelSpec {
  id: string;              // id canónico, ej. "openai/gpt-4o-mini"
  provider: string;        // "openai" | "anthropic" | "gemini" | "groq" | ...
  upstreamId: string;      // id real que espera el proveedor
  good_at: TaskKind[];     // para qué destaca
  // Coste por millón de tokens (USD). Sirve para ordenar por precio.
  input_per_mtok: number;
  output_per_mtok: number;
  context: number;         // ventana de contexto
  vision: boolean;
  kind?: "chat" | "embedding"; // por defecto "chat"
}
