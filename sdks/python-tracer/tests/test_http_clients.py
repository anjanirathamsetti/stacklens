import asyncio
import json
import re
import urllib.request

import pytest

import stacklens
from stacklens.integrations.wsgi import StackLensMiddleware
from conftest import LiveServer, assert_valid_trace, configure, span, spans_by_name

requests = pytest.importorskip("requests")
httpx = pytest.importorskip("httpx")
urllib3 = pytest.importorskip("urllib3")


def callee(environ, start_response):
    path = environ["PATH_INFO"]
    if path.startswith("/fail"):
        body = b'{"error":"maintenance"}'
        start_response("503 Service Unavailable", [("content-type", "application/json")])
        return [body]
    if path.startswith("/image"):
        start_response("200 OK", [("content-type", "image/png")])
        return [b"\x89PNG" + b"0" * 100]
    length = int(environ.get("CONTENT_LENGTH") or 0)
    sent = environ["wsgi.input"].read(length) if length else b""
    body = json.dumps({"id": 1, "path": path, "echo": json.loads(sent) if sent else None, "traceparent": environ.get("HTTP_TRACEPARENT")}).encode()
    start_response("200 OK", [("content-type", "application/json"), ("content-length", str(len(body)))])
    return [body]


@pytest.fixture
def server():
    s = LiveServer(StackLensMiddleware(callee))
    yield s
    s.close()


def caller_and_child(cap, name="caller"):
    traces = cap.flush()
    caller = next(t for t in traces if t["name"] == name)
    children = [t for t in traces if t.get("parent")]
    return caller, children


def check_linked(caller, child, method="GET", status=200):
    assert_valid_trace(caller)
    assert_valid_trace(child)
    out = [s for s in caller["spans"] if "outbound" in s]
    assert len(out) == 1
    s = out[0]
    assert s["kind"] == "http" and s["async"] is True and s["params"] == ["request"]
    ob = s["outbound"]
    assert ob["method"] == method and ob["statusCode"] == status and ob["propagated"] is True
    assert ob["childTraceId"] == child["id"]
    assert child["parent"] == {"traceId": caller["id"], "spanId": s["id"], "service": "test-app"}
    assert re.match(r"^(GET|POST) 127\.0\.0\.1:\d+/orders/:id$", s["name"])
    return s


@pytest.mark.parametrize("client", ["requests", "httpx", "urllib3", "urllib"])
def test_get_is_traced_and_linked(captured, server, client):
    url = f"{server.url}/orders/1?api_key=secret&page=2"
    with stacklens.trace("caller"):
        if client == "requests":
            body = requests.get(url, headers={"Authorization": "Bearer x"}, timeout=5).json()
        elif client == "httpx":
            body = httpx.get(url, headers={"Authorization": "Bearer x"}).json()
        elif client == "urllib3":
            body = json.loads(urllib3.PoolManager().request("GET", url, headers={"Authorization": "Bearer x"}).data)
        else:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"Authorization": "Bearer x"}), timeout=5) as res:
                body = json.loads(res.read())
    assert body["traceparent"].startswith("00-")
    caller, children = caller_and_child(captured)
    assert len(children) == 1
    s = check_linked(caller, children[0])
    assert s["outbound"]["url"].endswith("/orders/1?api_key=[REDACTED]&page=2")
    req = s["args"][0]
    assert req["method"] == "GET" and req["headers"]["authorization"] == "[REDACTED]"
    assert req["headers"]["traceparent"] == body["traceparent"]
    assert s["result"]["statusCode"] == 200
    if client != "urllib":  # urllib's body is read by the caller after the call returns
        assert s["result"]["body"]["id"] == 1


def test_requests_post_json_body_and_single_span(captured, server):
    with stacklens.trace("caller"):
        requests.post(f"{server.url}/orders/7", json={"sku": "kb-01", "password": "p"}, timeout=5)
    caller, children = caller_and_child(captured)
    s = check_linked(caller, children[0], method="POST")
    assert s["args"][0]["body"] == {"sku": "kb-01", "password": "[REDACTED]"}
    # requests → urllib3 is recorded once
    assert len([x for x in caller["spans"] if x["kind"] == "http" and x["parentId"] is not None]) == 1


