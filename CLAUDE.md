# StackLens

Function-level call-tree tracing: SDKs record every call in a request (args, results, errors, logs) and send it to the StackLens app, which stores it in PostgreSQL and shows it in a Next.js UI.

## Layout

```
stacklens/frontend   Next.js UI (npm package "stacklens"); API routes are one-line re-exports
stacklens/backend    @stacklens/backend – framework-agnostic server core (no next/*, no react)
packages/contract    @stacklens/types – wire contract: TS types + schema/trace.schema.json
packages/shared      @stacklens/shared – helpers used by frontend and backend
sdks/node-tracer            @stacklens/node-tracer – Node SDK;  sdks/conformance – cross-language checks
examples/node/*      demo apps (express :3001, nest :3002)
deploy/              Dockerfile + docker-compose;  scripts/ dev-guard, generate-traffic
```

Dependency direction: frontend → backend → shared → contract; sdks → contract. Never the reverse.

## Commands

```bash
npm run dev                         # server on :4300 (builds contract + SDK first)
npm run typecheck && npm run lint && npm test
npm run build                       # production build of everything
npm run conformance:node            # SDK conformance
npm run seed                        # heavy sample traces (needs the example apps running)
```

## Rules

Area rules live in `.claude/rules/` (architecture, backend, frontend, contract-and-sdks, security) and load for matching paths. Reusable workflows live in `.claude/skills/` (add-api-endpoint, add-db-migration, add-ui-page, add-sdk-language, verify-change, seed-test-data).

- Don't commit or push unless asked. Never commit `dump.txt` or `.env*` files.
- Run `verify-change` before calling work done.
