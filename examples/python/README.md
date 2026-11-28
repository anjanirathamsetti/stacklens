# Python examples

Production-shaped services traced with the [Python SDK](../../sdks/python-tracer/README.md). They call each other and the [Node examples](../node), so one request crosses languages.

| Service | Folder | Port | Stack | StackLens |
|---|---|---|---|---|
| catalog-api | `fastapi-catalog/` | 3011 | FastAPI, SQLAlchemy (SQLite), httpx, Celery producer | yes |
| inventory-api | `flask-inventory/` | 3012 | Flask, SQLAlchemy (SQLite), requests | yes |
| notifications-worker | `celery-worker/` | – | Celery (filesystem broker, no Redis needed) | yes |
| providers | `fake-providers/` | 3013 | standard library: fake email, FX, fraud-scoring and supplier APIs | **no** |
| orders-api | `../node/express-basic` | 3031 here (3001 by default) | Express | yes (Node) |
| billing-api | `../node/nestjs-typeorm` | 3032 here (3002) | NestJS + TypeORM | yes (Node) |
| shipping-service | `../node/shipping-service` | 3033 here (3003) | `node:http` | **no** |

What they do:

- **catalog-api**: `GET /products`, `GET /products/{sku}` (SQL with joins, pricing rules); `POST /quotes` (bearer token required) loads products, then calls inventory-api, billing-api and shipping-service **concurrently** (`asyncio.gather`), converts currency through the FX provider, scores fraud in a thread (`asyncio.to_thread`) and enqueues a Celery email task; admin endpoints reprice a product (403 for non-admins), rebuild ratings with an **N+1** lazy-load loop, and run a deliberately **slow** recursive-CTE report.
- **inventory-api**: stock per warehouse (a small N+1), bulk stock checks with low-stock warnings in the logs, reservations (409 when short), purchase orders to the supplier API (admin key, 403 otherwise), and an occasional 503 "warehouse sync lag".
- **notifications-worker**: `send_quote_email` renders a template and calls the email provider (429 → retry, sometimes 500); `rebuild_search_index` is a bulk loop whose thousands of calls collapse into one span.
- **orders-api** (Node) gained `GET /api/catalog/:sku` and `POST /api/quotes/:userId`, which call catalog-api: Node → Python → (Python, Node) in one linked tree.

Errors on purpose: unknown products (404), missing/invalid tokens (401), non-admins (403), out of stock (409), a 0 % GPU promo rule that divides by zero in multi-GPU quotes (500, `ZeroDivisionError`), unsupported currencies (the FX provider's 422 surfaces as a 500 with `httpx.HTTPStatusError`), billing-api 404 for unknown customers, shipping-service 503 for zip `00000` (502), email-provider failures in the worker.

## Setup

From the repository root:

```bash
python3 -m venv examples/python/.venv
```

```bash
examples/python/.venv/bin/pip install -r examples/python/requirements.txt
```

```bash
npm ci && npm run build:packages
```

The SQLite databases and the Celery broker folder are created in `examples/python/.data/` on first start (delete it to reset).

## Sample data in a throwaway StackLens server

Start a StackLens server with its own data folder on port 4310 (your server on 4300 is untouched):

```bash
STACKLENS_DATA_DIR=$TMPDIR/stacklens-python-test NEXT_DIST_DIR=.next-test npm exec -w stacklens/frontend -- next dev -p 4310
```

Then, in another terminal, start every example, send traffic and stop them again:

```bash
npm run sample:python -- --requests 600
```

Open http://localhost:4310 (create an admin account on first use). Delete `$TMPDIR/stacklens-python-test` to start over. `npm run sample:python` refuses to send to port 4300 unless you pass `--main`.

### Into the demo server (port 4200)

The `stacklens-demo` launch entry runs a demo server on port 4200 with data in `~/.stacklens/demo-data`. With it running:

```bash
npm run sample:python -- --endpoint http://localhost:4200/api/ingest --requests 1500
```

### Running the services yourself

```bash
STACKLENS_ENDPOINT=http://localhost:4310/api/ingest BILLING_URL=http://localhost:3032 SHIPPING_URL=http://localhost:3033 npm run example:python
```

```bash
EXPRESS_URL=http://localhost:3031 npm run traffic:python -- --rps 5
```

`example:python` starts catalog-api, inventory-api, the worker and the providers together (Ctrl-C stops all of them); start the Node examples on 3031–3033 with `PORT=…` and `STACKLENS_ENDPOINT=…` (and `CATALOG_URL=http://localhost:3011` for orders-api) as in [cross-service tracing](../../docs/cross-service-tracing.md). Each service on its own: `uvicorn catalog.main:app --port 3011` in `fastapi-catalog/`, `python -m inventory.app` in `flask-inventory/`, `celery -A notifications.worker worker --pool=threads -c 4` in `celery-worker/`.

## What to look at

1. **Traces**, filter by application `catalog-api`: route names are FastAPI templates (`GET /products/{sku}`); the header shows a **Python** chip.
2. A `POST /quotes` with status 201: three outgoing calls run side by side; `inventory-api` and `billing-api` expand inline, `shipping-service` and the providers say "no call graph". Select `QuoteService.create_quote` → **Details**: `async def create_quote(user: {…}, items: list[{ sku: str; qty: int }], …) -> Quote {…}`.
3. A `POST /quotes` with status 500: `ZeroDivisionError` in `PricingService.bundle_discount`, with the Python traceback (file, line, source) in the inspector.
4. `POST /admin/reindex-ratings`: the N+1 lazy loads fold into one `SQL.query` span with a call count; `GET /admin/reports/category-revenue` is a single slow `SQL.query`.
5. An `orders-api` `POST /api/quotes/:userId` (Node): expand the `catalog-api` chip to see the Python call tree under the Node call, and keep expanding into inventory-api and billing-api.
6. A `notifications.send_quote_email` trace: "Called by catalog-api", the email provider call, and retries after 429s.
