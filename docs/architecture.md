# Architecture

```
your API ──(@stacklens/node-tracer)──► POST /api/ingest ──► StackLens server ──► UI
                                                         │   ▲  LISTEN/NOTIFY (live updates)
                                                         ▼   │
                                                   PostgreSQL (traces, error_events, incidents, user_settings)
```

## Repository layout

| Path | Package | Role |
|---|---|---|
| `packages/contract` | `@stacklens/types` | Wire contract: TS types plus `schema/trace.schema.json`, the language-neutral source of truth for every SDK. |
| `packages/shared` | `@stacklens/shared` (private) | Isomorphic helpers used by frontend and backend: API types, span-tree maths, SQL/type formatters, config defaults. |
| `sdks/node-tracer` | `@stacklens/node-tracer` | Node.js SDK, embedded in your app. ESM + CJS. |
| `sdks/conformance` | — | Scenarios + checker every SDK (any language) must pass. |
| `stacklens/backend` | `@stacklens/backend` (private) | Server core with no Next.js dependency: HTTP handlers (`Request → Response`), auth, db, repositories, services. |
| `stacklens/frontend` | `stacklens` | Next.js UI. Compiles the backend in (`transpilePackages`) and ships as one npm CLI / Docker image. |
| `examples/<language>/*` | private | Runnable demo apps. |

Dependency direction: `frontend → backend → shared → contract`, and `sdks/* → contract`. Nothing depends on the frontend, and the backend never imports Next.js or React.

## Node SDK (`sdks/node-tracer/src`)

| Folder | Contents |
|---|---|
| `core/` | `tracer.ts` (runtime: traces, spans, capture), `context.ts` (AsyncLocalStorage), `options.ts` (config resolution, redaction matchers), `exporter.ts` (batched HTTP export), `errors.ts`, `console.ts` |
| `serialization/` | `capture.ts` (single-pass copy + type inference, the hot path), `serialize.ts` / `infer-type.ts` (reference implementations), `param-names.ts`, `shared.ts` |
| `instrumentation/` | `wrap.ts` (wrapFunction, instrument, instrumentClass, `@Traced`), `auto-instrument.ts` (CommonJS `require` hook) |
| `integrations/` | `express.ts` (entry middleware), `nestjs.ts` (DI-container walk), `typeorm.ts` |

**Request lifecycle:**
1. The middleware creates a trace and root span, runs the rest of the request inside `AsyncLocalStorage`, and binds `req`/`res` listeners so body parsers keep the context.
2. Each wrapped call opens a child span, captures its arguments, runs the original function inside the span's context, then captures the return value or error.
3. When the response finishes, request/response data is recorded and the trace is exported after `settleMs`.

### Performance

Export never blocks a response: traces are JSON-encoded one at a time and sent in batches from a background timer. Capturing values runs inline (Node is single-threaded, and values must be copied at call time because objects change afterwards):

| Per instrumented call | Cost |
|---|---|
| Outside a request | 0.03µs |
| Timing only (`captureArgs`/`captureResults` off) | 1.6µs |
| Small object, full capture | 3.8µs |
| 20-row array result, full capture | 18.8µs |

At full load on the Express example, tracing every request costs about 5–20% throughput, +1ms median latency, and p99 within ~1–7ms of untraced.

## Server

### Backend (`stacklens/backend/src`)

| Folder | Contents |
|---|---|
| `http/` | One file per API route (`traces/_id.ts` = `/api/traces/[id]`), exporting `GET`/`POST`/… as plain `(Request, ctx) => Response` functions. `request-context.ts` holds the per-request AsyncLocalStorage (headers, cookies, queued `Set-Cookie`) set up by `route()` / `withAuth()`. |
| `auth/` | Sessions, password hashing, `withAuth` role guard, rate limiting. |
| `db/` | Connection (PostgreSQL via `pg`, or embedded PGlite) and forward-only migrations. |
| `repositories/` | All SQL: traces, accounts, config, incidents, SLOs, views. |
| `services/` | Incident (ServiceNow / demo), digest, maintenance (retention, legacy import). |
| `domain/` | Pure logic: query parsing, trace summaries. |
| `env.ts` | All configuration. |

Because handlers only use web-standard `Request`/`Response`, the same backend can be mounted on another HTTP server later without touching the UI.

### Frontend (`stacklens/frontend/src`)

| Folder | Contents |
|---|---|
| `app/` | Next.js routes only: thin `page.tsx` files and `api/**/route.ts` adapters (`export { GET } from '@stacklens/backend/http/…'`). |
| `features/<name>/` | Page implementations and their private components. |
| `components/` | Shared UI: `ui/`, `layout/`, `charts/`, `data-display/`. |
| `lib/` | Client helpers: URL filter state, settings context, formatting. |
| `server/session.ts` | Reads the session cookie for server components (`cookies()` → `userForToken`). |

**Storage: PostgreSQL.**
- **Production:** set `DATABASE_URL` to use an external PostgreSQL server (via `pg`, pooled).
- **Local / `npx`:** without it, an embedded PostgreSQL (PGlite) runs in `STACKLENS_DATA_DIR/pg`, with the same schema and SQL.

| Table | Contents |
|---|---|
| `traces` | One row per request: indexed summary columns (time, app, project, user, route, status, duration, …), self time per layer (`kind_time`), error origins, and the full call tree in `payload` (`jsonb`). |
| `error_events` | One row per error origin, denormalized for fast error groups and incident tracking. |
| `incidents` | Demo-mode incidents (real ServiceNow incidents stay in ServiceNow). |
| `user_settings` | Per-browser preferences (profile, thresholds, UI state), keyed by an anonymous cookie. |
| `stacklens_migrations`, `stacklens_meta` | Applied schema migrations; one-shot jobs. |

- **Queries:** filtering, sorting, paging, metrics (percentiles, time buckets), error groups and facets run as SQL. Hotspots aggregate the most recent 2,000 call trees in range.
- **Retention:** a background job runs every minute; with several replicas, only one runs it at a time (advisory lock).
  - Full call trees are kept for the newest `STACKLENS_MAX_TRACES` healthy traces and `STACKLENS_MAX_ERROR_TRACES` traces with errors. Older traces keep their summary row.
  - Summaries older than `STACKLENS_RETENTION_DAYS`, or beyond `STACKLENS_MAX_SUMMARIES`, are deleted.
- **Migrations:** versioned and forward-only, applied on startup under an advisory lock. Data from older JSON-file versions is imported once.

**Live updates:** ingest sends `NOTIFY stacklens_traces`. Each replica's `GET /api/stream` (server-sent events) `LISTEN`s and tells its browsers. Pages refetch at most every 3 seconds, rendered as low-priority React transitions.
