# Architecture

## Principles

1. **Local-first.** The gateway runs on the user's machine. Keys and sessions
   never leave it. There is no central server. This removes the risk of leaking
   third-party data and any liability for the author.
2. **OpenAI-compatible.** The public interface mirrors Chat Completions, so any
   existing client/SDK works by pointing its `baseURL` at the gateway.
3. **Interchangeable providers.** The router does not care whether an API key
   (BYOK) or an automated account (account provider) sits behind a model. They
   all implement the same `Provider` interface.

## Request flow

```
POST /v1/chat/completions
        │
        ▼
  ┌───────────────┐   1. explicit model? → use it
  │    ROUTER     │   2. "auto"? → classify() detects the task
  │  router/index │   3. filter catalog by task + available providers
  └──────┬────────┘   4. rank by cost per strategy → pick (+ fallback chain)
         ▼
  ┌───────────────┐   Registry.get(provider)
  │   PROVIDER    │   - openai / anthropic / gemini / groq / deepseek / ...  (BYOK)
  │ providers/*   │   - account:*                                  (optional, gray area)
  └──────┬────────┘
         ▼
  real upstream (official API or automated browser)
         ▼
  response normalized to OpenAI format  (+ x-veris-* headers)
```

## Components

| Module | Responsibility |
|--------|----------------|
| `src/index.ts` | Hono server. Endpoints `/`, `/v1/models`, `/v1/chat/completions`, `/v1/embeddings`, `/v1/usage`, `/admin/keys`, `/metrics`, health. SSE streaming, spend cap, virtual keys. |
| `src/router/classify.ts` | Classifies the task by rules (code/reasoning/chat/vision/cheap). |
| `src/router/catalog.ts` | Model catalog: capabilities + cost. The "source of truth" to keep up to date. |
| `src/router/index.ts` | Picks a model by task, available providers and strategy; builds the fallback ranking. |
| `src/providers/base.ts` | Common `Provider` interface. |
| `src/providers/openai-compatible.ts` | Generic OpenAI-compatible provider (OpenAI, Groq, DeepSeek, Mistral, xAI, Together, Perplexity, OpenRouter, Ollama) with multi-key round-robin. |
| `src/providers/{anthropic,gemini}.ts` | Native providers with tool-calling format translation and streaming. |
| `src/providers/registry.ts` | Builds the ready-to-use providers from `.env`. |
| `src/virtual-keys.ts` | Virtual keys: budget, rate limit, allowed models. |
| `src/ledger.ts` / `src/metrics.ts` / `src/cache.ts` | Cost accounting, Prometheus metrics, response cache. |

## Design decisions

- **Rules-based router first.** It is instant and free. An embeddings-based
  classifier (phase 2) can improve accuracy, but adds latency and a dependency;
  it plugs in behind the same `classify()` interface.
- **The catalog is code, not network.** Prices and ids change; keeping them in a
  versioned file makes routing deterministic and auditable.
- **Generic OpenAI-compatible provider.** Most providers differ only by base URL
  and key, so a single implementation covers nine of them; only Anthropic and
  Gemini need native adapters for their request/response shape.
- **Isolated account provider.** It lives in its own module, disabled by
  default, with no heavy dependencies (Playwright) in the core. Anyone who only
  wants BYOK never installs a browser.

## Roadmap

- [ ] Optional embeddings-based task classifier (phase 2).
- [ ] Persistent cost ledger (Redis/Postgres).
- [ ] Maintained site drivers for the optional account module.
