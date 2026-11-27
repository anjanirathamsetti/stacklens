# Example: Express (plain JavaScript)

An orders API (controllers → handlers → services → repositories over a fake async DB) traced with zero changes to the business code:

- `stacklens.autoInstrument()` wraps everything exported from `src/` via a `require` hook.
- `stacklens.express()` creates one trace per request.
- A fake auth middleware sets `req.user`, which becomes the trace's user id.

```bash
npm run example:express   # http://localhost:3001
curl localhost:3001/api/users/1
curl localhost:3001/api/orders/2/fail   # a traced 500
```

## Heavy endpoints (big call trees)

For trying StackLens on requests with thousands of internal calls (see `src/lab`):

| Endpoint | Pattern |
|---|---|
| `GET /api/orders/report?items=10000` | One loop calling a helper and a repository per item, with a few failures |
| `GET /api/lab/catalog-sync?batches=20&size=250` | Nested loops: batches → items → validate / price / convert / write |
| `GET /api/lab/feed/7?friends=40` | Parallel `Promise.all` fan-out with an N+1 author lookup per post |
| `GET /api/lab/categories/tree?depth=4&breadth=4` | Recursion (`depth=6` shows the `maxSpansPerTrace` backstop) |
| `POST /api/lab/invoices/run?customers=300` | Deep call chain repeated per customer, with console output in the loop |

`npm run seed` (from the repo root) calls each of these a few times.
