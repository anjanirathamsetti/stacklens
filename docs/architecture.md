# Architecture

```
your API ──(@stacklens/tracer)──► POST /api/ingest ──► StackLens server ──► UI
                                                         │   ▲  LISTEN/NOTIFY (live updates)
                                                         ▼   │
                                                   PostgreSQL (traces, error_events, incidents, user_settings)
```

## Packages

| Path | Package | Role |
|---|---|---|
| `packages/types` | `@stacklens/types` | Wire contract: `TraceRecord`, `SpanRecord`, ingest request. Shared by SDK and server. |
| `packages/tracer` | `@stacklens/tracer` | SDK, embedded in your app. ESM + CJS. |
| `apps/server` | `stacklens` | Collector API + UI (Next.js). Shipped as an npm CLI and a Docker image. |
| `examples/*` | private | Runnable demo apps. |

## SDK (`packages/tracer/src`)

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

## Server (`apps/server/src`)

| Folder | Contents |
|---|---|
| `app/` | Next.js routes only: thin `page.tsx` files (metadata + re-export) and `api/**/route.ts` handlers. |
| `features/<name>/` | Page implementations and their private components: overview, traces, errors, incidents, hotspots, settings, setup. |
| `components/` | Shared UI: `ui/` (primitives), `layout/` (sidebar, filter bar, time picker), `charts/`, `data-display/` (JSON viewer, pagination, badges). |
| `lib/` | Isomorphic helpers: API types, span-tree maths, URL filter state, settings context, formatting. |
| `server/` | `server-only` modules: `env.ts` (all configuration), `db/` (connection + migrations), `repositories/` (SQL for traces, incidents, settings), `trace-summary.ts`, `maintenance.ts` (retention, legacy import), `incident-service.ts` (ServiceNow / demo), `parse-query.ts`. |

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
