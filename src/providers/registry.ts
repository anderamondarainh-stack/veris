import type { Provider } from "./base.js";
import { OpenAICompatibleProvider } from "./openai-compatible.js";
import { OPENAI_COMPATIBLE_SPECS, parseKeys } from "./specs.js";
import { AnthropicProvider } from "./anthropic.js";
import { GeminiProvider } from "./gemini.js";
import { AccountProvider } from "./account.js";

// Construye y guarda los providers disponibles según la config. El router
// consulta `availableProviderNames()` para saber con qué puede contar.
export class Registry {
  private providers = new Map<string, Provider>();

  constructor(env: NodeJS.ProcessEnv) {
    const all: Provider[] = [];

    // 1) Proveedores OpenAI-compatible (la mayoría). Una sola clase, N specs.
    for (const spec of OPENAI_COMPATIBLE_SPECS) {
      const baseUrl = (spec.baseUrlEnv && env[spec.baseUrlEnv]) || spec.baseUrl;
      const keys = parseKeys(env[spec.envKey]);
      // Los keyless (Ollama) solo se activan si el usuario lo pide explícitamente
      // (si no, el router elegiría modelos locales que quizá no están corriendo).
      if (spec.keyless) {
        const enabled = env[`${spec.name.toUpperCase()}_ENABLED`] === "true" || !!(spec.baseUrlEnv && env[spec.baseUrlEnv]);
        if (!enabled) continue;
      }
      all.push(
        new OpenAICompatibleProvider({
          name: spec.name,
          baseUrl,
          keys,
          keyless: spec.keyless,
          extraHeaders: spec.extraHeaders,
        }),
      );
    }

    // 2) Proveedores con protocolo nativo propio (no OpenAI-compatible).
    all.push(new AnthropicProvider(env.ANTHROPIC_API_KEY));
    all.push(new GeminiProvider(env.GEMINI_API_KEY));

    // 3) Account providers (zona gris ToS) — solo si el usuario los activa.
    const accountEnabled = env.ACCOUNT_PROVIDER_ENABLED === "true";
    const accountOpts = (upstream: "openai" | "anthropic" | "gemini") => ({
      enabled: accountEnabled,
      profileDir: `${env.BYOA_PROFILE_DIR ?? ".browser-profiles"}/${upstream}`,
      headless: env.ACCOUNT_HEADLESS === "true",
      humanize: env.ACCOUNT_HUMANIZE !== "false",
      stealth: env.ACCOUNT_STEALTH === "true",
    });
    all.push(new AccountProvider("openai", accountOpts("openai")));
    all.push(new AccountProvider("anthropic", accountOpts("anthropic")));
    all.push(new AccountProvider("gemini", accountOpts("gemini")));

    for (const p of all) {
      if (p.isReady()) this.providers.set(p.name, p);
    }
  }

  /** Nombres canónicos de provider listos (ej. "openai"). El account-provider
   *  expone el mismo nombre base para que el router lo trate igual. */
  availableProviderNames(): Set<string> {
    const names = new Set<string>();
    for (const name of this.providers.keys()) {
      names.add(name.startsWith("account:") ? name.slice("account:".length) : name);
    }
    return names;
  }

  /** Devuelve el provider para un proveedor dado, prefiriendo BYOK sobre cuenta. */
  get(providerName: string): Provider | undefined {
    return this.providers.get(providerName) ?? this.providers.get(`account:${providerName}`);
  }

  isEmpty() {
    return this.providers.size === 0;
  }
}
