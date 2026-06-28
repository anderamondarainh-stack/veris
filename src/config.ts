import type { RouterStrategy } from "./router/index.js";

// Configuración centralizada y tipada. Una sola fuente de verdad leída del
// entorno al arrancar, en vez de process.env esparcido por el código.

export interface Config {
  port: number;
  strategy: RouterStrategy;
  // Si está definido, el gateway exige `Authorization: Bearer <gatewayApiKey>`.
  // Protege tu gateway local de que otra cosa en tu máquina lo use.
  gatewayApiKey?: string;
  // Resiliencia: reintentos y fallback entre providers.
  maxRetries: number;
  retryBaseMs: number;
  enableFallback: boolean;
  // Caché de respuestas idénticas (TTL en segundos; 0 = desactivada).
  cacheTtlSeconds: number;
  // Tope de gasto acumulado en USD. Si se supera, /v1/chat responde 402.
  // 0 = sin tope.
  spendCapUsd: number;
  // Fichero JSON opcional para añadir/corregir modelos del catálogo.
  modelsFile?: string;
  // Observabilidad.
  logRequests: boolean;
  metricsEnabled: boolean;
  accountProviderEnabled: boolean;
  masterKey?: string;
}

function int(v: string | undefined, def: number): number {
  const n = Number(v);
  return Number.isFinite(n) && v !== undefined && v !== "" ? n : def;
}
function bool(v: string | undefined, def = false): boolean {
  if (v === undefined) return def;
  return v === "true" || v === "1" || v === "yes";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: int(env.PORT, 8787),
    strategy: (env.ROUTER_STRATEGY as RouterStrategy) ?? "balanced",
    gatewayApiKey: env.BYOA_GATEWAY_KEY || undefined,
    maxRetries: int(env.BYOA_MAX_RETRIES, 2),
    retryBaseMs: int(env.BYOA_RETRY_BASE_MS, 250),
    enableFallback: bool(env.BYOA_FALLBACK, true),
    cacheTtlSeconds: int(env.BYOA_CACHE_TTL, 0),
    spendCapUsd: int(env.BYOA_SPEND_CAP_USD, 0),
    modelsFile: env.MODELS_FILE || undefined,
    logRequests: bool(env.BYOA_LOG, true),
    metricsEnabled: bool(env.BYOA_METRICS, true),
    accountProviderEnabled: bool(env.ACCOUNT_PROVIDER_ENABLED, false),
    masterKey: env.BYOA_MASTER_KEY || undefined,
  };
}
