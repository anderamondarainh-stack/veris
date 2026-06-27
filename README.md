# byoa-gateway

**Local-first, OpenAI-compatible LLM gateway con router inteligente.**
Bring Your Own Key — o tu propia cuenta. Tú decides; todo corre en tu máquina.

```
  Cualquier cliente OpenAI SDK ──►  byoa-gateway (local)  ──►  OpenAI / Anthropic / Gemini
                                         │
                                    ROUTER: elige el modelo
                                    más adecuado/barato por tarea
```

## ¿Qué resuelve?

Apuntas tu app a `http://localhost:8787/v1` como si fuera la API de OpenAI, y
el gateway:

1. **Enruta** cada petición al modelo más adecuado para la tarea (código,
   razonamiento, chat, visión) según la estrategia que elijas
   (`cheapest` / `best` / `balanced`).
2. **Habla con varios proveedores** (OpenAI, Anthropic, Gemini) con una sola
   interfaz. Cambias de modelo sin tocar tu código.
3. **Local-first**: tus claves y sesiones **nunca salen de tu máquina**. No hay
   servidor central que vea tus datos.

## Dos formas de conectar (providers)

| Provider | Qué usa | Estado | Legalidad |
|----------|---------|--------|-----------|
| **BYOK** (recomendado) | Tu **API key** oficial | ✅ Listo | Limpio, dentro de ToS |
| **Account** (opcional) | Tu **cuenta** Plus/Pro automatizada | ⚠️ Esqueleto | Zona gris — viola ToS |

> El **account-provider** automatiza la web de chat para usar tu suscripción de
> 20 €/mes en vez de pagar por token. Va **desactivado por defecto** porque
> viola los Términos de Servicio de los proveedores y puede provocar el baneo
> de tu cuenta. Si lo activas, es **bajo tu responsabilidad**. Las credenciales
> se quedan cifradas en tu disco; el autor del proyecto nunca las ve.

## Uso rápido

```bash
npm install
cp .env.example .env        # añade al menos una API key
npm run dev
```

Prueba con curl (modo `auto` = deja decidir al router):

```bash
curl http://localhost:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "messages": [{"role":"user","content":"Escribe una función en TypeScript que invierta un string"}]
  }'
```

La respuesta incluye cabeceras de diagnóstico:
`x-byoa-model`, `x-byoa-task`, `x-byoa-reason` — para ver qué eligió el router.

Con el SDK de OpenAI solo cambias la `baseURL`:

```ts
import OpenAI from "openai";
const client = new OpenAI({ baseURL: "http://localhost:8787/v1", apiKey: "no-importa" });
const r = await client.chat.completions.create({
  model: "auto",
  messages: [{ role: "user", content: "Hola" }],
});
```

## Arquitectura

Ver [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Capacidades

Gateway:
- Router inteligente: clasifica tarea, ajusta por ventana de contexto y visión,
  y produce un **ranking** de modelos (estrategias `cheapest`/`best`/`balanced`).
- **Resiliencia**: fallback automático entre modelos + reintentos con backoff
  (429/5xx reintentan; 4xx abortan).
- **Contabilidad de coste** por request y agregada en `/v1/usage`
  (cabecera `x-byoa-cost-usd`).
- **Caché** TTL opcional para completions idénticas.
- **Auth** opcional del gateway (Bearer token).
- Streaming SSE compatible con OpenAI.

Account-provider (zona gris ToS · opcional):
- Navegador real (Playwright) con perfil persistente local, drivers de sitio
  intercambiables, tecleo humanizado y stealth opcional.
- **Store de credenciales cifrado** (AES-256-GCM, local-first).

Calidad:
- Suite de tests (`npm test`, vitest) — router, resiliencia, credenciales.

Pendiente: clasificador por embeddings (fase 2), drivers de sitio mantenidos
(anthropic/gemini), persistencia del ledger (Redis/Postgres), streaming real
desde el account-provider.

## Aviso legal

Este software es una herramienta. El **account-provider** puede usarse de forma
que infrinja los Términos de Servicio de terceros. Tú, como usuario que lo
ejecutas, eres el único responsable de cómo lo uses. Licencia MIT, sin garantía.

## Licencia

MIT
