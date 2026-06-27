import type { ChatCompletionRequest, ChatCompletionResponse } from "../types/index.js";
import { buildResponse, type Provider } from "./base.js";
import { launchBrowser, type BrowserHandle } from "./account-browser.js";
import { DRIVERS, type SiteDriver } from "./account-drivers.js";

// ─────────────────────────────────────────────────────────────────────────
//  ACCOUNT PROVIDER  ·  ⚠️ ZONA GRIS ToS — usa la CUENTA del usuario
// ─────────────────────────────────────────────────────────────────────────
//  Conduce un navegador real con la sesión del usuario para "usar su cuenta"
//  como si fuera una API. Local-first: el perfil (cookies/sesión) vive cifrado
//  y solo en la máquina del usuario; el autor del proyecto nunca lo ve.
//
//  • Viola los ToS de OpenAI/Anthropic/Google → puede provocar baneo.
//  • DESACTIVADO por defecto (ACCOUNT_PROVIDER_ENABLED=false).
//  • Frágil por diseño (depende del DOM del sitio) → no apto para producción
//    seria. Úsalo para uso personal/experimentación bajo tu responsabilidad.

export interface AccountProviderOptions {
  enabled: boolean;
  profileDir: string;
  headless?: boolean;
  humanize?: boolean; // imitar cadencia humana al teclear (reduce señales L5)
  stealth?: boolean;
  proxy?: { server: string; username?: string; password?: string };
}

export class AccountProvider implements Provider {
  readonly name: string;
  private driver: SiteDriver | undefined;
  private handle: BrowserHandle | null = null;
  private launching: Promise<BrowserHandle> | null = null;
  private disposed = false;

  constructor(
    private upstream: "openai" | "anthropic" | "gemini",
    private opts: AccountProviderOptions,
  ) {
    this.name = `account:${upstream}`;
    this.driver = DRIVERS[upstream];
  }

  isReady(): boolean {
    // Listo si está habilitado y hay un driver para este proveedor. La sesión
    // válida se comprueba perezosamente al primer uso (no bloquea el arranque).
    return this.opts.enabled && this.driver !== undefined;
  }

  // Lanza el navegador una sola vez (lazy + memoizado), reusable entre requests.
  private async ensureBrowser(): Promise<BrowserHandle> {
    if (this.handle) return this.handle;
    if (this.launching) return this.launching;
    this.launching = launchBrowser({
      profileDir: this.opts.profileDir,
      headless: this.opts.headless,
      stealth: this.opts.stealth,
      proxy: this.opts.proxy,
    }).then(
      (h) => {
        this.launching = null;
        // Si se llamó dispose() mientras lanzábamos, cierra el navegador
        // huérfano en vez de retenerlo.
        if (this.disposed) {
          void h.close();
          throw new Error("account-provider desechado durante el lanzamiento");
        }
        this.handle = h;
        return h;
      },
      (err) => {
        // Limpia la promesa fallida para permitir reintentar en la próxima request.
        this.launching = null;
        throw err;
      },
    );
    return this.launching;
  }

  async complete(_upstreamId: string, req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    if (!this.driver) throw new Error(`account-provider sin driver para ${this.upstream}`);
    const { page } = await this.ensureBrowser();

    await page
      .goto(this.driver.url, { waitUntil: "domcontentloaded" })
      .catch((e: any) => console.warn(`account-provider: navegación a ${this.driver!.url} falló: ${e?.message}`));
    if (!(await this.driver.isLoggedIn(page))) {
      throw new Error(`account-provider: sin sesión en ${this.upstream}. ${this.driver.loginHint}`);
    }

    const text = await this.driver.send(page, req.messages, { humanize: this.opts.humanize ?? true });
    return buildResponse(`account:${this.upstream}`, text);
  }

  // Streaming real desde una web de chat es complejo (hay que observar el DOM
  // crecer). De momento, no-stream: devolvemos el texto completo de una vez.
  async *stream(upstreamId: string, req: ChatCompletionRequest) {
    const res = await this.complete(upstreamId, req);
    const text = res.choices[0]?.message.content ?? "";
    yield text;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    // Espera un lanzamiento en vuelo para no dejar el navegador huérfano.
    if (this.launching) await this.launching.catch(() => {});
    await this.handle?.close();
    this.handle = null;
  }
}
