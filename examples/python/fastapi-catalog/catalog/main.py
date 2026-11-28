"""catalog-api entry point.

    uvicorn catalog.main:app --port 3011        (from examples/python/fastapi-catalog)
"""

import logging

import stacklens
from stacklens.integrations.celery import instrument_celery
from stacklens.integrations.fastapi import instrument_fastapi
from stacklens.integrations.sqlalchemy import instrument_sqlalchemy

# 1) StackLens first: options come from STACKLENS_* env vars when not given here
stacklens.init(application="catalog-api", project="storefront")
instrument_sqlalchemy()  # SQL spans for every engine
instrument_celery()  # enqueue spans + traceparent in task headers
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

from fastapi import FastAPI, Request  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402

from . import auth, clients, repositories, services, tasks  # noqa: E402
from .db import init_db  # noqa: E402

# 2) trace our own code: every class/function in these modules becomes a span (before the routes import
#    them, so FastAPI's Depends() gets the traced auth functions)
for module in (repositories, services, clients, tasks, auth):
    stacklens.instrument_module(module, exclude=["money"])

from .routes import admin, products, quotes  # noqa: E402

app = FastAPI(title="catalog-api")
app.include_router(products.router)
app.include_router(quotes.router)
app.include_router(admin.router)


@app.exception_handler(services.UnknownProduct)
async def unknown_product(request: Request, exc: services.UnknownProduct):
    return JSONResponse({"error": str(exc), "traceId": stacklens.current_trace_id()}, status_code=404)


@app.exception_handler(services.OutOfStock)
async def out_of_stock(request: Request, exc: services.OutOfStock):
    return JSONResponse({"error": str(exc), "traceId": stacklens.current_trace_id()}, status_code=409)


@app.exception_handler(clients.UpstreamError)
async def upstream(request: Request, exc: clients.UpstreamError):
    return JSONResponse({"error": str(exc), "traceId": stacklens.current_trace_id()}, status_code=exc.status_code)


@app.get("/health")
def health():
    return {"ok": True}


init_db()
# 3) one trace per request + a span per route handler
instrument_fastapi(app)
