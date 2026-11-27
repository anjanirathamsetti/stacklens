# @stacklens/backend

Server core. Plain TypeScript that Next.js compiles in via `transpilePackages`; it must stay framework-agnostic.

- Never import `next/*` or `react`. Read headers/cookies via `src/http/request-context.ts` (`requestHeader`, `requestCookie`, `setResponseCookie`).
- Relative imports only inside this package (no `@/` alias – it would resolve to the frontend's).
- Every module starts with `import 'server-only';` unless it is pure and shared-safe.
- `http/<path>.ts` maps to `/api/<path>` (`_id` = `[id]`). Wrap handlers in `withAuth(role, …)` or, for public ones, `route(…)`.
- SQL lives only in `repositories/`; schema changes are new entries in `db/migrations.ts`.
- Tests: `npm test -w @stacklens/backend` (PGlite + optional `TEST_DATABASE_URL`).
