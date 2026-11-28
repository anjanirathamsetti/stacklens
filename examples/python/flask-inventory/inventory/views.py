import os
import sys

from flask import Blueprint, abort, g, jsonify, request

from .models import Session
from .service import InsufficientStock, StockService, SupplierClient, WarehouseSyncError

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from shared_config import PROVIDERS_URL  # noqa: E402

bp = Blueprint("stock", __name__)
ADMIN_KEYS = {"inv_admin_key_1"}


@bp.before_request
def open_session():
    g.session = Session()


@bp.teardown_request
def close_session(exc):
    s = g.pop("session", None)
    if s is not None:
        s.close()


@bp.get("/stock/<sku>")
def stock(sku):
    levels = StockService(g.session).available(sku)
    if not levels:
        abort(404, description=f"unknown sku {sku}")
    return {"sku": sku, "warehouses": levels, "total": sum(levels.values())}


@bp.post("/stock/check")
def check():
    items = (request.get_json(silent=True) or {}).get("items")
    if not isinstance(items, list) or not items:
        return jsonify(error="items must be a non-empty list"), 400
    return {"items": StockService(g.session).check(items)}


@bp.post("/reservations")
def reserve():
    body = request.get_json()
    return StockService(g.session).reserve(body["sku"], int(body["qty"]), body.get("order_ref", "manual")), 201


@bp.post("/purchase-orders")
def purchase_order():
    if request.headers.get("x-admin-key") not in ADMIN_KEYS:
        abort(403, description="admin key required")
    body = request.get_json()
    return SupplierClient(PROVIDERS_URL).purchase_order(body["sku"], int(body["qty"])), 201


@bp.errorhandler(WarehouseSyncError)
def sync_error(e):
    return jsonify(error=str(e)), 503


@bp.errorhandler(InsufficientStock)
def insufficient(e):
    return jsonify(error=str(e)), 409
