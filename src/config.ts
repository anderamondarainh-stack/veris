import type { RouterStrategy } from "./router/index.js";

// Configuración centralizada y tipada. Una sola fuente de verdad leída del
// entorno al arrancar, en vez de process.env esparcido por el código.
//
// Naming: las variables canónicas usan el prefijo VERIS_. Se aceptan los
// nombres antiguos BYOA_ como alias (compatibilidad) — VERIS_ tiene prioridad.

export interface Config {
  port: number;
  strategy: RouterStrategy;
  // Si está definido, el gateway exige `Authorization: Bearer <gatewayApiKey>`.
  gatewayApiKey?: string;
  maxRetries: number;
  retryBaseMs: number;
  enableFallback: boolean;
  cacheTtlSeconds: number;
  // Tope de gasto acumulado en USD (admite decimales). 0 = sin tope.
  spendCapUsd: number;
  modelsFile?: string;
  logRequests: boolean;
  metricsEnabled: boolean;
  accountProviderEnabled: boolean;
  // Virtual keys (multi-tenant): si está activo, sustituye a gatewayApiKey en /v1/*.
  virtualKeysEnabled: boolean;
  adminKey?: string;
  vkeysFile?: string;
}

const STRATEGIES: RouterStrategy[] = ["cheapest", "best", "balanced"];

// Lee la primera variable definida de una lista (VERIS_ canónica, BYOA_ alias).
function pick(env: NodeJS.ProcessEnv, ...names: string[]): string | undefined {
  for (const n of names) {
    const v = env[n];
    if (v !== undefined && v !== "") return v;
  }
  return undefined;
}

// Entero (truncado). Para puertos, reintentos, TTL, rpm.
function int(v: string | undefined, def: number): number {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) ? Math.trunc(n) : def;
}
// Número con decimales. Para importes en USD.
function num(v: string | undefined, def: number): number {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) ? n : def;
}
function bool(v: string | undefined, def = false): boolean {
  if (v === undefined || v === "") return def;
  return v === "true" || v === "1" || v === "yes";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const rawStrategy = pick(env, "VERIS_ROUTER_STRATEGY", "ROUTER_STRATEGY");
  let strategy: RouterStrategy = "balanced";
  if (rawStrategy) {
    if (STRATEGIES.includes(rawStrategy as RouterStrategy)) strategy = rawStrategy as RouterStrategy;
    else console.warn(`  ⚠️  ROUTER_STRATEGY inválida "${rawStrategy}"; usando "balanced".`);
  }

  return {
    port: int(pick(env, "PORT"), 8787),
    strategy,
    gatewayApiKey: pick(env, "VERIS_GATEWAY_KEY", "BYOA_GATEWAY_KEY"),
    maxRetries: int(pick(env, "VERIS_MAX_RETRIES", "BYOA_MAX_RETRIES"), 2),
    retryBaseMs: int(pick(env, "VERIS_RETRY_BASE_MS", "BYOA_RETRY_BASE_MS"), 250),
    enableFallback: bool(pick(env, "VERIS_FALLBACK", "BYOA_FALLBACK"), true),
    cacheTtlSeconds: int(pick(env, "VERIS_CACHE_TTL", "BYOA_CACHE_TTL"), 0),
    spendCapUsd: num(pick(env, "VERIS_SPEND_CAP_USD", "BYOA_SPEND_CAP_USD"), 0),
    modelsFile: pick(env, "VERIS_MODELS_FILE", "MODELS_FILE"),
    logRequests: bool(pick(env, "VERIS_LOG", "BYOA_LOG"), true),
    metricsEnabled: bool(pick(env, "VERIS_METRICS", "BYOA_METRICS"), true),
    accountProviderEnabled: bool(pick(env, "ACCOUNT_PROVIDER_ENABLED"), false),
    virtualKeysEnabled: bool(pick(env, "VERIS_VKEYS_ENABLED"), false),
    adminKey: pick(env, "VERIS_ADMIN_KEY"),
    vkeysFile: pick(env, "VERIS_VKEYS_FILE"),
  };
}
