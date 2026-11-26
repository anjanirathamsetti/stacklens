# @stacklens/tracer

Drop-in call-tree tracing for Node.js backends. Add it at your API's entry point and every request is recorded as a tree of internal calls (controller → handler → service → repository → SQL) with arguments, return values, inferred types, errors and logs. The [StackLens server](../../apps/server) displays them.

```bash
npm install @stacklens/tracer
```

## NestJS + TypeORM

```ts
import { stacklens } from '@stacklens/tracer';
import * as typeorm from 'typeorm';

stacklens.init({ application: 'billing-api', project: 'payments' });
stacklens.instrumentTypeORM(typeorm);

const app = await NestFactory.create(AppModule);
stacklens.instrumentNest(app); // before app.listen()
await app.listen(3000);
```

## Express (CommonJS)

```js
const { stacklens } = require('@stacklens/tracer');
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
| `maxSpansPerTrace` | `2000` | |
| `maxDepth` / `maxStringLength` / `maxArrayLength` / `maxObjectKeys` | `6` / `2000` / `30` / `50` | |
| `exporter(trace)` | HTTP batch exporter | |

## How it works

AsyncLocalStorage carries the current trace through `await`s. Wrapped functions open a child span only when a trace is active; outside one they call straight through (~0.03µs). Values are copied in a single bounded, circular-safe pass with sensitive keys redacted. Finished traces are JSON-encoded one at a time and sent in batches from a background timer, never on the request path. See [Performance](../../docs/architecture.md#performance) for measured overhead.

The package ships ESM and CommonJS builds. Use one module format per process: loading both creates two tracer instances.
