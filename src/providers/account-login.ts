// ─────────────────────────────────────────────────────────────────────────
//  LOGIN HELPER del account-provider  ·  ⚠️ zona gris ToS · local-first
// ─────────────────────────────────────────────────────────────────────────
//  Abre un navegador REAL (headful) en el sitio del proveedor para que el
//  usuario inicie sesión UNA vez con SU propia cuenta. La sesión queda en el
//  perfil persistente local (cookies); el autor del proyecto nunca la ve.
//
//  No automatiza el login (no pedimos ni tecleamos credenciales): lo hace el
//  usuario a mano. Nosotros solo detectamos cuándo ya hay sesión y guardamos.
import { launchBrowser } from "./account-browser.js";
import { DRIVERS } from "./account-drivers.js";

export interface LoginOptions {
  profileBaseDir: string;
  // Segundos máximos esperando a que el usuario complete el login.
  timeoutSec?: number;
}

export async function runLogin(upstream: string, opts: LoginOptions): Promise<boolean> {
  const driver = DRIVERS[upstream];
  if (!driver) {
    throw new Error(`No hay driver para '${upstream}'. Disponibles: ${Object.keys(DRIVERS).join(", ")}`);
  }
  const profileDir = `${opts.profileBaseDir}/${upstream}`;
  const timeoutSec = opts.timeoutSec ?? 300;

  console.log(`\n  Abriendo ${driver.url} para login en '${upstream}'…`);
  console.log(`  Perfil local: ${profileDir}`);

  // headful y SIN stealth: es un login manual del usuario, no hay que ocultar nada.
  const { page, close } = await launchBrowser({ profileDir, headless: false });

  try {
    await page.goto(driver.url, { waitUntil: "domcontentloaded" }).catch(() => {});

    if (await driver.isLoggedIn(page)) {
      console.log("  ✓ Ya había sesión válida en este perfil. Nada que hacer.");
      return true;
    }

    console.log("\n  → Inicia sesión en la ventana del navegador con TU cuenta.");
    console.log("    Detectaré la sesión automáticamente cuando estés dentro.");
    console.log(`    (esperando hasta ${timeoutSec}s)\n`);

    const stepMs = 2000;
    const maxIters = Math.ceil((timeoutSec * 1000) / stepMs);
    for (let i = 0; i < maxIters; i++) {
      if (await driver.isLoggedIn(page).catch(() => false)) {
        // Margen para que se escriban cookies/tokens antes de cerrar.
        await page.waitForTimeout(2500);
        console.log("  ✓ Sesión detectada y guardada en el perfil local.");
        return true;
      }
      await page.waitForTimeout(stepMs);
    }

    console.log("  ✗ Tiempo agotado sin detectar sesión. Vuelve a intentarlo.");
    return false;
  } finally {
    await close();
  }
}
