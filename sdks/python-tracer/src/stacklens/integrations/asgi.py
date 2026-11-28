"""ASGI entry point: one trace per HTTP request (FastAPI, Starlette, Quart, Litestar, Django ASGI…).

.. code-block:: python

    from stacklens.integrations.asgi import StackLensASGIMiddleware
    app.add_middleware(StackLensASGIMiddleware)        # Starlette / FastAPI
    app = StackLensASGIMiddleware(app)                 # any ASGI app

A pure ASGI middleware (not ``BaseHTTPMiddleware``): streaming responses, background tasks and
contextvars all keep working. Request and response bodies of textual content types are copied (bounded)
as they pass through; nothing is read on the app's behalf."""

from __future__ import annotations

from typing import Any, Awaitable, Callable, Dict, List, Optional
from urllib.parse import parse_qsl

from .._context import TraceContext, current
from .._propagation import TRACE_ID_HEADER, parent_from_headers
from .._tracer import tracer
from ._server import BodyBuffer, filter_headers, finish_http, resolve_user, textual

Scope = Dict[str, Any]
Receive = Callable[[], Awaitable[Dict[str, Any]]]
Send = Callable[[Dict[str, Any]], Awaitable[None]]


def _decode_headers(raw: Any) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for k, v in raw or []:
        key = k.decode("latin-1").lower() if isinstance(k, bytes) else str(k).lower()
        val = v.decode("latin-1") if isinstance(v, bytes) else str(v)
        out[key] = f"{out[key]}, {val}" if key in out else val
    return out


def route_template(scope: Scope) -> Optional[str]:
    """``/orders/{order_id}`` for the matched route: FastAPI sets ``scope["route"]``; for Starlette we look up
    the matched endpoint in the app's routes. Mount prefixes are included."""
    route = scope.get("route")
    path = getattr(route, "path_format", None) or getattr(route, "path", None)
    if isinstance(path, str):
        return (scope.get("stacklens.mount_prefix") or "") + path
    endpoint = scope.get("endpoint")
    app = scope.get("app")
    if endpoint is None or app is None:
        return None
    try:
        for r in getattr(app, "routes", []) or []:
            if getattr(r, "endpoint", None) is endpoint:
                p = getattr(r, "path_format", None) or getattr(r, "path", None)
                if isinstance(p, str):
                    return p
    except Exception:
        return None
    return None


class _RequestView:
    """What ``get_user_id`` receives: ``.scope``, ``.state.user`` (Starlette request.state) and ``.headers``."""

    def __init__(self, scope: Scope, headers: Dict[str, str]):
        self.scope = scope
        self.headers = headers
        state = scope.get("state")
        self.state = _State(state if isinstance(state, dict) else {})
        self.user = scope.get("user")


class _State:
    def __init__(self, d: Dict[str, Any]):
        self.__dict__.update(d)

    def __getattr__(self, name: str) -> Any:
        return None


class StackLensASGIMiddleware:
    def __init__(self, app: Any, *, capture_request: bool = True, capture_response: bool = True, headers: Optional[List[str]] = None, on_request: Optional[Callable[[Scope], None]] = None):
        self.app = app
        self.capture_request = capture_request
        self.capture_response = capture_response
        self.keep_headers = headers
        self.on_request = on_request

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        path = scope.get("path") or "/"
        if not tracer.should_sample() or tracer.is_ignored_path(path) or current.get() is not None:
            await self.app(scope, receive, send)
            return
        if self.on_request is not None:
            try:
                self.on_request(scope)
            except Exception:
                pass
        method = (scope.get("method") or "GET").upper()
        query = scope.get("query_string") or b""
        query_s = query.decode("latin-1") if isinstance(query, bytes) else str(query)
        headers = _decode_headers(scope.get("headers"))
        trace, root = tracer.create_trace(f"{method} {path}", "http", "http")
        trace.record["http"] = {"method": method, "url": f"{path}?{query_s}" if query_s else path}
        client = scope.get("client")
        if client:
            trace.record["http"]["ip"] = str(client[0])
        try:
            parent = parent_from_headers(headers)
            if parent:
                trace.record["parent"] = parent
        except Exception:
            pass
        scope["stacklens.trace_id"] = trace.record["id"]

        req_body = BodyBuffer()
        capture_req_body = self.capture_request and textual(headers.get("content-type"))
        res: Dict[str, Any] = {"status": None, "headers": {}, "body": BodyBuffer(), "textual": False}

        async def wrapped_receive() -> Dict[str, Any]:
            message = await receive()
            if capture_req_body and message.get("type") == "http.request":
                try:
                    req_body.add(message.get("body"))
                except Exception:
                    pass
            return message

        async def wrapped_send(message: Dict[str, Any]) -> None:
            try:
                t = message.get("type")
                if t == "http.response.start":
                    res["status"] = int(message.get("status", 200))
                    hdrs = _decode_headers(message.get("headers"))
                    res["headers"] = hdrs
                    res["textual"] = self.capture_response and textual(hdrs.get("content-type"))
                    if TRACE_ID_HEADER not in hdrs:
                        message = dict(message)
                        message["headers"] = list(message.get("headers") or []) + [(TRACE_ID_HEADER.encode(), trace.record["id"].encode())]
                        hdrs[TRACE_ID_HEADER] = trace.record["id"]
                elif t == "http.response.body" and res["textual"]:
                    res["body"].add(message.get("body"))
            except Exception:
                pass
            await send(message)

        error: Optional[BaseException] = None
        token = current.set(TraceContext(trace, root["id"]))
        try:
            await self.app(scope, wrapped_receive, wrapped_send)
        except BaseException as e:
            error = e
            raise
        finally:
            try:
                current.reset(token)
            except ValueError:
                pass
            self._finish(trace, root, scope, method, headers, query_s, req_body, res, error)

    def _finish(self, trace: Any, root: Dict[str, Any], scope: Scope, method: str, headers: Dict[str, str], query: str, req_body: BodyBuffer, res: Dict[str, Any], error: Optional[BaseException]) -> None:
        try:
            req = None
            if self.capture_request:
                req = {
                    "headers": filter_headers(headers, self.keep_headers),
                    "query": dict(parse_qsl(query, keep_blank_values=True)) if query else {},
                    "params": dict(scope.get("path_params") or {}),
                    "body": req_body.value(headers.get("content-type")),
                }
            response = None
            if self.capture_response:
                response = {"headers": res["headers"], "body": res["body"].value(res["headers"].get("content-type")) if res["textual"] else None}
            status = res["status"]
            if status is None and error is not None:
                status = 500
            uid = resolve_user(tracer.opts.get_user_id, _RequestView(scope, headers))
            finish_http(trace, root, method=method, status=status, route=route_template(scope), request=req, response=response, user_id=uid, error=error if not _is_cancel(error) else None)
        except Exception:
            tracer.finish_trace(trace, root, error)


def _is_cancel(e: Optional[BaseException]) -> bool:
    return e is not None and type(e).__name__ in ("CancelledError", "ClientDisconnect")
