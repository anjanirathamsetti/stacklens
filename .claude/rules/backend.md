---
description: Conventions for the framework-agnostic server core
paths:
  - "stacklens/backend/**"
---

# Backend rules

- No `next/*` or `react` imports. Handlers are `(req: Request, ctx) => Response`. Request headers/cookies come from `http/request-context.ts`.
- Relative imports within the package. No `@/` alias.
- Route files: `http/<segments>.ts`, dynamic segments prefixed `_` (`_id`). Export HTTP method names (`GET`, `POST`, …). Each needs a matching adapter in `stacklens/frontend/src/app/api/<segments>/route.ts`.
- Auth: `withAuth('viewer' | 'member' | 'admin', handler)` for anything that reads or writes data. Public handlers (health, ingest, login, setup) use `route()` and do their own checks (API key, rate limit, `isCrossSiteWrite`).
- Validate every request body field; return `Response.json({ error }, { status })` with 400/401/403/404/409/429 as appropriate. Never echo stack traces.
- SQL only in `repositories/`, always parameterised (`$1`, `$2`). Both drivers (pg and PGlite) must work; tests run against both.
- Schema changes: append a migration in `db/migrations.ts`; never edit a released one.
- Configuration only in `env.ts`. Admin-editable settings go through `repositories/config-repository.ts` with defaults in `packages/shared/src/config-defaults.ts`.
- Writes that matter to admins call `audit(...)`.
