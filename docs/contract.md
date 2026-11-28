# Trace contract

Every StackLens SDK, in any language, sends the same JSON to `POST /api/ingest`. The contract lives in [`packages/contract`](../packages/contract):

| File | Role |
|---|---|
| `schema/trace.schema.json` | Language-neutral source of truth (JSON Schema 2020-12). SDKs in other languages generate or check their models against it. |
| `src/index.ts` | The same contract as TypeScript types (`@stacklens/types`), used by the Node SDK and the server. |
| `schema/validate.mjs` | Dependency-free validator for the schema subset we use. |
| `test/schema.test.ts` | Fails when the TS types and the schema list different fields. |

## Shape

```
IngestRequest { traces: TraceRecord[] }          (a bare TraceRecord is also accepted)
TraceRecord   { id, service, name, kind: http|job, startTime (epoch ms), duration, status, spans[], http?, parent?, sdk?, … }
SpanRecord    { id, parentId (null for root), name "Class.method", method, kind, start (ms since trace start),
                duration, status, async, params[], args?, result?, error?, logs?, collapsed?, outbound?, … }
OutboundCall  { method, url, host, statusCode?, propagated?, childTraceId? }
TraceParent   { traceId, spanId, service? }
SdkInfo       { name, language, version?, runtime? }
```

- `spans` is a flat list; the root span comes first. Build the tree with `parentId`.
- Times are milliseconds (fractional allowed). `start` is relative to the trace start, `startTime` is epoch.
- `args` and `result` are *serialized* values: plain JSON with depth, length and key limits applied and secrets redacted by the SDK.
- Repeated sibling calls (loops) are folded into one span with `collapsed: { count, totalDuration, minDuration, maxDuration, errors }`.
- `sdk` names the SDK and the language that recorded the trace (`{ "name": "stacklens-python-tracer", "version": "0.1.0", "language": "python", "runtime": "CPython 3.12.4" }`). The UI uses it to show the language and its idioms (Python signatures, `None`, tracebacks). It is optional; traces without it are shown Node-style.
- Type strings (`argTypes`, `resultType`) use the language's own names: TypeScript-like for Node (`{ id: number }`, `string[]`), Python names for Python (`{ id: int }`, `list[str]`, `Order { total: Decimal }`). Error `stack`s are in the language's native format (a Python `Traceback (most recent call last): …`).

## Cross-service calls

An outgoing HTTP call is a span of kind `http` with `outbound` set; its `args[0]` is the request (`method`, `url`, `headers`, `body`) and `result` the response (`statusCode`, `headers`, `body`), captured and redacted like any other value.

Propagation uses [W3C Trace Context](https://www.w3.org/TR/trace-context/):

- The caller sends `traceparent: 00-<trace id>-<outgoing span id>-01` and may add `tracestate: stacklens=<application>`. Trace ids are 32 hex characters and span ids 16, so SDKs should generate ids of that shape (the Node SDK does) and pass them through unchanged.
- The callee keeps its own trace id and sets `parent: { traceId, spanId, service }` from those headers. It should return its trace id in an `x-stacklens-trace-id` response header; the caller stores it as `outbound.childTraceId`.
- The server joins parent and child at read time (`GET /api/traces/:id/links`), so they may arrive in either order. A `childTraceId` without a stored trace means the callee reports elsewhere.

## Changing it

1. Additive changes only within a major version (new optional fields). The server must accept traces from any SDK of the same major version.
2. Change `src/index.ts` **and** `schema/trace.schema.json` together; `npm test -w @stacklens/types` enforces it.
3. If behaviour changes, add or adjust a scenario in [`sdks/conformance/scenarios.json`](../sdks/conformance/scenarios.json).
4. A breaking change needs a new major version, a new `$id` (`…/trace/v2.json`) and server support for both versions during the transition.
