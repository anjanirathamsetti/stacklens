import json
import os
import threading
from typing import Any, Dict, List, Optional
from wsgiref.simple_server import WSGIRequestHandler, WSGIServer, make_server
from socketserver import ThreadingMixIn

import pytest

import stacklens
from stacklens._tracer import tracer

SCHEMA_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "..", "packages", "contract", "schema", "trace.schema.json")


class Captured:
    def __init__(self) -> None:
        self.traces: List[Dict[str, Any]] = []

    def __call__(self, record: Dict[str, Any]) -> None:
        self.traces.append(record)

    def flush(self) -> List[Dict[str, Any]]:
        assert stacklens.flush(5.0)
        return self.traces

    def one(self, name: Optional[str] = None) -> Dict[str, Any]:
        traces = self.flush()
        if name is not None:
            traces = [t for t in traces if t["name"] == name]
        assert len(traces) == 1, [t["name"] for t in self.traces]
        return traces[0]


def configure(**options: Any) -> Captured:
    cap = Captured()
    tracer.initialized = False
    defaults = dict(application="test-app", project="tests", environment="test", exporter=cap, settle_ms=0, debug=False, capture_logging=True)
    defaults.update(options)
    stacklens.init(**defaults)
    return cap


@pytest.fixture
def captured() -> Captured:
    cap = configure()
    yield cap
    stacklens.flush(2.0)


def spans_by_name(trace: Dict[str, Any], name: str) -> List[Dict[str, Any]]:
    return [s for s in trace["spans"] if s["name"] == name]


def span(trace: Dict[str, Any], name: str) -> Dict[str, Any]:
    found = spans_by_name(trace, name)
    assert found, f"no span {name}; have {[s['name'] for s in trace['spans']]}"
    return found[0]


def parent_of(trace: Dict[str, Any], s: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    return next((p for p in trace["spans"] if p["id"] == s["parentId"]), None)


# ---------------------------------------------------------------------------- schema validation (the subset trace.schema.json uses)

_SCHEMA = None


def _schema() -> Dict[str, Any]:
    global _SCHEMA
    if _SCHEMA is None:
        with open(SCHEMA_PATH, encoding="utf-8") as f:
            _SCHEMA = json.load(f)
    return _SCHEMA


def _type_ok(v: Any, t: str) -> bool:
    return {
        "object": isinstance(v, dict),
        "array": isinstance(v, list),
        "string": isinstance(v, str),
        "number": isinstance(v, (int, float)) and not isinstance(v, bool),
        "integer": isinstance(v, int) and not isinstance(v, bool),
        "boolean": isinstance(v, bool),
        "null": v is None,
    }[t]


def _validate(v: Any, s: Dict[str, Any], path: str, errors: List[str]) -> None:
    root = _schema()
    if "$ref" in s:
        s = root["$defs"][s["$ref"].split("/")[-1]]
    if "oneOf" in s:
        ok = 0
        for sub in s["oneOf"]:
            e: List[str] = []
            _validate(v, sub, path, e)
            ok += not e
        if ok != 1:
            errors.append(f"{path}: matches {ok} oneOf branches")
        return
    if "enum" in s and v not in s["enum"]:
        errors.append(f"{path}: {v!r} not in {s['enum']}")
    if "type" in s:
        types = s["type"] if isinstance(s["type"], list) else [s["type"]]
        if not any(_type_ok(v, t) for t in types):
            errors.append(f"{path}: expected {types}, got {type(v).__name__}")
            return
    if isinstance(v, (int, float)) and not isinstance(v, bool) and "minimum" in s and v < s["minimum"]:
        errors.append(f"{path}: {v} < {s['minimum']}")
    if isinstance(v, float) and v != v:
        errors.append(f"{path}: NaN")
    if isinstance(v, str) and len(v) < s.get("minLength", 0):
        errors.append(f"{path}: too short")
    if isinstance(v, dict):
        for r in s.get("required", []):
            if r not in v:
                errors.append(f"{path}: missing {r}")
        props = s.get("properties", {})
        for k, val in v.items():
            if k in props:
                _validate(val, props[k], f"{path}.{k}", errors)
            elif s.get("additionalProperties") is False:
                errors.append(f"{path}: unexpected property {k}")
    if isinstance(v, list) and "items" in s:
        for i, item in enumerate(v):
            _validate(item, s["items"], f"{path}[{i}]", errors)


def assert_valid_trace(trace: Dict[str, Any]) -> None:
    errors: List[str] = []
    # round-trip through JSON first: that's what the server receives
    _validate(json.loads(json.dumps(trace, allow_nan=False)), {"$ref": "#/$defs/TraceRecord"}, "trace", errors)
    ids = [s["id"] for s in trace["spans"]]
    if trace["spans"][0]["parentId"] is not None:
        errors.append("root span must come first")
    if len(set(ids)) != len(ids):
        errors.append("span ids must be unique")
    for s in trace["spans"]:
        if s["parentId"] is not None and s["parentId"] not in ids:
            errors.append(f"span {s['name']} has unknown parent")
    assert not errors, errors


# ---------------------------------------------------------------------------- a small threaded WSGI server for HTTP tests


class _ThreadingWSGIServer(ThreadingMixIn, WSGIServer):
    daemon_threads = True


class _Quiet(WSGIRequestHandler):
    def log_message(self, *args: Any) -> None:
        pass


class LiveServer:
    def __init__(self, app: Any):
        self.server = make_server("127.0.0.1", 0, app, server_class=_ThreadingWSGIServer, handler_class=_Quiet)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_port}"

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()
