# Contribuir a byoa-gateway

Gracias por tu interés. Las contribuciones (issues, PRs, ideas) son bienvenidas.

## Requisitos

- **Node ≥ 20** y npm.

## Levantar el proyecto

```bash
npm install
cp .env.example .env     # añade al menos una API key
npm run dev              # arranca en http://localhost:8787 con recarga en caliente
```

Scripts útiles:

| Script | Qué hace |
|--------|----------|
| `npm run dev` | Servidor en modo desarrollo (tsx watch). |
| `npm run build` | Compila TypeScript a `dist/`. |
| `npm start` | Ejecuta la build de `dist/`. |
| `npm run typecheck` | Comprueba tipos sin emitir (`tsc --noEmit`). |
| `npm test` | Ejecuta la suite de tests (Vitest). |

## Tests

Antes de abrir un PR, asegúrate de que pasan tipos y tests:

```bash
npm run typecheck
npm test
```

Añade tests para cualquier comportamiento nuevo. Los tests viven en `test/` y
cubren router, resiliencia y credenciales.

## Estilo de commits

- Usa **Conventional Commits**: `feat:`, `fix:`, `docs:`, `refactor:`,
  `test:`, `chore:`, etc.
- Mensajes en imperativo y concisos. Ejemplos:
  - `feat(router): añade estrategia balanced por defecto`
  - `fix(providers): maneja 429 con backoff exponencial`
- Un commit por cambio lógico; mantén el diff enfocado.

## Antes del PR

1. `npm run typecheck` y `npm test` en verde.
2. Describe el _qué_ y el _porqué_ del cambio.
3. Si tocas comportamiento documentado, actualiza el `README.md` o
   `docs/ARCHITECTURE.md`.

## Alcance y account-provider

Este es un proyecto open-source de demostración. El **account-provider** es una
zona gris respecto a los Términos de Servicio de terceros (ver
[`DISCLAIMER.md`](DISCLAIMER.md)); no se aceptarán contribuciones orientadas a
evadir detección de proveedores ni a usos abusivos.
