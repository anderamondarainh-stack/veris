# Veris

**A local-first, OpenAI-compatible LLM gateway with a smart router.**
Point any OpenAI SDK at one endpoint and reach 11 providers — with cost-aware
routing, automatic fallback, spend accounting and multi-tenant keys. Your keys
never leave your machine.

[![CI](https://github.com/anderamondarainh-stack/veris/actions/workflows/ci.yml/badge.svg)](https://github.com/anderamondarainh-stack/veris/actions/workflows/ci.yml)
&nbsp;·&nbsp; MIT License &nbsp;·&nbsp; Node ≥ 20 &nbsp;·&nbsp; Zero telemetry

```
  Any OpenAI SDK client  ──►   Veris (runs locally)   ──►  OpenAI / Anthropic / Gemini
                                       │                    Groq / DeepSeek / Mistral
                                  ROUTER: picks the          xAI / Together / Perplexity
                                  best / cheapest model      OpenRouter / Ollama (local)
                                  for each task
```

## Why Veris?

You wire up the OpenAI SDK once. Then you want to try Claude, or a cheap model
for simple calls, or a local model for privacy — and suddenly you're juggling
SDKs, base URLs and pricing tables. Veris is the single endpoint in front of all
of them:

- **One API, every provider.** Talk to 11 providers through the OpenAI Chat
  Completions interface. Swap models without touching your code.
- **Smart routing.** Send `"model": "auto"` and Veris classifies the task
  (code, reasoning, chat, vision) and routes to the best/cheapest model for your
  strategy (`cheapest` / `best` / `balanced`).
- **Cost control built in.** Per-request and aggregate cost accounting, an
  optional hard spend cap, and a response cache.
- **Resilient.** Automatic fallback to another model on failure, with
  exponential-backoff retries on 429/5xx.
- **Multi-tenant.** Issue virtual keys with their own budget, rate limit and
  allowed models — without sharing your real provider keys.
- **Local-first, zero telemetry.** Everything runs on your machine. Your keys
  and data never reach any central server, because there isn't one.

## Quick start

```bash
git clone https://github.com/anderamondarainh-stack/veris.git
cd veris
npm install
cp .env.example .env        # add at least one API key (e.g. OPENAI_API_KEY)
npm run dev                 # starts on http://localhost:8787
```

Call it like the OpenAI API (`"model": "auto"` lets the router decide):

```bash
curl http://localhost:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "messages": [{"role":"user","content":"Write a TypeScript function that reverses a string"}]
  }'
```

The response carries diagnostic headers so you can see what the router did:
`x-veris-model`, `x-veris-task`, `x-veris-reason`, `x-veris-cost-usd`.

### Use it from the OpenAI SDK

Just change the `baseURL` — your existing code keeps working:

```ts
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://localhost:8787/v1",
  apiKey: "ignored", // the gateway ignores it unless you enable its own auth
});

const r = await client.chat.completions.create({
  model: "auto", // or a specific model: "gpt-4o-mini", "claude-3-5-sonnet", ...
  messages: [{ role: "user", content: "Hello" }],
});
console.log(r.choices[0].message.content);
```

### Run with Docker

Veris ships a multi-stage `Dockerfile` (`node:20-alpine`, non-root) and a
`docker-compose.yml`:

```bash
cp .env.example .env        # add at least one API key
docker compose up --build   # gateway on http://localhost:8787
```

The image exposes port `8787` and has a `HEALTHCHECK` against `/healthz`. To
also run **Ollama** (local models) in the same compose, use the `local` profile
(see [Local models with Ollama](#local-models-with-ollama)):

```bash
docker compose --profile local up --build
```

## Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /` | Gateway info. |
| `GET /v1/models` | Catalog of available models. |
| `POST /v1/chat/completions` | Chat completions (SSE streaming supported). |
| `POST /v1/embeddings` | Embeddings. |
| `GET /v1/usage` | Aggregate cost. |
| `GET /healthz` | Liveness (`{"status":"ok"}` while the process is alive). |
| `GET /readyz` | Readiness (whether any provider is configured). |
| `GET /metrics` | Prometheus metrics (when `VERIS_METRICS=true`). |

Errors are returned in the **OpenAI error format**, so any SDK understands them
unchanged:

```json
{ "error": { "message": "...", "type": "...", "code": "..." } }
```

### Embeddings

```bash
curl http://localhost:8787/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{ "model": "text-embedding-3-small", "input": "The quick brown fox" }'
```

## Function calling (tools)

Veris forwards `tools`/`tool_choice` as-is to OpenAI-compatible providers, and
**translates** the format for Anthropic and Gemini in both directions (the
request and the `tool_calls` in the response). You get function calling with the
same code regardless of which model you target.

> Note: streaming of tool calls is not supported — use non-streaming mode for
> function calling.

## Multi-tenant: virtual keys

Want to give several people or apps access to Veris without handing out your
real provider keys? Enable **virtual keys**: you mint `vk-…` keys, each with its
own **budget** (USD), **rate limit** (req/min) and optional **allowed-models**
list. Spend is attributed per key.

```bash
# in .env
VERIS_VKEYS_ENABLED=true
VERIS_ADMIN_KEY=admin-secret

# create a key (returned in full exactly once)
curl -X POST http://localhost:8787/admin/keys \
  -H "Authorization: Bearer admin-secret" -H "Content-Type: application/json" \
  -d '{"label":"app-1","budgetUsd":10,"rpm":60,"models":["auto","openai/gpt-4o-mini"]}'

# use it like any OpenAI API key
curl http://localhost:8787/v1/chat/completions \
  -H "Authorization: Bearer vk-..." -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"hi"}]}'
```

Admin routes (Bearer `VERIS_ADMIN_KEY`): `POST /admin/keys`, `GET /admin/keys`,
`DELETE /admin/keys/:key`. Errors: `402` budget exhausted, `429` rate limit,
`403` model not allowed.

## Configuration

All settings are read from the environment at startup (see `src/config.ts`).
Copy `.env.example` to `.env` and adjust. Everything is optional, but you need
**at least one API key** for any provider to be available.

### Gateway

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8787` | Local server port. |
| `ROUTER_STRATEGY` | `balanced` | Router strategy: `cheapest`, `best` or `balanced`. |
| `VERIS_GATEWAY_KEY` | _(empty)_ | If set, the gateway requires `Authorization: Bearer <key>`. Protects your local gateway from other processes on your machine. |
| `VERIS_MAX_RETRIES` | `2` | Retries on transient errors (429/5xx). |
| `VERIS_RETRY_BASE_MS` | `250` | Base of the exponential backoff between retries (ms). |
| `VERIS_FALLBACK` | `true` | Enables automatic fallback to another model on failure. |
| `VERIS_CACHE_TTL` | `0` | TTL (seconds) for the cache of identical responses. `0` disables it. |
| `VERIS_SPEND_CAP_USD` | `0` | Hard cap on cumulative spend (USD). Over it, requests return `402`. `0` = no cap. |
| `MODELS_FILE` | _(empty)_ | Path to an optional JSON to add/override catalog models. |
| `VERIS_LOG` | `true` | Structured request logging. |
| `VERIS_METRICS` | `true` | Exposes Prometheus metrics at `/metrics`. |

### Providers (BYOK — bring your own API key)

> **Multi-key:** any of these accepts **several comma-separated keys**
> (`KEY=sk-aaa,sk-bbb`). Veris round-robins between them to spread rate limits.

| Variable | Provider | Notes |
|----------|----------|-------|
| `OPENAI_API_KEY` | OpenAI | `OPENAI_BASE_URL` overrides the base URL. |
| `ANTHROPIC_API_KEY` | Anthropic | Native protocol. |
| `GEMINI_API_KEY` | Google Gemini | Native protocol. |
| `GROQ_API_KEY` | Groq | OpenAI-compatible. |
| `DEEPSEEK_API_KEY` | DeepSeek | OpenAI-compatible. |
| `MISTRAL_API_KEY` | Mistral | OpenAI-compatible. |
| `XAI_API_KEY` | xAI (Grok) | OpenAI-compatible. |
| `TOGETHER_API_KEY` | Together AI | OpenAI-compatible. |
| `PERPLEXITY_API_KEY` | Perplexity | OpenAI-compatible. |
| `OPENROUTER_API_KEY` | OpenRouter | OpenAI-compatible (aggregates many models). |

### Local models with Ollama

[Ollama](https://ollama.com) serves models on your own machine, **free and with
no API key**. Veris treats it as just another OpenAI-compatible provider.

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_ENABLED` | `false` | Set `true` to enable Ollama at `http://localhost:11434/v1`. |
| `OLLAMA_BASE_URL` | _(empty)_ | Ollama base URL. Setting it also enables Ollama (useful in Docker). |

```bash
ollama serve            # start Ollama
ollama pull llama3.1    # pull a model
# in your .env:
OLLAMA_ENABLED=true
```

With Docker Compose (`local` profile, Veris reaches Ollama over the internal
network):

```bash
echo "OLLAMA_BASE_URL=http://ollama:11434/v1" >> .env
docker compose --profile local up --build
```

## Capabilities

- **Smart router**: classifies the task, adjusts for context window and vision,
  and produces a model **ranking** (`cheapest`/`best`/`balanced`).
- **Resilience**: automatic fallback between models + backoff retries (429/5xx
  retry; 4xx aborts).
- **Cost accounting** per request and aggregated at `/v1/usage` (header
  `x-veris-cost-usd`), with an optional hard spend cap.
- **Response cache** with optional TTL for identical completions.
- **Optional gateway auth** (Bearer token) and **virtual keys** for multi-tenant
  access.
- **OpenAI-compatible SSE streaming**.
- **Observability**: structured logs and Prometheus metrics.

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the request flow,
components and design decisions.

## Advanced / optional: account provider

Besides BYOK (the recommended path), Veris includes an **optional, off-by-default
module** that can drive a provider's own chat web UI through a real browser, so a
monthly subscription can be used instead of paying per token.

> ⚠️ **Read this first.** Automating a provider's chat UI **violates the Terms of
> Service** of OpenAI/Anthropic/Google and may get your account suspended. It is
> **disabled by default** (`ACCOUNT_PROVIDER_ENABLED=false`), kept isolated from
> the core (no browser is installed unless you opt in), and is **local-first**:
> credentials are encrypted on your disk (AES-256-GCM) and never leave it. If you
> enable it, you do so **entirely at your own risk**. See
> [`DISCLAIMER.md`](DISCLAIMER.md).

The recommended and fully supported way to run Veris is **BYOK** — your official
API key, cleanly within every provider's ToS.

## Roadmap

- [ ] Optional embeddings-based task classifier (phase 2).
- [ ] Persistent cost ledger (Redis/Postgres).
- [ ] Maintained site drivers for the optional account module.

## Contributing

Contributions are welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md) to set up the
project, run the tests and the commit style.

## License

[MIT](LICENSE). Software provided **without warranty**.
