import asyncio

import pytest

import stacklens
from conftest import assert_valid_trace, parent_of, span, spans_by_name

fastapi = pytest.importorskip("fastapi")
from fastapi import Depends, FastAPI, HTTPException  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from pydantic import BaseModel  # noqa: E402
from starlette.applications import Starlette  # noqa: E402
from starlette.responses import JSONResponse, StreamingResponse  # noqa: E402
from starlette.routing import Route  # noqa: E402

from stacklens.integrations.fastapi import instrument_fastapi  # noqa: E402


class InventoryRepository:
    async def stock(self, sku):
        await asyncio.sleep(0)
        return {"sku": sku, "on_hand": 4}


class InventoryService:
    def __init__(self):
        self.repo = InventoryRepository()

    async def check(self, skus):
        return await asyncio.gather(*(self.repo.stock(s) for s in skus))


stacklens.instrument_class(InventoryRepository)
stacklens.instrument_class(InventoryService)


class Reservation(BaseModel):
    sku: str
    qty: int


def current_user():
    return {"id": 77, "name": "ada"}


def make_app():
    app = FastAPI()
    svc = InventoryService()

    @app.get("/stock/{sku}")
    async def get_stock(sku: str, verbose: bool = False):
        return (await svc.check([sku, sku + "-alt"]))[0]

    @app.post("/reservations", status_code=201)
    def reserve(body: Reservation, user=Depends(current_user)):
        stacklens.set_user(user["id"])
        return {"reserved": body.qty, "sku": body.sku}

    @app.get("/missing/{sku}")
    async def missing(sku: str):
        raise HTTPException(status_code=404, detail=f"unknown sku {sku}")

    @app.get("/crash")
    async def crash():
        raise RuntimeError("inventory db unreachable")

    @app.get("/stream")
    def stream():
        return StreamingResponse(iter([b"a", b"b"]), media_type="text/plain")

    instrument_fastapi(app)

    @app.get("/late")  # added after instrument_fastapi: wrapped on first request
    async def late_route():
        return {"late": True}

    return app


@pytest.fixture
def client():
    return TestClient(make_app(), raise_server_exceptions=False)


def test_request_trace_route_and_handler_span(captured, client):
    r = client.get("/stock/kb-01?verbose=true", headers={"x-request-id": "r1", "cookie": "session=abc"})
    assert r.status_code == 200
    t = captured.one()
    assert_valid_trace(t)
    assert r.headers["x-stacklens-trace-id"] == t["id"]
    assert t["name"] == "GET /stock/{sku}" and t["kind"] == "http"
    http = t["http"]
    assert http["route"] == "/stock/{sku}" and http["statusCode"] == 200 and http["url"] == "/stock/kb-01?verbose=true"
    assert http["request"]["params"] == {"sku": "kb-01"} and http["request"]["query"] == {"verbose": "true"}
    assert http["request"]["headers"]["cookie"] == "[REDACTED]"
    assert http["response"]["body"] == {"sku": "kb-01", "on_hand": 4}
    h = span(t, "test_fastapi.get_stock")
    assert h["kind"] == "controller" and h["async"] is True
    assert h["params"] == ["sku", "verbose"] and h["args"] == ["kb-01", True]
    assert parent_of(t, h) is t["spans"][0]
    assert len(spans_by_name(t, "InventoryRepository.stock")) == 2


def test_body_models_dependencies_and_user(captured, client):
    r = client.post("/reservations", json={"sku": "kb-01", "qty": 2})
    assert r.status_code == 201
    t = captured.one()
    h = span(t, "test_fastapi.reserve")
    assert h["async"] is False  # sync handler, run in the threadpool with the trace context
    assert h["args"][0] == {"$class": "Reservation", "sku": "kb-01", "qty": 2}
    assert h["argTypes"][0] == "Reservation { sku: str; qty: int }"
    assert t["userId"] == "77" and t["http"]["request"]["body"] == {"sku": "kb-01", "qty": 2}


def test_http_exception_is_a_client_error(captured, client):
    assert client.get("/missing/zz").status_code == 404
    t = captured.one()
    assert t["status"] == "ok" and t["http"]["statusCode"] == 404
    h = span(t, "test_fastapi.missing")
    assert h["status"] == "error" and h["error"]["name"] == "HTTPException" and h["error"]["status"] == 404
    assert h["error"]["message"] == "unknown sku zz"


def test_unhandled_exception_is_a_500_with_traceback(captured, client):
    assert client.get("/crash").status_code == 500
    t = captured.one()
    assert t["status"] == "error" and t["http"]["statusCode"] == 500
    root = t["spans"][0]
    assert root["error"]["name"] == "RuntimeError" and "Traceback" in root["error"]["stack"]
    assert span(t, "test_fastapi.crash")["error"]["message"] == "inventory db unreachable"


def test_streaming_and_routes_added_later(captured, client):
    assert client.get("/stream").text == "ab"
    assert client.get("/late").json() == {"late": True}
    traces = {t["name"]: t for t in captured.flush()}
    assert traces["GET /stream"]["http"]["response"]["body"] == "ab"
    assert span(traces["GET /late"], "test_fastapi.late_route")


def test_incoming_traceparent_links_the_trace(captured, client):
    tp = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"
    client.get("/stock/a", headers={"traceparent": tp, "tracestate": "stacklens=web-bff"})
    assert captured.one()["parent"] == {"traceId": "0af7651916cd43dd8448eb211c80319c", "spanId": "b7ad6b7169203331", "service": "web-bff"}


def test_ignored_paths(captured, client):
    client.get("/health")
    assert captured.flush() == []


def test_plain_starlette(captured):
    async def ping(request):
        return JSONResponse({"pong": request.path_params["n"]})

    app = Starlette(routes=[Route("/ping/{n:int}", ping)])
    instrument_fastapi(app)
    assert TestClient(app).get("/ping/3").json() == {"pong": 3}
    t = captured.one()
    assert t["name"] == "GET /ping/{n:int}" or t["name"] == "GET /ping/{n}"
    assert span(t, "test_fastapi.ping")["kind"] == "controller"
