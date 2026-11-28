# Cross-service tracing

When an instrumented API calls another API over HTTP, StackLens records the call on the caller's trace and, if the callee runs StackLens too, links the callee's call tree to that call.

| Callee | What you see on the outgoing call |
|---|---|
| Runs StackLens and reports to the same server | A chevron that expands the callee's call tree inline, an "Open trace" link, and on the callee's trace a "Called by …" banner |
| Runs StackLens but its trace isn't stored here | "Trace not received": it may still be arriving, or the callee reports to another StackLens server. Click to check again. |
| Doesn't run StackLens (third-party APIs, uninstrumented services) | "Call graph not available — `<host>` doesn't report to StackLens", plus the full request and response |

On every outgoing call, whatever the callee, the SDK records the method, the URL (secret-looking query values redacted), request headers and body, response status, headers and body, duration, and any error. Values go through the normal capture limits (`maxCaptureBytes`, `maxStringLength`, `maxArrayLength`, `maxObjectKeys`, bodies over 64 KB are cut) and `redactKeys` (`authorization`, `cookie`, `set-cookie`, `x-api-key`, `password`, …). In Node.js this covers `http`/`https`, global `fetch` and libraries built on them (axios, got, node-fetch); in Python `requests`, `httpx` (sync and async), `urllib3` and `urllib.request`. Compressed responses are inflated for the record. Streamed bodies are copied as the app reads them. The SDK never reads a body itself, so a body the app doesn't read isn't recorded.

In the traces list, a request that made outgoing calls shows a globe badge with the number of calls and how many of them have a linked trace (`↗ 3 · 2 traced`). Use the **Calls other services** filter to list only those requests.

How the link works: the caller sends a W3C `traceparent` header (plus `tracestate: stacklens=<app>`). The callee records it as its trace's `parent` and answers with `x-stacklens-trace-id`. The server joins the two when you open the trace, so they can arrive in either order. SDK options: `captureOutbound`, `propagate`, `propagateTo` (see the [Node](../sdks/node-tracer/README.md#calls-to-other-services) and [Python](../sdks/python-tracer/README.md#calls-to-other-services) READMEs; Python spells them `capture_outbound`, `propagate`, `propagate_to`). Celery tasks are linked the same way: the Python SDK sends `traceparent` in the task's message headers, and the worker's trace records it as its `parent`. Wire format: [contract.md](contract.md#cross-service-calls).

## Try it

The demo has three services:

| Service | Port (default / launch entry) | StackLens |
|---|---|---|
| `examples/node/express-basic`: orders-api, the caller | 3001 / 3021 | yes |
| `examples/node/nestjs-typeorm`: billing-api | 3002 / 3022 | yes |
| `examples/node/shipping-service`: a plain `node:http` API | 3003 / 3023 | **no** |

`POST /api/checkout/:userId` on orders-api makes three calls:

1. `fetch` GET to billing-api for the invoice (linked call tree)
2. axios POST to shipping-service for a quote (no call graph; request and response recorded, with the `x-api-key` header redacted)
3. `node:http` POST to billing-api to create the order (linked call tree)

`GET /api/shipping/labels/:orderId` streams a text label from shipping-service with `fetch`.

### With the desktop app's launch entries

Start these from the preview / launch menu: `xservice-dashboard` (port 4320, its own data dir `~/.stacklens/xservice-data`, so your server on 4300 is untouched), `xservice-example-nest`, `xservice-shipping`, `xservice-example-express`. Both example apps send their traces to 4320.

### From a terminal

Run each command in its own terminal, from the repo root:

```bash
npm ci && npm run build:packages
```

```bash
STACKLENS_DATA_DIR=~/.stacklens/xservice-data NEXT_DIST_DIR=.next-xservice npm exec -w stacklens/frontend -- next dev -p 4320
```

```bash
PORT=3022 STACKLENS_ENDPOINT=http://localhost:4320/api/ingest npm run example:nest
```

```bash
PORT=3023 npm run example:shipping
```

```bash
PORT=3021 BILLING_URL=http://localhost:3022 SHIPPING_URL=http://localhost:3023 STACKLENS_ENDPOINT=http://localhost:4320/api/ingest npm run example:express
```

### Send requests

```bash
curl -X POST localhost:3021/api/checkout/1 -H 'content-type: application/json' -d '{"items":[{"sku":"kb-01","price":49.5,"qty":2}]}'
```

```bash
curl -X POST localhost:3021/api/checkout/1 -H 'content-type: application/json' -d '{"zip":"00000"}'
```

```bash
curl localhost:3021/api/shipping/labels/123
```

```bash
curl -X POST localhost:3021/api/checkout/42
```

These are, in order: a successful checkout; a shipping-service 503, which is recorded as a failed outgoing call with its response body; a streamed response body; and billing-api answering 404, where the call tree shows where in billing-api the error came from.

For continuous traffic, run `EXPRESS_URL=http://localhost:3021 NEST_URL=http://localhost:3022 npm run traffic`.

### What to look at

1. Open http://localhost:4320. On first use, create an admin account on `/welcome`.
2. **Traces**: the checkout rows show `↗ 3 · 2 traced`. Hover the badge for the hosts. Choose **Calls other services** to filter.
3. Open a checkout trace. In the call tree:
   - `GET localhost:3022/orders/invoice/:id` and `POST localhost:3022/orders` carry a blue `billing-api` chip. Click the chevron to expand billing-api's call tree inline (controller → service → repository → SQL). Select any of its calls to see its arguments. Use ↗ to open billing-api's own trace.
   - `POST localhost:3023/quotes` shows an amber `localhost:3023 · no call graph` chip. Select it: the inspector says "Call graph not available — localhost:3023 doesn't report to StackLens". **Input** shows the request as sent (method, URL, headers with `x-api-key: [REDACTED]`, JSON body). **Output** shows the response as received (status, headers, body, duration).
4. Open the billing-api trace: the banner says "Called by orders-api → POST /api/checkout/:userId" and links back.
5. Stop shipping-service and repeat the checkout: the quote call becomes a failed outgoing call with the connection error (`ECONNREFUSED`), and orders-api's 502 response is in the trace.

To reset, stop the dashboard and delete `~/.stacklens/xservice-data`.

## Node.js ↔ Python

The Python examples ([examples/python](../examples/python/README.md)) link to and from the Node ones, so one request crosses both languages:

```
orders-api (Node, Express)  POST /api/quotes/:userId
  └─ fetch → catalog-api (Python, FastAPI)  POST /quotes
       ├─ httpx → inventory-api (Python, Flask)       linked call tree
       ├─ httpx → billing-api (Node, NestJS)          linked call tree
       ├─ httpx → shipping-service (Node, no SDK)     "no call graph"
       ├─ httpx → providers (fraud, FX; no SDK)       "no call graph"
       └─ Celery → notifications-worker               "Called by catalog-api" on the task's trace
```

Run them with `npm run sample:python` (see the examples README); expand the `catalog-api` chip on an `orders-api` quote to see the Python call tree inline.
