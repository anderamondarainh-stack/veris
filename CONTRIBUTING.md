# Contributing to Veris

Thanks for your interest. Contributions (issues, PRs, ideas) are welcome.

## Requirements

- **Node ≥ 20** and npm.

## Set up the project

```bash
npm install
cp .env.example .env     # add at least one API key
npm run dev              # starts on http://localhost:8787 with hot reload
```

Useful scripts:

| Script | What it does |
|--------|--------------|
| `npm run dev` | Dev server (tsx watch). |
| `npm run build` | Compile TypeScript to `dist/`. |
| `npm start` | Run the `dist/` build. |
| `npm run typecheck` | Type-check without emitting (`tsc --noEmit`). |
| `npm test` | Run the test suite (Vitest). |

## Tests

Before opening a PR, make sure types and tests pass:

```bash
npm run typecheck
npm test
```

Add tests for any new behavior. Tests live in `test/` and cover the router,
resilience and credentials.

## Commit style

- Use **Conventional Commits**: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`,
  `chore:`, etc.
- Imperative, concise messages. Examples:
  - `feat(router): add balanced strategy as default`
  - `fix(providers): handle 429 with exponential backoff`
- One commit per logical change; keep the diff focused.

## Before the PR

1. `npm run typecheck` and `npm test` green.
2. Describe the _what_ and the _why_ of the change.
3. If you touch documented behavior, update `README.md` or
   `docs/ARCHITECTURE.md`.

## Scope and the account provider

This is an open-source project. The **account provider** is a gray area with
respect to third-party Terms of Service (see [`DISCLAIMER.md`](DISCLAIMER.md));
contributions aimed at evading provider detection or at abusive uses will not be
accepted.
