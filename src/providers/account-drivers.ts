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

// Escribe texto imitando cadencia humana (dwell/flight variable), más natural
// que rellenar de golpe. `humanize=false` escribe el texto de una vez.
async function typeHumanlike(page: any, selector: string, text: string, humanize: boolean) {
  const el = await page.waitForSelector(selector, { timeout: 15_000 });
  if (!humanize) {
    await el.fill(text);
    return;
  }
  for (const ch of text) {
    await el.type(ch, { delay: 40 + Math.floor(Math.random() * 90) });
  }
}

// ── Driver de ejemplo (OpenAI/ChatGPT) ────────────────────────────────────
// SELECTORES ILUSTRATIVOS. Verificar/actualizar contra el DOM real del sitio;
// rotan con frecuencia. Mantener SOLO aquí.
export const openaiDriver: SiteDriver = {
  id: "openai",
  url: "https://chatgpt.com/",
  loginHint: "Abre el navegador del account-provider y haz login una vez; el perfil queda guardado.",
  async isLoggedIn(page: any): Promise<boolean> {
    // Heurística: la caja de prompt solo existe logueado.
    return (await page.locator("textarea, [contenteditable='true']").count()) > 0;
  },
  async send(page: any, messages: ChatMessage[], opts: { humanize: boolean }): Promise<string> {
    const prompt = flatten(messages);
    const inputSel = "textarea, [contenteditable='true']";
    await typeHumanlike(page, inputSel, prompt, opts.humanize);
    await page.keyboard.press("Enter");

    // Espera a que aparezca y se estabilice una respuesta del asistente.
    const answerSel = "[data-message-author-role='assistant']";
    await page.waitForSelector(answerSel, { timeout: 60_000 });
    // Espera de estabilización: el texto deja de crecer (streaming terminado).
    let last = "";
    let stable = false;
    for (let i = 0; i < 60; i++) {
      const cur = (await page.locator(answerSel).last().innerText().catch(() => "")) as string;
      if (cur && cur === last) {
        stable = true;
        break;
      }
      last = cur;
      await page.waitForTimeout(500);
    }
    // No devolvemos respuesta vacía como si fuera válida: o se estabilizó con
    // contenido, o algo falló (timeout, selector roto, respuesta vacía real).
    if (!last || !stable) {
      throw new Error("account-provider: no se obtuvo una respuesta estable (selector roto o timeout)");
    }
    return last;
  },
};

export const DRIVERS: Record<string, SiteDriver> = {
  openai: openaiDriver,
  // anthropic / gemini: añadir drivers análogos cuando se mantengan sus selectores.
};

export { flatten as _flattenForTest };
