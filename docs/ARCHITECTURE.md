# Arquitectura

## Principios

1. **Local-first.** El gateway corre en la máquina del usuario. Claves y
   sesiones nunca salen de ahí. No existe servidor central. Esto elimina el
   riesgo de filtrar datos de terceros y la responsabilidad legal del autor.
2. **OpenAI-compatible.** La interfaz pública imita Chat Completions, así
   cualquier cliente/SDK existente funciona apuntando la `baseURL` al gateway.
3. **Providers intercambiables.** El router no sabe si detrás hay una API key
   (BYOK) o una cuenta automatizada (account). Todos cumplen la interfaz
   `Provider`.

## Flujo de una petición

```
POST /v1/chat/completions
        │
        ▼
  ┌───────────────┐   1. ¿modelo explícito? → úsalo
  │    ROUTER      │   2. ¿"auto"? → classify() detecta la tarea
  │  router/index  │   3. filtra catálogo por tarea + providers disponibles
  └──────┬─────────┘   4. ordena por coste según estrategia → elige
        ▼
  ┌───────────────┐   Registry.get(provider)
  │   PROVIDER     │   - openai / anthropic / gemini  (BYOK)
  │ providers/*    │   - account:*                    (opcional, gris)
  └──────┬─────────┘
        ▼
  upstream real (API oficial o navegador automatizado)
        ▼
  respuesta normalizada a formato OpenAI  (+ cabeceras x-byoa-*)
```

## Componentes

| Módulo | Responsabilidad |
|--------|-----------------|
| `src/index.ts` | Servidor Hono. Endpoints `/`, `/v1/models`, `/v1/chat/completions`. Streaming SSE. |
| `src/router/classify.ts` | Clasifica la tarea por reglas (code/reasoning/chat/vision/cheap). |
| `src/router/catalog.ts` | Catálogo de modelos: capacidades + coste. La "verdad" a mantener al día. |
| `src/router/index.ts` | Decide modelo según tarea, providers disponibles y estrategia. |
| `src/providers/base.ts` | Interfaz `Provider` común. |
| `src/providers/{openai,anthropic,gemini}.ts` | Providers BYOK reales con streaming. |
| `src/providers/account.ts` | Esqueleto del account-provider (zona gris ToS). |
| `src/providers/registry.ts` | Construye los providers listos según `.env`. |

## Decisiones de diseño

- **Router por reglas primero.** Es instantáneo y gratis. Un clasificador por
  embeddings (fase 2) puede mejorar la precisión, pero añade latencia y una
  dependencia; se enchufará detrás de la misma interfaz `classify()`.
- **El catálogo es código, no red.** Precios e ids cambian; mantenerlos en un
  archivo versionado hace el routing determinista y auditable.
- **Account-provider aislado.** Vive en su propio módulo, desactivado por
  defecto, sin dependencias pesadas (Playwright) en el core. Quien solo quiere
  BYOK no instala un navegador.

## Roadmap

- [ ] Clasificador por embeddings opcional (fase 2).
- [ ] Cifrado de credenciales en disco (`.byoa/creds.enc`) con clave maestra.
- [ ] Implementar account-provider con Playwright stealth + perfil local.
- [ ] Fallback automático entre providers si uno falla / rate-limita.
- [ ] Contabilidad de coste por petición (sumar tokens × precio del catálogo).
- [ ] Tests (router, classify, traducción de formatos por provider).
