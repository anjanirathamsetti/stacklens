import json
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

import stacklens
from stacklens._options import host_matcher, resolve_options
from stacklens._propagation import format_traceparent, format_tracestate, parent_from_headers, parse_traceparent, parse_tracestate
from stacklens._tracer import tracer
from conftest import assert_valid_trace


class Collector:
    def __init__(self, status=200):
        self.requests = []
        self.status = status
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                body = self.rfile.read(int(self.headers["content-length"]))
                outer.requests.append({"path": self.path, "headers": {k.lower(): v for k, v in self.headers.items()}, "body": json.loads(body)})
                self.send_response(outer.status)
                self.end_headers()
                self.wfile.write(b'{"accepted":1}')

            def log_message(self, *a):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.endpoint = f"http://127.0.0.1:{self.server.server_port}/api/ingest"

    def close(self):
        self.server.shutdown()
        self.server.server_close()


def init_http(**kw):
    tracer.initialized = False
    opts = dict(application="exp", settle_ms=0, debug=False, flush_interval_ms=50, batch_size=25)
    opts.update(kw)
    stacklens.init(**opts)
    tracer.exporter._warned = False


def test_batches_traces_to_ingest_with_api_key():
    c = Collector()
    try:
        init_http(endpoint=c.endpoint, api_key="sk_test_123", batch_size=3)
        for i in range(7):
            with stacklens.trace(f"job-{i}"):
                pass
        assert stacklens.flush()
        bodies = [r["body"] for r in c.requests]
        assert sum(len(b["traces"]) for b in bodies) == 7
        assert max(len(b["traces"]) for b in bodies) <= 3
        assert all(r["path"] == "/api/ingest" for r in c.requests)
        assert c.requests[0]["headers"]["authorization"] == "Bearer sk_test_123"
        assert c.requests[0]["headers"]["content-type"] == "application/json"
        for b in bodies:
            for t in b["traces"]:
                assert_valid_trace(t)
    finally:
        c.close()


def test_flush_interval_sends_without_explicit_flush():
    c = Collector()
    try:
        init_http(endpoint=c.endpoint, flush_interval_ms=30)
        with stacklens.trace("job"):
            pass
        deadline = time.time() + 3
        while not c.requests and time.time() < deadline:
            time.sleep(0.02)
        assert c.requests
    finally:
        c.close()


def test_collector_down_never_raises_and_warns_once(capsys):
    init_http(endpoint="http://127.0.0.1:9/api/ingest", debug=True)
    for _ in range(3):
        with stacklens.trace("job"):
            pass
        stacklens.flush()
    err = capsys.readouterr().err
    assert err.count("could not send traces") == 1
    assert tracer.exporter.failed_batches >= 1


def test_401_message_mentions_api_key(capsys):
    c = Collector(status=401)
    try:
        init_http(endpoint=c.endpoint, debug=True)
        with stacklens.trace("job"):
            pass
        stacklens.flush()
        assert "STACKLENS_API_KEY" in capsys.readouterr().err
    finally:
        c.close()


def test_custom_exporter_errors_are_swallowed():
    tracer.initialized = False

    def boom(_):
        raise RuntimeError("exporter failed")

    stacklens.init(application="x", exporter=boom, settle_ms=0, debug=False)
    with stacklens.trace("job"):
        pass
    assert stacklens.flush()


def test_settle_window_delays_export_and_flush_overrides_it():
    got = []
    tracer.initialized = False
    stacklens.init(application="x", exporter=got.append, settle_ms=10_000, debug=False)
    with stacklens.trace("job"):
        pass
    time.sleep(0.05)
    assert got == []
    assert stacklens.flush()
    assert len(got) == 1


# ---------------------------------------------------------------------------- options


def test_env_vars_and_defaults():
    o = resolve_options(
        {},
        env={
            "STACKLENS_APP": "env-app",
            "STACKLENS_PROJECT": "p",
            "STACKLENS_ENV": "staging",
            "STACKLENS_ENDPOINT": "http://collector:4300/api/ingest",
            "STACKLENS_API_KEY": "k",
            "STACKLENS_ENABLED": "false",
            "STACKLENS_PROPAGATE": "0",
            "STACKLENS_SAMPLE_RATE": "0.25",
        },
    )
    assert (o.application, o.project, o.environment, o.endpoint, o.api_key) == ("env-app", "p", "staging", "http://collector:4300/api/ingest", "k")
    assert o.enabled is False and o.propagate is False and o.sample_rate == 0.25
    d = resolve_options({}, env={})
    assert d.endpoint == "http://localhost:4300/api/ingest" and d.max_repeated_calls == 10 and d.max_spans_per_trace == 2000
    assert d.max_capture_bytes == 1_000_000 and d.max_depth == 6 and d.max_string_length == 2000


def test_code_options_win_and_camel_case_is_accepted():
    o = resolve_options({"serviceName": "svc", "maxRepeatedCalls": 3, "captureConsole": False}, env={"STACKLENS_APP": "env"})
    assert o.application == "svc" and o.max_repeated_calls == 3 and o.capture_logging is False
    with pytest.raises(TypeError):
        resolve_options({"nope": 1}, env={})


def test_init_twice_keeps_earlier_options():
    tracer.initialized = False
    stacklens.init(application="first", project="p1", debug=False)
    stacklens.init(environment="prod")
    o = stacklens.options()
    assert (o.application, o.project, o.environment) == ("first", "p1", "prod")


def test_propagate_to_matching():
    m = host_matcher(["billing.internal", ".svc.local", "api:8080", re.compile(r"^10\.")])
    assert m("billing.internal", "billing.internal:443")
    assert m("orders.svc.local", "orders.svc.local") and m("svc.local", "svc.local")
    assert m("api", "api:8080") and not m("api", "api:9090")
    assert m("10.0.0.5", "10.0.0.5:80")
    assert not m("api.stripe.com", "api.stripe.com")
    assert host_matcher(None)("anything", "anything")


# ---------------------------------------------------------------------------- W3C trace context


def test_traceparent_round_trip_and_validation():
    tid, sid = "0af7651916cd43dd8448eb211c80319c", "b7ad6b7169203331"
    assert format_traceparent(tid, sid) == f"00-{tid}-{sid}-01"
    assert parse_traceparent(f"00-{tid}-{sid}-01") == {"traceId": tid, "spanId": sid}
    assert parse_traceparent(f"00-{'0' * 32}-{sid}-01") is None
    assert parse_traceparent(f"ff-{tid}-{sid}-01") is None
    assert parse_traceparent(f"00-{tid}-{sid}-01-extra") is None
    assert parse_traceparent("garbage") is None and parse_traceparent(None) is None
    assert parse_traceparent([f"00-{tid}-{sid}-01"]) == {"traceId": tid, "spanId": sid}
    # non-W3C ids are hashed into shape (same algorithm as the Node SDK)
    tp = format_traceparent("custom-id", "x")
    assert re.match(r"^00-[0-9a-f]{32}-[0-9a-f]{16}-01$", tp)
    assert format_traceparent("abc", "1") == f"00-{'abc'.rjust(32, '0')}-{'1'.rjust(16, '0')}-01"


def test_tracestate():
    assert format_tracestate("orders api") == "stacklens=orders api"
    assert format_tracestate("a,b=c") == "stacklens=a_b_c"
    assert parse_tracestate("vendor=x,stacklens=orders-api") == "orders-api"
    assert parse_tracestate("vendor=x") is None
    assert parent_from_headers({"traceparent": "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01", "tracestate": "stacklens=web"})["service"] == "web"
