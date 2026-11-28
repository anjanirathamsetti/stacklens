import pytest

import stacklens
from conftest import assert_valid_trace, span

flask = pytest.importorskip("flask")
from flask import Blueprint, Flask, abort, g, jsonify, request  # noqa: E402
from flask.views import MethodView  # noqa: E402

from stacklens.integrations.flask import instrument_flask  # noqa: E402


class StockService:
    def reserve(self, sku, qty):
        if qty > 10:
            raise ValueError(f"cannot reserve {qty} of {sku}")
        return {"sku": sku, "reserved": qty}


stacklens.instrument_class(StockService)


def make_app():
    app = Flask(__name__)
    svc = StockService()
    bp = Blueprint("stock", __name__, url_prefix="/stock")

    @app.before_request
    def auth():
        token = request.headers.get("authorization")
        if token == "Bearer bad":
            abort(401)
        if token:
            g.user = {"id": 5}

    @bp.post("/<sku>/reserve")
    def reserve(sku):
        body = request.get_json()
        return jsonify(svc.reserve(sku, body["qty"]))

    @app.get("/items/<int:item_id>")
    def get_item(item_id):
        if item_id == 404:
            abort(404)
        return {"id": item_id}

    class WarehouseView(MethodView):
        def get(self, code):
            return {"code": code}

    app.register_blueprint(bp)
    app.add_url_rule("/warehouses/<code>", view_func=WarehouseView.as_view("warehouse"))
    instrument_flask(app)
    return app


class BufferedClient:
    """Reads every response body, like a real WSGI server (the trace closes when the body is sent)."""

    def __init__(self, app):
        self.c = app.test_client()

    def __getattr__(self, method):
        return lambda *a, **kw: self.c.open(*a, method=method.upper(), buffered=True, **kw)


@pytest.fixture
def client():
    return BufferedClient(make_app())


def test_request_trace_with_blueprint_view(captured, client):
    r = client.post("/stock/kb-01/reserve", json={"qty": 2}, headers={"authorization": "Bearer ok"})
    assert r.status_code == 200
    t = captured.one()
    assert_valid_trace(t)
    assert r.headers["x-stacklens-trace-id"] == t["id"]
    assert t["name"] == "POST /stock/<sku>/reserve" and t["http"]["route"] == "/stock/<sku>/reserve"
    assert t["http"]["request"]["body"] == {"qty": 2} and t["http"]["request"]["params"] == {"sku": "kb-01"}
    assert t["http"]["request"]["headers"]["authorization"] == "[REDACTED]"
    assert t["http"]["response"]["body"] == {"sku": "kb-01", "reserved": 2}
    v = span(t, "stock.reserve")
    assert v["kind"] == "controller" and v["args"] == ["kb-01"]
    assert span(t, "StockService.reserve")["result"] == {"sku": "kb-01", "reserved": 2}
    assert t["userId"] == "5"


def test_handled_500_records_the_exception(captured, client):
    r = client.post("/stock/kb-01/reserve", json={"qty": 50})
    assert r.status_code == 500
    t = captured.one()
    assert t["status"] == "error" and t["http"]["statusCode"] == 500
    assert t["spans"][0]["error"]["name"] == "ValueError"
    assert "cannot reserve 50" in t["spans"][0]["error"]["stack"]
    assert span(t, "StockService.reserve")["status"] == "error"


def test_client_errors_and_auth_failures(captured, client):
    assert client.get("/items/404").status_code == 404
    assert client.get("/items/1", headers={"authorization": "Bearer bad"}).status_code == 401
    traces = captured.flush()
    assert {t["http"]["statusCode"] for t in traces} == {404, 401}
    assert all(t["status"] == "ok" for t in traces)
    nf = next(t for t in traces if t["http"]["statusCode"] == 404)
    assert span(nf, "test_flask.get_item")["error"]["status"] == 404


def test_method_views(captured, client):
    assert client.get("/warehouses/ams").json == {"code": "ams"}
    t = captured.one()
    assert t["name"] == "GET /warehouses/<code>"
    assert span(t, "WarehouseView.get")["kind"] == "controller"
