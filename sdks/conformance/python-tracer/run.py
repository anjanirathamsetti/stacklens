#!/usr/bin/env python3
"""Conformance runner for the Python SDK: implements sdks/conformance/scenarios.json with stacklens and
prints {"<scenario>": TraceRecord} to stdout. Standard library only.

    python3 sdks/conformance/python-tracer/run.py | node sdks/conformance/check.mjs -
"""

import json
import os
import sys
import threading
import urllib.request
from wsgiref.simple_server import WSGIRequestHandler, make_server

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "python-tracer", "src"))

import stacklens  # noqa: E402
from stacklens.integrations.wsgi import StackLensMiddleware  # noqa: E402

captured = []
stacklens.init(application="conformance", enabled=True, sample_rate=1, capture_logging=False, settle_ms=0, exporter=captured.append)


class OrderRepository:
    def save(self, order):
        return {"id": 1, **order}


class OrderService:
    def __init__(self, repo):
        self.repo = repo

    def place(self, input):
        return self.repo.save({**input, "status": "placed"})


class OrderController:
    def __init__(self, service):
        self.service = service

    def create(self, input):
        return self.service.place(input)


class PaymentError(Exception):
    pass


class PaymentService:
    def charge(self, amount):
        raise PaymentError("card declined")


class BatchHelper:
    def step(self, i):
        return i * 2


class BatchService:
    def __init__(self, helper):
        self.helper = helper

    def run(self):
        return sum(self.helper.step(i) for i in range(1000))


class AuditService:
    def record(self, event):
        stacklens.log("recorded", {"event": event})
        return True


for cls in (OrderRepository, OrderService, OrderController, PaymentService, BatchHelper, BatchService, AuditService):
    stacklens.instrument_class(cls)

scenarios = {
    "nested-calls": lambda: OrderController(OrderService(OrderRepository())).create({"sku": "A-1", "qty": 2}),
    "error": lambda: PaymentService().charge(42),
    "repeated-calls": lambda: BatchService(BatchHelper()).run(),
    "logs": lambda: AuditService().record("login"),
}

results = {}
for name, fn in scenarios.items():
    captured.clear()
    try:
        stacklens.trace(f"conformance.{name}", fn)
    except Exception:
        pass
    stacklens.flush()
    results[name] = captured[0] if captured else None


# cross-service: an instrumented WSGI callee and a job that calls it with urllib.request
def callee_app(environ, start_response):
    body = json.dumps({"id": 1}).encode()
    start_response("200 OK", [("content-type", "application/json"), ("content-length", str(len(body)))])
    return [body]


class QuietHandler(WSGIRequestHandler):
    def log_message(self, *args):
        pass


server = make_server("127.0.0.1", 0, StackLensMiddleware(callee_app), handler_class=QuietHandler)
threading.Thread(target=server.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{server.server_port}"
captured.clear()


def call_orders():
    with urllib.request.urlopen(f"{base}/orders/1", timeout=5) as res:
        return json.loads(res.read())


stacklens.trace("conformance.cross-service", call_orders)
stacklens.flush()
server.shutdown()
results["cross-service"] = next((t for t in captured if t["name"] == "conformance.cross-service"), None)
results["cross-service.child"] = next((t for t in captured if t.get("parent")), None)

sys.stdout.write(json.dumps(results, indent=2) + "\n")
