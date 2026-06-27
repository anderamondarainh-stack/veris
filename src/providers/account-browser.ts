// ─────────────────────────────────────────────────────────────────────────
//  NAVEGADOR DEL ACCOUNT-PROVIDER  ·  ⚠️ zona gris ToS · local-first
// ─────────────────────────────────────────────────────────────────────────
//  Lanza un navegador REAL persistente (Playwright) con el perfil del usuario.
//  El perfil vive en local (./.browser-profiles/<id>) y nunca sale de la
//  máquina. Playwright es OPCIONAL: se importa de forma dinámica para que
//  quien solo use BYOK no tenga que instalar navegadores.

export interface BrowserHandle {
  page: any; // playwright Page (tipado laxo: playwright es dep opcional)
  context: any;
  close(): Promise<void>;
}

export interface LaunchOptions {
  profileDir: string; // perfil persistente local
  headless?: boolean;
  // Aplica el plugin stealth público (playwright-extra) si está instalado.
  stealth?: boolean;
  // Proxy opcional (residencial). Formato Playwright: { server, username, password }.
  proxy?: { server: string; username?: string; password?: string };
}

// Carga Playwright dinámicamente. Specifier no-literal a propósito: evita que
// el typechecker exija la dependencia cuando no está instalada.
async function loadPlaywright(): Promise<any> {
  const name = "playwright";
  try {
    return await import(name);
  } catch {
    throw new Error(
      "Playwright no está instalado. El account-provider lo necesita:\n" +
        "  npm install playwright && npx playwright install chromium",
    );
  }
}

// El plugin stealth se registra una sola vez por proceso (playwright-extra
// acumula plugins por objeto; registrarlo N veces dobla hooks/logs).
let stealthChromium: any | null = null;
let stealthTried = false;

async function maybeStealth(): Promise<any | null> {
  if (stealthTried) return stealthChromium;
  stealthTried = true;
  try {
    const extraName = "playwright-extra";
    const stealthName = "puppeteer-extra-plugin-stealth";
    const extra: any = await import(extraName);
    const stealth: any = await import(stealthName);
    extra.chromium.use(stealth.default());
    stealthChromium = extra.chromium;
  } catch {
    stealthChromium = null; // no instalado → seguimos sin stealth
  }
  return stealthChromium;
}

export async function launchBrowser(opts: LaunchOptions): Promise<BrowserHandle> {
  const pw = await loadPlaywright();
  const chromium = (opts.stealth && (await maybeStealth())) || pw.chromium;

  // Contexto persistente = perfil real reutilizable (cookies, sesión). Es lo
  // que permite "usar la cuenta" sin re-login cada vez.
  const context = await chromium.launchPersistentContext(opts.profileDir, {
    headless: opts.headless ?? false, // headful es menos detectable
    proxy: opts.proxy,
    viewport: { width: 1280, height: 800 },
  });
  const page = context.pages()[0] ?? (await context.newPage());

  return {
    page,
    context,
    async close() {
      await context.close();
    },
  };
}
