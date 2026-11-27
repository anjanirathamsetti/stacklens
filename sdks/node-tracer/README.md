# @stacklens/node-tracer

Drop-in call-tree tracing for Node.js backends. Add it at your API's entry point and every request is recorded as a tree of internal calls (controller → handler → service → repository → SQL) with arguments, return values, inferred types, errors and logs. The [StackLens server](../../stacklens/frontend) displays them.

```bash
npm install @stacklens/node-tracer
```

## NestJS + TypeORM

```ts
import { stacklens } from '@stacklens/node-tracer';
import * as typeorm from 'typeorm';

stacklens.init({ application: 'billing-api', project: 'payments' });
stacklens.instrumentTypeORM(typeorm);

const app = await NestFactory.create(AppModule);
stacklens.instrumentNest(app); // before app.listen()
await app.listen(3000);
```

## Express (CommonJS)

```js
const { stacklens } = require('@stacklens/node-tracer');
stacklens.init({ application: 'orders-api', project: 'storefront' });
stacklens.autoInstrument({ include: [__dirname + '/src/'] }); // before requiring app code

const app = express();
app.use(stacklens.express());
```

## API

| | |
|---|---|
| `stacklens.init(options)` | Configure the tracer (see options below). |
| `stacklens.express()` | Entry-point middleware: one trace per request. |
| `stacklens.instrumentNest(app)` | Instrument a NestJS app's controllers, providers and repositories. |
| `stacklens.instrumentTypeORM(typeorm)` | Repository, EntityManager, QueryBuilder and SQL spans. |
| `stacklens.autoInstrument({ include })` | `require` hook for CommonJS apps. |
| `stacklens.instrument(obj)` / `instrumentClass(Cls)` / `wrap(fn, name)` / `@Traced()` | Manual instrumentation. |
| `stacklens.trace(name, fn)` | Root trace outside HTTP (jobs, consumers, scripts). |
| `stacklens.log(msg, data)` / `setAttributes()` / `setUser(id)` / `currentTraceId()` | Enrich the current trace. |
| `stacklens.propagationHeaders()` | `traceparent` / `tracestate` for transports StackLens doesn't patch (queues, gRPC). |
| `stacklens.flush()` | Send queued traces now. |

## Options

| Option | Default | Env |
|---|---|---|
| `application` (alias `serviceName`) | package.json `name` | `STACKLENS_APP` |
| `project` | `default` | `STACKLENS_PROJECT` |
| `environment` | `NODE_ENV` | `STACKLENS_ENV` |
| `endpoint` | `http://localhost:4300/api/ingest` | `STACKLENS_ENDPOINT` |
| `apiKey` | – (sent as `Authorization: Bearer …`; needed when the server requires a key) | `STACKLENS_API_KEY` |
| `enabled` | `true` | `STACKLENS_ENABLED` |
| `sampleRate` | `1` | |
| `captureArgs` / `captureResults` / `inferTypes` / `captureConsole` | `true` | |
| `getUserId(req)` | `req.user.id`, `req.auth.userId`, `x-user-id` header | |
| `redactKeys` | password, token, secret, authorization, cookie, apiKey, card, cvv, ssn | |
| `ignorePaths` / `ignoreMethods` | `/health*`, `/favicon.ico` | |
| `maxRepeatedCalls` | `10` (`0` turns collapsing off) | |
| `maxCaptureBytes` | `1000000` (≈1 MB of captured values per trace) | |
| `maxLogsPerSpan` | `50` | |
| `maxSpansPerTrace` | `2000` (last line of defence) | |
| `maxDepth` / `maxStringLength` / `maxArrayLength` / `maxObjectKeys` | `6` / `2000` / `30` / `50` | |
| `captureOutbound` | `true` – outgoing HTTP calls become spans | `STACKLENS_CAPTURE_OUTBOUND` |
| `propagate` | `true` – send W3C `traceparent` with outgoing calls | `STACKLENS_PROPAGATE` |
| `propagateTo` | every host; e.g. `['billing.internal', '.svc.local', /^10\./]` | |
| `exporter(trace)` | HTTP batch exporter | |

### Calls to other services

`init()` patches `http`/`https` `request`/`get` and the global `fetch`, so calls made with them (or with libraries built on them: axios, got, node-fetch, …) inside a trace become spans of kind `http`. Each span records the method, URL (secret-looking query values redacted), request and response headers and bodies (up to 64 KB, then the usual serializer limits and `redactKeys`), status and duration. A 5xx response marks the span as failed.

When the callee runs StackLens too, it links its trace to that span:

1. The caller sends `traceparent: 00-<trace id>-<span id>-01` and `tracestate: stacklens=<application>`.
2. The callee's middleware records `parent: { traceId, spanId, service }` on its trace and answers with `x-stacklens-trace-id`, which the caller stores as `outbound.childTraceId`.
3. In the StackLens UI the outgoing call expands into the callee's call tree; the callee's trace shows "Called by …".

Both services keep their own trace ids; the server joins them when the trace is viewed, so they may report in any order (or to different StackLens servers, in which case the UI shows the callee's trace id without the tree). Use `propagateTo` to keep the headers away from third-party APIs, or `propagate: false` to turn them off. Load StackLens before code that keeps its own reference to `http.request` or `fetch`.

### Loops and large requests

Tracing stays bounded however much work a request does:

- **Repeated calls are collapsed.** When the same function is called many times under the same parent (a helper in a 10,000-item loop, a query per row), the first `maxRepeatedCalls` calls are recorded in full. Later calls fold into one span with the call count, total, min, max and error count. Calls made inside them nest under that span and collapse the same way, so an N+1 query shows up as one row marked ×9,990.
- **Collapsed calls skip value capture,** which is the expensive part, and cost only a timer and a counter each.
- **Failures still show up.** The first 3 failing calls of a collapsed group are kept as their own spans, with their arguments.
- **A capture budget** (`maxCaptureBytes`) caps argument and result data per trace. After it's spent, calls keep their timing and errors but not their values, and the trace is marked `valuesTruncated`.
- **`maxSpansPerTrace`** remains a hard cap. Calls beyond it are counted in `droppedSpans`.

Measured on a 10,000-item loop calling a helper and a repository method (20,000 calls):

| | Spans | Payload | Heap per trace |
|---|---|---|---|
| Span cap only | 2,000 (18,000 calls lost) | 893 KB | 7.5 MB |
| With collapsing | 34 (no calls lost) | 17 KB | 0.9 MB |

## How it works

AsyncLocalStorage carries the current trace through `await`s. Wrapped functions open a child span only when a trace is active; outside one they call straight through (~0.03µs). Values are copied in a single bounded, circular-safe pass with sensitive keys redacted. Finished traces are JSON-encoded one at a time and sent in batches from a background timer, never on the request path. See [Performance](../../docs/architecture.md#performance) for measured overhead.

The package ships ESM and CommonJS builds. Use one module format per process: loading both creates two tracer instances.