async def test_httpx_async_client(captured, server):
    async with stacklens.trace("caller"):
        async with httpx.AsyncClient() as client:
            r1, r2 = await asyncio.gather(client.get(f"{server.url}/orders/1"), client.get(f"{server.url}/orders/2"))
    assert r1.status_code == r2.status_code == 200
    traces = captured.flush()
    caller = next(t for t in traces if t["name"] == "caller")
    out = [s for s in caller["spans"] if "outbound" in s]
    assert len(out) == 2
    children = {t["parent"]["spanId"]: t for t in traces if t.get("parent")}
    assert {s["id"] for s in out} == set(children)
    assert all(s["outbound"]["childTraceId"] == children[s["id"]]["id"] for s in out)


def test_5xx_marks_the_call_failed(captured, server):
    with stacklens.trace("caller"):
        r = requests.get(f"{server.url}/fail/now", timeout=5)
    assert r.status_code == 503
    caller, _ = caller_and_child(captured)
    s = next(x for x in caller["spans"] if "outbound" in x)
    assert s["status"] == "error" and s["error"]["name"] == "HttpError" and s["error"]["status"] == 503
    assert s["result"]["body"] == {"error": "maintenance"}


def test_connection_errors_are_recorded_and_reraised(captured):
    with pytest.raises(requests.ConnectionError):
        with stacklens.trace("caller"):
            requests.get("http://127.0.0.1:9/orders/1", timeout=2)
    caller = captured.one("caller")
    s = next(x for x in caller["spans"] if "outbound" in x)
    assert s["status"] == "error" and s["error"]["name"] == "ConnectionError"
    assert "statusCode" not in s["outbound"]


def test_binary_bodies_are_summarized(captured, server):
    with stacklens.trace("caller"):
        requests.get(f"{server.url}/image/1", timeout=5)
    caller, _ = caller_and_child(captured)
    s = next(x for x in caller["spans"] if "outbound" in x)
    assert s["result"]["body"] == "[image/png body, 104 bytes]"


def test_propagate_to_keeps_headers_from_other_hosts(server):
    cap = configure(propagate_to=["billing.internal"])
    with stacklens.trace("caller"):
        body = requests.get(f"{server.url}/orders/1", timeout=5).json()
    assert body["traceparent"] is None
    caller = cap.one("caller")
    s = next(x for x in caller["spans"] if "outbound" in x)
    assert s["outbound"]["propagated"] is False and "childTraceId" in s["outbound"]  # callee still answers with its id


def test_propagate_false_and_capture_outbound_false(server):
    cap = configure(propagate=False)
    with stacklens.trace("caller"):
        assert requests.get(f"{server.url}/orders/1", timeout=5).json()["traceparent"] is None
    cap.flush()
    cap = configure(capture_outbound=False)
    with stacklens.trace("caller"):
        assert requests.get(f"{server.url}/orders/1", timeout=5).json()["traceparent"].startswith("00-")
    caller = next(t for t in cap.flush() if t["name"] == "caller")
    assert not [x for x in caller["spans"] if "outbound" in x]


def test_existing_traceparent_is_kept(captured, server):
    mine = "00-11111111111111111111111111111111-2222222222222222-01"
    with stacklens.trace("caller"):
        body = requests.get(f"{server.url}/orders/1", headers={"traceparent": mine}, timeout=5).json()
    assert body["traceparent"] == mine


def test_calls_outside_traces_and_to_the_collector_are_not_recorded(server):
    cap = configure(endpoint=f"{server.url}/api/ingest")
    requests.get(f"{server.url}/orders/1", timeout=5)
    with stacklens.trace("caller"):
        requests.post(f"{server.url}/api/ingest", json={"traces": []}, timeout=5)
    caller = next(t for t in cap.flush() if t["name"] == "caller")
    assert not [x for x in caller["spans"] if "outbound" in x]


def test_repeated_calls_collapse(captured, server):
    with stacklens.trace("caller"):
        for i in range(15):
            requests.get(f"{server.url}/orders/{i + 1}", timeout=5)
    caller = next(t for t in captured.flush() if t["name"] == "caller")
    out = spans_by_name(caller, next(s["name"] for s in caller["spans"] if "outbound" in s))
    assert len(out) == 11 and next(s for s in out if "collapsed" in s)["collapsed"]["count"] == 5
