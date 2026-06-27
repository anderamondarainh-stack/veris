import type { Provider } from "./base.js";
import { OpenAIProvider } from "./openai.js";
import { AnthropicProvider } from "./anthropic.js";
import { GeminiProvider } from "./gemini.js";
import { AccountProvider } from "./account.js";

// Construye y guarda los providers disponibles según la config. El router
// consulta `availableProviderNames()` para saber con qué puede contar.
export class Registry {
  private providers = new Map<string, Provider>();

  constructor(env: NodeJS.ProcessEnv) {
    const accountEnabled = env.ACCOUNT_PROVIDER_ENABLED === "true";
    const accountOpts = (upstream: "openai" | "anthropic" | "gemini") => ({
      enabled: accountEnabled,
      profileDir: `${env.BYOA_PROFILE_DIR ?? ".browser-profiles"}/${upstream}`,
      headless: env.ACCOUNT_HEADLESS === "true",
      humanize: env.ACCOUNT_HUMANIZE !== "false",
      stealth: env.ACCOUNT_STEALTH === "true",
    });

    const all: Provider[] = [
      new OpenAIProvider(env.OPENAI_API_KEY),
      new AnthropicProvider(env.ANTHROPIC_API_KEY),
      new GeminiProvider(env.GEMINI_API_KEY),
      // Account providers (zona gris) — solo si el usuario los activa.
      new AccountProvider("openai", accountOpts("openai")),
      new AccountProvider("anthropic", accountOpts("anthropic")),
      new AccountProvider("gemini", accountOpts("gemini")),
    ];

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
