import type { ChatMessage } from "../types/index.js";

// ─────────────────────────────────────────────────────────────────────────
//  DRIVERS DE SITIO  ·  cómo hablar con cada web de chat
// ─────────────────────────────────────────────────────────────────────────
//  Un driver sabe, para un sitio concreto, cómo: detectar login, escribir el
//  prompt y extraer la respuesta. Los SELECTORES son frágiles por naturaleza
//  (cambian cuando el sitio hace deploy) → están aislados aquí para mantenerlos
//  en un solo lugar. Esta fragilidad es justo por qué el account-provider es
//  zona gris y poco apto para producción seria.

export interface SiteDriver {
  id: string;
  url: string;
  loginHint: string;
  // ¿Hay una sesión válida? (el usuario ya hizo login en este perfil).
  isLoggedIn(page: any): Promise<boolean>;
  // Envía el prompt y devuelve el texto de la respuesta del asistente.
  send(page: any, messages: ChatMessage[], opts: { humanize: boolean }): Promise<string>;
}

// Aplana mensajes a un único prompt para una caja de texto de chat. (Las webs
// de chat no exponen roles; concatenamos system+contexto de forma legible.)
function flatten(messages: ChatMessage[]): string {
  return messages
    .map((m) => {
      const content = m.content ?? ""; // assistant con solo tool_calls trae null
      return m.role === "user" ? content : `[${m.role}] ${content}`;
    })
    .join("\n\n");
}

// Primer selector que exista en la página (probamos varios por robustez ante
// cambios de DOM). Devuelve el locator del primero con match, o null.
async function firstExisting(page: any, selectors: string[]): Promise<any | null> {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count().catch(() => 0)) > 0) return loc;
  }
  return null;
}

// Escribe en una caja (textarea o contenteditable) imitando cadencia humana.
// `humanize=false` lo rellena de golpe. Para contenteditable, enfocamos y
// tecleamos por teclado (fill no siempre dispara los handlers de React).
async function typeInto(page: any, loc: any, text: string, humanize: boolean) {
  await loc.click();
  if (!humanize) {
    // Intento rápido: fill; si la caja es contenteditable y no lo soporta,
    // caemos a teclear de golpe por teclado.
    try {
      await loc.fill(text);
      return;
    } catch {
      await page.keyboard.insertText(text);
      return;
    }
  }
  for (const ch of text) {
    await page.keyboard.type(ch, { delay: 35 + Math.floor(((ch.charCodeAt(0) * 9301 + 49297) % 233) / 2) });
  }
}

// ── Driver de OpenAI / ChatGPT ─────────────────────────────────────────────
// Selectores verificados contra chatgpt.com (jun-2026). Rotan con frecuencia;
// si algo deja de funcionar, este es el único sitio a actualizar.
const PROMPT_SELECTORS = ["#prompt-textarea", "div[contenteditable='true']", "textarea"];
const SEND_SELECTORS = ["[data-testid='send-button']", "button[aria-label*='Send' i]"];
const STOP_SELECTORS = ["[data-testid='stop-button']", "button[aria-label*='Stop' i]"];
const ASSISTANT_SELECTOR = "[data-message-author-role='assistant']";
const LOGIN_SELECTORS = [
  "[data-testid='login-button']",
  "a[href*='auth/login']",
  "button:has-text('Log in')",
];

export const openaiDriver: SiteDriver = {
  id: "openai",
  url: "https://chatgpt.com/",
  loginHint: "Ejecuta `veris account login openai` y haz login una vez; el perfil queda guardado.",

  async isLoggedIn(page: any): Promise<boolean> {
    // Logueado si existe el compositor de prompt y NO hay botón de login visible.
    const composer = await firstExisting(page, PROMPT_SELECTORS);
    if (!composer) return false;
    for (const sel of LOGIN_SELECTORS) {
      const visible = await page
        .locator(sel)
        .first()
        .isVisible()
        .catch(() => false);
      if (visible) return false;
    }
    return true;
  },

  async send(page: any, messages: ChatMessage[], opts: { humanize: boolean }): Promise<string> {
    const prompt = flatten(messages);

    const input = await firstExisting(page, PROMPT_SELECTORS);
    if (!input) throw new Error("account-provider: no se encontró la caja de prompt (selector roto o sin login)");

    // Cuántas respuestas del asistente había antes de enviar (para detectar la nueva).
    const before = await page.locator(ASSISTANT_SELECTOR).count().catch(() => 0);

    await typeInto(page, input, prompt, opts.humanize);

    // Enviar: Enter; si no arranca, intentamos el botón de envío.
    await page.keyboard.press("Enter");
    const started = await waitForGenerationStart(page, before);
    if (!started) {
      const sendBtn = await firstExisting(page, SEND_SELECTORS);
      if (sendBtn) await sendBtn.click().catch(() => {});
      await waitForGenerationStart(page, before);
    }

    // Esperar fin de generación: el botón de stop desaparece. Fallback: el texto
    // de la última respuesta deja de crecer.
    await waitForGenerationEnd(page);

    const answer = await page
      .locator(ASSISTANT_SELECTOR)
      .last()
      .innerText()
      .catch(() => "");
    if (!answer || !answer.trim()) {
      throw new Error("account-provider: respuesta vacía (selector de respuesta roto o timeout)");
    }
    return answer.trim();
  },
};

// La generación ha empezado si aparece el botón de stop o si hay una respuesta
// nueva del asistente respecto al conteo previo. Sondea ~8s.
async function waitForGenerationStart(page: any, beforeCount: number): Promise<boolean> {
  for (let i = 0; i < 16; i++) {
    const stop = await firstExisting(page, STOP_SELECTORS);
    if (stop) return true;
    const now = await page.locator(ASSISTANT_SELECTOR).count().catch(() => 0);
    if (now > beforeCount) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

// La generación ha terminado cuando el botón de stop desaparece. Si nunca lo
// vimos, caemos a estabilización: la última respuesta deja de crecer.
async function waitForGenerationEnd(page: any): Promise<void> {
  // Fase 1: esperar a que desaparezca el stop (hasta 120s de respuesta larga).
  for (let i = 0; i < 240; i++) {
    const stop = await firstExisting(page, STOP_SELECTORS);
    if (!stop) break;
    await page.waitForTimeout(500);
  }
  // Fase 2: estabilización de texto (cubre el caso de que no haya stop-button).
  let last = "";
  for (let i = 0; i < 30; i++) {
    const cur = (await page.locator(ASSISTANT_SELECTOR).last().innerText().catch(() => "")) as string;
    if (cur && cur === last) return;
    last = cur;
    await page.waitForTimeout(400);
  }
}

export const DRIVERS: Record<string, SiteDriver> = {
  openai: openaiDriver,
  // anthropic / gemini: añadir drivers análogos cuando se mantengan sus selectores.
};

export { flatten as _flattenForTest };
