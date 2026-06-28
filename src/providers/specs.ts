// Catálogo de proveedores OpenAI-compatible: todos hablan el mismo protocolo,
// así que solo necesitamos base URL + de qué variable de entorno sale la(s)
// key(s). Añadir un proveedor nuevo = una línea aquí.
//
// Multi-key: la variable de entorno puede llevar varias keys separadas por
// comas; el provider rota entre ellas (round-robin) para repartir límites.

export interface ProviderSpec {
  name: string;
  envKey: string; // variable con la(s) API key(s), separadas por coma
  baseUrl: string;
  baseUrlEnv?: string; // variable opcional para override de base URL
  keyless?: boolean; // no requiere Authorization (p. ej. Ollama local)
  extraHeaders?: Record<string, string>;
}

export const OPENAI_COMPATIBLE_SPECS: ProviderSpec[] = [
  { name: "openai", envKey: "OPENAI_API_KEY", baseUrl: "https://api.openai.com/v1", baseUrlEnv: "OPENAI_BASE_URL" },
  { name: "groq", envKey: "GROQ_API_KEY", baseUrl: "https://api.groq.com/openai/v1" },
  { name: "deepseek", envKey: "DEEPSEEK_API_KEY", baseUrl: "https://api.deepseek.com/v1" },
  { name: "mistral", envKey: "MISTRAL_API_KEY", baseUrl: "https://api.mistral.ai/v1" },
  { name: "xai", envKey: "XAI_API_KEY", baseUrl: "https://api.x.ai/v1" },
  { name: "together", envKey: "TOGETHER_API_KEY", baseUrl: "https://api.together.xyz/v1" },
  { name: "perplexity", envKey: "PERPLEXITY_API_KEY", baseUrl: "https://api.perplexity.ai" },
  {
    name: "openrouter",
    envKey: "OPENROUTER_API_KEY",
    baseUrl: "https://openrouter.ai/api/v1",
    extraHeaders: { "HTTP-Referer": "https://github.com/anderamondarainh-stack/veris", "X-Title": "Veris" },
  },
  // Local-first: modelos en tu máquina vía Ollama (sin coste, sin key).
  { name: "ollama", envKey: "", baseUrl: "http://localhost:11434/v1", baseUrlEnv: "OLLAMA_BASE_URL", keyless: true },
];

// Parsea una variable con varias keys separadas por comas.
export function parseKeys(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}
