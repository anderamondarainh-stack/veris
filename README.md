# Veris

**Gateway LLM local-first y compatible con OpenAI, con router inteligente.**
Bring Your Own Key — o tu propia cuenta. Tú decides; todo corre en tu máquina.

[![CI](https://github.com/anderamondarainh-stack/veris/actions/workflows/ci.yml/badge.svg)](https://github.com/anderamondarainh-stack/veris/actions/workflows/ci.yml)
&nbsp;·&nbsp; Licencia MIT &nbsp;·&nbsp; Node ≥ 20

```
  Cualquier cliente OpenAI SDK ──►  Veris (local)  ──►  OpenAI / Anthropic / Gemini
                                          │                Groq / DeepSeek / Mistral
                                     ROUTER: elige el        xAI / Together / Perplexity
                                     modelo más adecuado     OpenRouter / Ollama (local)
                                     / barato por tarea
```

## ¿Qué resuelve?

Apuntas tu app a `http://localhost:8787/v1` como si fuera la API de OpenAI, y
el gateway:

1. **Enruta** cada petición al modelo más adecuado para la tarea (código,
   razonamiento, chat, visión) según la estrategia que elijas
   (`cheapest` / `best` / `balanced`).
2. **Habla con varios proveedores** (OpenAI, Anthropic, Gemini, Groq, DeepSeek,
   Mistral, xAI, Together, Perplexity, OpenRouter y Ollama local) con una sola
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

### Con Docker

Veris trae `Dockerfile` (multi-stage, `node:20-alpine`) y `docker-compose.yml`:

```bash
cp .env.example .env        # añade al menos una API key
docker compose up --build   # gateway en http://localhost:8787
```

Para incluir además **Ollama** (modelos locales) en el mismo compose, usa el
perfil `local` (ver [Modelos locales con Ollama](#modelos-locales-con-ollama)):

```bash
docker compose --profile local up --build
```

La imagen expone el puerto `8787` e incluye un `HEALTHCHECK` contra `/healthz`.

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

Endpoints disponibles:

- `GET /` — información del gateway.
- `GET /v1/models` — catálogo de modelos disponibles.
- `POST /v1/chat/completions` — completions (con streaming SSE).
- `POST /v1/embeddings` — embeddings (ver ejemplo abajo).
- `GET /v1/usage` — coste agregado.
- `GET /healthz` — liveness (siempre `{"status":"ok"}` si el proceso vive).
- `GET /readyz` — readiness (indica si hay providers configurados).
- `GET /metrics` — métricas en formato Prometheus (si `BYOA_METRICS=true`).

Los errores se devuelven en el **formato de error de OpenAI**, para que
cualquier SDK los entienda sin cambios:

```json
{ "error": { "message": "...", "type": "...", "code": "..." } }
```

### Embeddings

```bash
curl http://localhost:8787/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{
    "model": "text-embedding-3-small",
    "input": "El veloz zorro marrón salta sobre el perro perezoso"
  }'
```

### Observabilidad

```bash
curl http://localhost:8787/healthz   # liveness
curl http://localhost:8787/readyz    # readiness
curl http://localhost:8787/metrics   # métricas Prometheus
```

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
| `BYOA_SPEND_CAP_USD` | `0` | Tope de gasto acumulado en USD. Si se supera, las peticiones responden `402`. `0` = sin tope. |
| `MODELS_FILE` | _(vacío)_ | Ruta a un JSON opcional para añadir/corregir modelos del catálogo. |
| `BYOA_LOG` | `true` | Logging estructurado de peticiones. |
| `BYOA_METRICS` | `true` | Expone métricas Prometheus en `/metrics`. |

### Providers BYOK (API keys)

> **Multi-key:** cualquiera de estas variables admite **varias keys separadas
> por comas** (`KEY=sk-aaa,sk-bbb`). Veris rota entre ellas (round-robin) para
> repartir límites de rate.

| Variable | Proveedor | Notas |
|----------|-----------|-------|
| `OPENAI_API_KEY` | OpenAI | `OPENAI_BASE_URL` permite override de base URL. |
| `ANTHROPIC_API_KEY` | Anthropic | Protocolo nativo. |
| `GEMINI_API_KEY` | Google Gemini | Protocolo nativo. |
| `GROQ_API_KEY` | Groq | OpenAI-compatible. |
| `DEEPSEEK_API_KEY` | DeepSeek | OpenAI-compatible. |
| `MISTRAL_API_KEY` | Mistral | OpenAI-compatible. |
| `XAI_API_KEY` | xAI (Grok) | OpenAI-compatible. |
| `TOGETHER_API_KEY` | Together AI | OpenAI-compatible. |
| `PERPLEXITY_API_KEY` | Perplexity | OpenAI-compatible. |
| `OPENROUTER_API_KEY` | OpenRouter | OpenAI-compatible (agrega muchos modelos). |

### Modelos locales con Ollama

[Ollama](https://ollama.com) sirve modelos en tu propia máquina, **sin coste y
sin API key**. Veris lo trata como un provider OpenAI-compatible más.

| Variable | Por defecto | Descripción |
|----------|-------------|-------------|
| `OLLAMA_ENABLED` | `false` | Pon `true` para activar Ollama en `http://localhost:11434/v1`. |
| `OLLAMA_BASE_URL` | _(vacío)_ | Base URL de Ollama. Definirla también lo activa (útil en Docker). |

Local, en tu máquina:

```bash
ollama serve            # arranca Ollama
ollama pull llama3.1    # descarga un modelo
# en tu .env:
OLLAMA_ENABLED=true
```

Con Docker Compose (perfil `local`, Veris alcanza a Ollama por la red interna).
Ollama va **desactivado por defecto**; para activarlo añade a tu `.env`:

```bash
echo "OLLAMA_BASE_URL=http://ollama:11434/v1" >> .env
docker compose --profile local up --build
```

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
