"""WSGI entry point: one trace per request for any WSGI app (Flask uses it; works with Bottle, Pyramid, Falcon…).

.. code-block:: python

    from stacklens.integrations.wsgi import StackLensMiddleware
    app = StackLensMiddleware(app)

Frameworks can enrich the trace through the WSGI environ: ``stacklens.route`` (route template),
``stacklens.error`` (the exception behind a 500), ``stacklens.user_id``, ``stacklens.request_body``."""

from __future__ import annotations

from typing import Any, Callable, Dict, Iterable, List, Optional
from urllib.parse import parse_qsl

from .._context import TraceContext, current
from .._propagation import TRACE_ID_HEADER, parent_from_headers
from .._tracer import tracer
from ._server import BodyBuffer, filter_headers, finish_http, textual

ENV_TRACE = "stacklens.trace"


def environ_headers(environ: Dict[str, Any]) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for k, v in environ.items():
        if k.startswith("HTTP_"):
            out[k[5:].replace("_", "-").lower()] = v
    if environ.get("CONTENT_TYPE"):
        out["content-type"] = environ["CONTENT_TYPE"]
    if environ.get("CONTENT_LENGTH"):
        out["content-length"] = environ["CONTENT_LENGTH"]
    return out


class _HeaderView:
    """Minimal request-like object for ``get_user_id`` in plain WSGI apps."""

    def __init__(self, environ: Dict[str, Any], headers: Dict[str, str]):
        self.environ = environ
        self.headers = headers
        self.user = environ.get("stacklens.user")


class StackLensMiddleware:
    def __init__(self, app: Callable[..., Iterable[bytes]], *, capture_request: bool = True, capture_response: bool = True, headers: Optional[List[str]] = None):
        self.app = app
        self.capture_request = capture_request
        self.capture_response = capture_response
        self.keep_headers = headers

    def __call__(self, environ: Dict[str, Any], start_response: Callable[..., Any]) -> Iterable[bytes]:
        path = (environ.get("SCRIPT_NAME") or "") + (environ.get("PATH_INFO") or "/")
        if not tracer.should_sample() or tracer.is_ignored_path(path):
            return self.app(environ, start_response)
        method = environ.get("REQUEST_METHOD", "GET").upper()
        query = environ.get("QUERY_STRING") or ""
        headers = environ_headers(environ)
        trace, root = tracer.create_trace(f"{method} {path}", "http", "http")
        trace.record["http"] = {"method": method, "url": f"{path}?{query}" if query else path}
        ip = environ.get("REMOTE_ADDR")
        if ip:
            trace.record["http"]["ip"] = ip
        try:
            parent = parent_from_headers(headers)
            if parent:
                trace.record["parent"] = parent
        except Exception:
            pass
        environ[ENV_TRACE] = trace
        state: Dict[str, Any] = {"status": None, "headers": {}, "body": BodyBuffer(), "textual": False}

        def sr(status: str, response_headers: List[Any], exc_info: Any = None) -> Any:
            try:
                state["status"] = int(str(status).split(" ", 1)[0])
                hdrs = {str(k).lower(): v for k, v in response_headers}
                state["headers"] = hdrs
                state["textual"] = textual(hdrs.get("content-type"))
                if not any(str(k).lower() == TRACE_ID_HEADER for k, _ in response_headers):
                    response_headers = list(response_headers) + [(TRACE_ID_HEADER, trace.record["id"])]
            except Exception:
                pass
            write = start_response(status, response_headers, exc_info) if exc_info is not None else start_response(status, response_headers)
            return write

        finished = [False]

        def finish(error: Optional[BaseException] = None) -> None:
            if finished[0]:
                return
            finished[0] = True
            req = None
            if self.capture_request:
                body = environ.get("stacklens.request_body")
                req = {
                    "headers": filter_headers(headers, self.keep_headers),
                    "query": dict(parse_qsl(query, keep_blank_values=True)) if query else {},
                    "params": environ.get("stacklens.path_params") or {},
                    "body": body,
                }
            res = None
            if self.capture_response:
                body = environ.get("stacklens.response_body")
                if body is None and state["textual"]:
                    body = state["body"].value(state["headers"].get("content-type"))
                res = {"headers": state["headers"], "body": body}
            uid = environ.get("stacklens.user_id")
            if uid is None:
                try:
                    uid = tracer.opts.get_user_id(_HeaderView(environ, headers))
                except Exception:
                    uid = None
            err = error or environ.get("stacklens.error")
            status = state["status"] if state["status"] is not None else (500 if err is not None else None)
            finish_http(trace, root, method=method, status=status, route=environ.get("stacklens.route"), request=req, response=res, user_id=uid, error=err)

        token = current.set(TraceContext(trace, root["id"]))
        try:
            result = self.app(environ, sr)
        except BaseException as e:
            current.reset(token)
            finish(e)
            raise
        current.reset(token)
        return _ClosingIterable(result, trace, root, state, finish, self.capture_response)


class _ClosingIterable:
    """Passes the response through, keeps (a bounded copy of) the body, and closes the trace on ``close()``."""

    def __init__(self, inner: Iterable[bytes], trace: Any, root: Dict[str, Any], state: Dict[str, Any], finish: Callable[..., None], capture: bool):
        self.inner = inner
        self.trace = trace
        self.root = root
        self.state = state
        self.finish = finish
        self.capture = capture
        self.it: Any = None

    def __iter__(self) -> "_ClosingIterable":
        self.it = iter(self.inner)
        return self

    def __next__(self) -> bytes:
        token = current.set(TraceContext(self.trace, self.root["id"]))
        try:
            chunk = next(self.it)
        except StopIteration:
            current.reset(token)
            self.finish()  # body fully sent (servers also call close(), which is then a no-op)
            raise
        except BaseException as e:
            current.reset(token)
            self.finish(e)
            raise
        current.reset(token)
        if self.capture and self.state["textual"]:
            try:
                self.state["body"].add(chunk)
            except Exception:
                pass
        return chunk

    def close(self) -> None:
        try:
            close = getattr(self.inner, "close", None)
            if close is not None:
                close()
        finally:
            self.finish()
