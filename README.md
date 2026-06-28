# Veris

**Gateway LLM local-first y compatible con OpenAI, con router inteligente.**
Bring Your Own Key — o tu propia cuenta. Tú decides; todo corre en tu máquina.

[![CI](https://github.com/anderamondarainh-stack/veris/actions/workflows/ci.yml/badge.svg)](https://github.com/anderamondarainh-stack/veris/actions/workflows/ci.yml)
&nbsp;·&nbsp; Licencia MIT &nbsp;·&nbsp; Node ≥ 20

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

Pensado para quien quiere un único endpoint OpenAI-compatible delante de varios
proveedores, con routing por coste/capacidad, fallback y contabilidad de gasto,
sin montar infraestructura.

## Uso rápido

```bash
git clone https://github.com/anderamondarainh-stack/veris.git
cd veris
npm install
cp .env.example .env        # añade al menos una API key (p. ej. OPENAI_API_KEY)
npm run dev                 # arranca en http://localhost:8787
```

Prueba con `curl` (modo `auto` = deja decidir al router):

```bash
curl http://localhost:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "messages": [{"role":"user","content":"Escribe una función en TypeScript que invierta un string"}]
  }'
```

La respuesta incluye cabeceras de diagnóstico para ver qué decidió el router:
`x-byoa-model`, `x-byoa-task`, `x-byoa-reason`, `x-byoa-cost-usd`.

Con el **SDK de OpenAI** solo cambias la `baseURL` (la `apiKey` es ignorada por
el gateway salvo que actives su auth propia):

```ts
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://localhost:8787/v1",
  apiKey: "no-importa",
});

const r = await client.chat.completions.create({
  model: "auto", // o un modelo concreto: "gpt-4o-mini", "claude-3-5-sonnet", ...
  messages: [{ role: "user", content: "Hola" }],
});
console.log(r.choices[0].message.content);
```

Endpoints disponibles: `GET /`, `GET /v1/models`, `POST /v1/chat/completions`
(con streaming SSE) y `GET /v1/usage` (coste agregado).

## Configuración

Todas las variables se leen del entorno al arrancar (ver `src/config.ts`).
Copia `.env.example` a `.env` y ajusta lo que necesites. Todas son opcionales,
pero necesitas **al menos una API key** para que haya algún provider disponible.

### Gateway

| Variable | Por defecto | Descripción |
|----------|-------------|-------------|
| `PORT` | `8787` | Puerto del servidor local. |
| `ROUTER_STRATEGY` | `balanced` | Estrategia del router: `cheapest`, `best` o `balanced`. |
| `BYOA_GATEWAY_KEY` | _(vacío)_ | Si se define, el gateway exige `Authorization: Bearer <clave>`. Protege tu gateway local de que otra cosa en tu máquina lo use. |
| `BYOA_MAX_RETRIES` | `2` | Reintentos ante errores transitorios (429/5xx). |
| `BYOA_RETRY_BASE_MS` | `250` | Base del backoff exponencial entre reintentos (ms). |
| `BYOA_FALLBACK` | `true` | Activa el fallback automático a otro modelo si uno falla. |
| `BYOA_CACHE_TTL` | `0` | TTL en segundos de la caché de respuestas idénticas. `0` la desactiva. |

### Providers BYOK (API keys)

| Variable | Descripción |
|----------|-------------|
| `OPENAI_API_KEY` | API key oficial de OpenAI. |
| `ANTHROPIC_API_KEY` | API key oficial de Anthropic. |
| `GEMINI_API_KEY` | API key oficial de Google Gemini. |

### Account-provider (zona gris ToS · opcional)

| Variable | Por defecto | Descripción |
|----------|-------------|-------------|
| `ACCOUNT_PROVIDER_ENABLED` | `false` | Activa el account-provider. **Desactivado por defecto.** Léete el [aviso legal](#aviso-legal) antes de tocarlo. |
| `BYOA_PROFILE_DIR` | `.browser-profiles` | Carpeta local del perfil de navegador (cookies/sesión). |
| `BYOA_MASTER_KEY` | _(vacío)_ | Clave maestra para cifrar credenciales en disco (AES-256-GCM). |
| `ACCOUNT_HEADLESS` | `false` | Ejecuta el navegador sin interfaz gráfica. |
| `ACCOUNT_HUMANIZE` | `true` | Imita la cadencia humana al teclear. |
| `ACCOUNT_STEALTH` | `false` | Aplica medidas anti-detección al navegador. |

## Providers: dos formas de conectar

| Provider | Qué usa | Estado | Legalidad |
|----------|---------|--------|-----------|
| **BYOK** (recomendado) | Tu **API key** oficial | ✅ Listo | Limpio, dentro de ToS |
| **Account** (opcional) | Tu **cuenta** Plus/Pro automatizada | ⚠️ Funcional (frágil) | Zona gris — viola ToS |

El **BYOK** es la vía recomendada y la que cualquier usuario debería usar: das
tu API key oficial y el gateway llama a la API real del proveedor.

El **account-provider** automatiza la web de chat para aprovechar una
suscripción mensual (tipo Plus/Pro) en vez de pagar por token. Es funcional
(navegador real con Playwright) pero frágil por diseño, va **desactivado por
defecto** y conlleva implicaciones legales serias: ver abajo.

## Aviso legal

> **El account-provider viola los Términos de Servicio de terceros
> (OpenAI/Anthropic/Google) y puede provocar el baneo de tu cuenta.**

- Va **desactivado por defecto** (`ACCOUNT_PROVIDER_ENABLED=false`). El core
  BYOK funciona sin él y sin instalar ningún navegador.
- Si lo activas, lo haces **bajo tu entera responsabilidad**. Eres el único
  responsable de cómo uses esta herramienta.
- Es **local-first**: las credenciales y la sesión se quedan cifradas en tu
  disco; el autor del proyecto nunca las ve ni las recibe.
- El software se ofrece **sin garantía** (licencia MIT).

Más detalle en [`DISCLAIMER.md`](DISCLAIMER.md).

## Capacidades

Gateway:
- Router inteligente: clasifica la tarea, ajusta por ventana de contexto y
  visión, y produce un **ranking** de modelos (`cheapest`/`best`/`balanced`).
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

## Arquitectura

Ver [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) para el flujo de una petición,
los componentes y las decisiones de diseño.

## Roadmap

- [ ] Clasificador por embeddings opcional (fase 2).
- [ ] Drivers de sitio mantenidos (anthropic/gemini) para el account-provider.
- [ ] Persistencia del ledger de coste (Redis/Postgres).
- [ ] Streaming real desde el account-provider.

## Contribuir

Las contribuciones son bienvenidas. Lee [`CONTRIBUTING.md`](CONTRIBUTING.md)
para levantar el proyecto, correr los tests y el estilo de commits.

## Licencia

[MIT](LICENSE). Software ofrecido **sin garantía**.
