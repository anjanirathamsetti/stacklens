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
TraceRecord   { id, service, name, kind: http|job, startTime (epoch ms), duration, status, spans[], http?, … }
SpanRecord    { id, parentId (null for root), name "Class.method", method, kind, start (ms since trace start),
                duration, status, async, params[], args?, result?, error?, logs?, collapsed?, … }
```

- `spans` is a flat list; the root span comes first. Build the tree with `parentId`.
- Times are milliseconds (fractional allowed). `start` is relative to the trace start, `startTime` is epoch.
- `args` and `result` are *serialized* values: plain JSON with depth, length and key limits applied and secrets redacted by the SDK.
- Repeated sibling calls (loops) are folded into one span with `collapsed: { count, totalDuration, minDuration, maxDuration, errors }`.

## Changing it

1. Additive changes only within a major version (new optional fields). The server must accept traces from any SDK of the same major version.
2. Change `src/index.ts` **and** `schema/trace.schema.json` together; `npm test -w @stacklens/types` enforces it.
3. If behaviour changes, add or adjust a scenario in [`sdks/conformance/scenarios.json`](../sdks/conformance/scenarios.json).
4. A breaking change needs a new major version, a new `$id` (`…/trace/v2.json`) and server support for both versions during the transition.
