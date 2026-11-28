"""Outgoing HTTP calls: one span per request (kind ``http``) with method, URL, headers, bodies and status, plus
W3C ``traceparent`` propagation so an instrumented callee links its trace to that span.

Covers ``requests`` (``Session.send``), ``httpx`` (``Client.send`` / ``AsyncClient.send``) and ``urllib3``
(``HTTPConnectionPool.urlopen``). A call made inside another outgoing call (``requests`` → ``urllib3``) is
recorded once. Patching happens in :func:`instrument_http_clients`, called by ``stacklens.init()``; libraries
that aren't installed are skipped. Nothing here may break the request: every step is guarded."""

from __future__ import annotations

import json
import re
from typing import Any, Dict, Mapping, Optional, Tuple
from urllib.parse import parse_qsl, quote, urlsplit, urlunsplit

from .._context import TraceContext, current
from .._propagation import TRACE_ID_HEADER, format_traceparent, format_tracestate
from .._tracer import CallHandle, SpanInit, tracer

#: Bodies beyond this many bytes are not kept (the serializer trims further to ``max_string_length``).
MAX_BODY_BYTES = 64 * 1024
_TEXTUAL = re.compile(r"json|text|xml|x-www-form-urlencoded|graphql|javascript", re.I)
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
_HEXID = re.compile(r"^[0-9a-f]{8,}$", re.I)
_LONGID = re.compile(r"^[\w-]+$")

_patched: Dict[str, bool] = {}


# ---------------------------------------------------------------------------- shared


def _active() -> bool:
    o = tracer.opts
    return o.enabled and (o.capture_outbound or o.propagate)


def current_context() -> Optional[TraceContext]:
    """Current trace, unless there is none, it was exported, or we're already inside an outgoing span."""
    ctx = current.get()
    if ctx is None or ctx.trace.finished or not _active():
        return None
    span = ctx.trace.by_id.get(ctx.span_id)
    if span is not None and "outbound" in span:
        return None
    return ctx


def _is_collector(parts: Any) -> bool:
    try:
        c = urlsplit(tracer.opts.endpoint)
        return c.netloc == parts.netloc and parts.path.startswith(c.path)
    except Exception:
        return False


def route_of(path: str) -> str:
    """``/orders/42/items/9f86d081884c7d65`` → ``/orders/:id/items/:id`` so loops over ids group together."""

    def seg(s: str) -> str:
        if s.isdigit() or _UUID.match(s) or (_HEXID.match(s) and any(c.isdigit() for c in s)) or (len(s) >= 16 and any(c.isdigit() for c in s) and _LONGID.match(s)):
            return ":id"
        return s

    return "/".join(seg(s) for s in path.split("/"))


def redact_url(url: str) -> str:
    """Absolute URL without credentials or fragment; values of secret-looking query keys are replaced."""
    try:
        p = urlsplit(url)
        netloc = p.hostname or ""
        if p.port:
            netloc = f"{netloc}:{p.port}"
        query = p.query
        if query:
            pairs = parse_qsl(query, keep_blank_values=True)
            query = "&".join(f"{quote(k, safe='')}={'[REDACTED]' if tracer.limits.redact(k) else quote(v, safe='')}" for k, v in pairs)
        return urlunsplit((p.scheme, netloc, p.path or "/", query, ""))
    except Exception:
        return url


def _header_dict(headers: Any) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    if headers is None:
        return out
    try:
        items = headers.items() if hasattr(headers, "items") else headers
        for k, v in items:
            if isinstance(k, bytes):
                k = k.decode("latin-1")
            if isinstance(v, bytes):
                v = v.decode("latin-1")
            key = str(k).lower()
            out[key] = f"{out[key]}, {v}" if key in out else v
    except Exception:
        pass
    return out


def body_value(body: Any, content_type: Optional[str]) -> Any:
    """A request/response body as something readable: parsed JSON, text, or a ``[type body, N bytes]`` note."""
    if body is None:
        return None
    if isinstance(body, (dict, list)):
        return body
    if isinstance(body, str):
        raw: Optional[bytes] = None
        text = body
        size = len(body.encode("utf-8", "replace"))
    elif isinstance(body, (bytes, bytearray, memoryview)):
        raw = bytes(body)
        size = len(raw)
        text = None
    else:
        return f"[{type(body).__name__} body]"  # file / generator: not read by us
    if size == 0:
        return None
    ctype = (content_type or "").split(";")[0].strip()
    if ctype and not _TEXTUAL.search(ctype):
        return f"[{ctype} body, {size} bytes]"
    if text is None:
        assert raw is not None
        text = raw[:MAX_BODY_BYTES].decode("utf-8", "replace")
    elif size > MAX_BODY_BYTES:
        text = text[:MAX_BODY_BYTES]
    if size > MAX_BODY_BYTES:
        return text + f"… [{size} bytes, cut at {MAX_BODY_BYTES}]"
    if "json" in ctype or (not ctype and text[:1] in "{["):
        try:
            return json.loads(text)
        except ValueError:
            return text
    return text


class Outgoing:
    __slots__ = ("ctx", "handle", "method", "url", "inject", "done", "token")

    def __init__(self, ctx: TraceContext, handle: Optional[CallHandle], method: str, url: str, inject: Optional[Dict[str, str]]):
        self.ctx = ctx
        self.handle = handle
        self.method = method
        self.url = url
        self.inject = inject
        self.done = False
        self.token: Any = None

    @property
    def span(self) -> Optional[Dict[str, Any]]:
        h = self.handle
        return h.span if h is not None and h.mode in ("span", "collapsed") else None

    def enter(self) -> None:
        """Run the library call with the outgoing span as the current span (so nested clients skip it)."""
        span = self.span
        if span is not None:
            self.token = current.set(TraceContext(self.ctx.trace, span["id"]))

    def exit(self) -> None:
        if self.token is not None:
            try:
                current.reset(self.token)
            except ValueError:
                pass
            self.token = None


def begin(method: str, url: str, existing_headers: Any = None) -> Optional[Outgoing]:
    """Start recording an outgoing call; ``None`` when not in a trace (or nothing to do)."""
    ctx = current_context()
    if ctx is None:
        return None
    try:
        parts = urlsplit(url)
        if _is_collector(parts):
            return None
        o = tracer.opts
        method = (method or "GET").upper()
        hostname = parts.hostname or ""
        host = parts.netloc.rsplit("@", 1)[-1]
        name = f"{method} {host}{route_of(parts.path or '/')}"
        handle = tracer.begin_call(ctx.trace, ctx.span_id, SpanInit(name, name, "http", ["request"])) if o.capture_outbound else None
        span = handle.span if handle is not None and handle.mode != "dropped" else None
        has_tp = False
        try:
            has_tp = existing_headers is not None and any(str(k).lower() == "traceparent" for k in existing_headers.keys())
        except Exception:
            pass
        inject: Optional[Dict[str, str]] = None
        if o.propagate and not has_tp and tracer.propagates_to(hostname, host):
            inject = {"traceparent": format_traceparent(ctx.trace.record["id"], span["id"] if span else ctx.span_id)}
            state = format_tracestate(o.application)
            if state:
                inject["tracestate"] = state
        clean = redact_url(url)
        if span is not None:
            span["async"] = True
            span.setdefault("outbound", {"method": method, "url": clean, "host": host, "propagated": inject is not None})
        return Outgoing(ctx, handle, method, clean, inject)
    except Exception:
        return None


def finish(call: Optional[Outgoing], request: Dict[str, Any], status: Optional[int] = None, headers: Optional[Dict[str, Any]] = None, body: Any = None, error: Optional[BaseException] = None) -> None:
    if call is None or call.done:
        return
    call.done = True
    try:
        handle, trace = call.handle, call.ctx.trace
        if handle is None or handle.mode == "dropped" or trace.finished:
            return
        if handle.mode == "collapsed":
            failed = error
            if failed is None and status is not None and status >= 500:
                failed = _http_error(call, status)
            tracer.end_collapsed(trace, handle, [request], True, failed)
            return
        span = handle.span
        assert span is not None
        ob = span["outbound"]
        if status is not None:
            ob["statusCode"] = status
        child = (headers or {}).get(TRACE_ID_HEADER)
        if isinstance(child, str) and child:
            ob["childTraceId"] = child.split(",")[0].strip()
        tracer.capture_args(trace, span, [request])
        if error is not None:
            tracer.end_span(trace, span, error=error)
            return
        result: Dict[str, Any] = {"statusCode": status, "headers": headers or {}}
        if body is not None:
            result["body"] = body
        tracer.end_span(trace, span, result)
        if status is not None and status >= 500:
            span["status"] = "error"
            span["error"] = {"name": "HttpError", "message": f"{call.method} {call.url} responded {status}", "status": status}
    except Exception:
        pass


class HttpError(Exception):
    """A 5xx answer to an outgoing call (nothing was raised, but the call failed)."""

    def __init__(self, message: str, status: int):
        super().__init__(message)
        self.status = status


def _http_error(call: Outgoing, status: int) -> Exception:
    return HttpError(f"{call.method} {call.url} responded {status}", status)


def _request_record(method: str, url: str, headers: Dict[str, Any], body: Any) -> Dict[str, Any]:
    rec: Dict[str, Any] = {"method": method, "url": url, "headers": headers}
    b = body_value(body, headers.get("content-type"))
    if b is not None:
        rec["body"] = b
    return rec


# ---------------------------------------------------------------------------- requests


def _patch_requests() -> bool:
    try:
        import requests  # noqa: F401
        from requests.sessions import Session
    except ImportError:
        return False
    original = Session.send
    if getattr(original, "__stacklens__", False):
        return True

    def send(self: Any, request: Any, **kwargs: Any) -> Any:
        call = begin(getattr(request, "method", "GET"), str(getattr(request, "url", "")), getattr(request, "headers", None))
        if call is None:
            return original(self, request, **kwargs)
        try:
            if call.inject:
                for k, v in call.inject.items():
                    request.headers[k] = v
        except Exception:
            pass
        req_rec = _request_record(call.method, call.url, _header_dict(getattr(request, "headers", None)), getattr(request, "body", None))
        call.enter()
        try:
            resp = original(self, request, **kwargs)
        except BaseException as e:
            call.exit()
            finish(call, req_rec, error=e)
            raise
        call.exit()
        try:
            rh = _header_dict(resp.headers)
            body = None
            if not kwargs.get("stream"):
                body = body_value(resp.content, rh.get("content-type"))
            finish(call, req_rec, resp.status_code, rh, body)
        except Exception:
            finish(call, req_rec)
        return resp

    send.__stacklens__ = True  # type: ignore[attr-defined]
    send.__wrapped__ = original  # type: ignore[attr-defined]
    Session.send = send  # type: ignore[method-assign]
    return True


# ---------------------------------------------------------------------------- httpx


def _httpx_request_body(request: Any) -> Any:
    try:
        return request.content  # raises httpx.RequestNotRead for streaming bodies
    except Exception:
        return None


def _patch_httpx() -> bool:
    try:
        import httpx
    except ImportError:
        return False
    sync_original = httpx.Client.send
    async_original = httpx.AsyncClient.send
    if getattr(sync_original, "__stacklens__", False):
        return True

    def prepare(request: Any) -> Tuple[Optional[Outgoing], Dict[str, Any]]:
        call = begin(request.method, str(request.url), request.headers)
        if call is None:
            return None, {}
        try:
            if call.inject:
                for k, v in call.inject.items():
                    request.headers[k] = v
        except Exception:
            pass
        return call, _request_record(call.method, call.url, _header_dict(request.headers), _httpx_request_body(request))

    def done(call: Outgoing, req_rec: Dict[str, Any], resp: Any, stream: bool) -> None:
        try:
            rh = _header_dict(resp.headers)
            body = None
            if not stream:
                body = body_value(resp.content, rh.get("content-type"))
            finish(call, req_rec, resp.status_code, rh, body)
        except Exception:
            finish(call, req_rec)

    def send(self: Any, request: Any, *args: Any, **kwargs: Any) -> Any:
        call, req_rec = prepare(request)
        if call is None:
            return sync_original(self, request, *args, **kwargs)
        call.enter()
        try:
            resp = sync_original(self, request, *args, **kwargs)
        except BaseException as e:
            call.exit()
            finish(call, req_rec, error=e)
            raise
        call.exit()
        done(call, req_rec, resp, bool(kwargs.get("stream")))
        return resp

    async def asend(self: Any, request: Any, *args: Any, **kwargs: Any) -> Any:
        call, req_rec = prepare(request)
        if call is None:
            return await async_original(self, request, *args, **kwargs)
        call.enter()
        try:
            resp = await async_original(self, request, *args, **kwargs)
        except BaseException as e:
            call.exit()
            finish(call, req_rec, error=e)
            raise
        call.exit()
        done(call, req_rec, resp, bool(kwargs.get("stream")))
        return resp

    for fn, orig in ((send, sync_original), (asend, async_original)):
        fn.__stacklens__ = True  # type: ignore[attr-defined]
        fn.__wrapped__ = orig  # type: ignore[attr-defined]
    httpx.Client.send = send  # type: ignore[method-assign]
    httpx.AsyncClient.send = asend  # type: ignore[method-assign]
    return True


# ---------------------------------------------------------------------------- urllib3

_URLOPEN_POSITIONAL = ("body", "headers", "retries", "redirect", "assert_same_host", "timeout", "pool_timeout", "release_conn", "chunked", "body_pos")


def _patch_urllib3() -> bool:
    try:
        from urllib3.connectionpool import HTTPConnectionPool
    except ImportError:
        return False
    original = HTTPConnectionPool.urlopen
    if getattr(original, "__stacklens__", False):
        return True

    def urlopen(self: Any, method: str, url: str, *args: Any, **kwargs: Any) -> Any:
        if current_context() is None:
            return original(self, method, url, *args, **kwargs)
        try:
            for name, value in zip(_URLOPEN_POSITIONAL, args):
                kwargs.setdefault(name, value)
            args = ()
            if url.startswith(("http://", "https://")):
                full = url
            else:
                default_port = 443 if self.scheme == "https" else 80
                port = f":{self.port}" if self.port and self.port != default_port else ""
                full = f"{self.scheme}://{self.host}{port}{url}"
            headers = kwargs.get("headers")
            call = begin(method, full, headers if headers is not None else self.headers)
        except Exception:
            return original(self, method, url, *args, **kwargs)
        if call is None:
            return original(self, method, url, **kwargs)
        try:
            if call.inject:
                merged = dict(headers if headers is not None else self.headers or {})
                merged.update(call.inject)
                kwargs["headers"] = merged
        except Exception:
            pass
        req_rec = _request_record(call.method, call.url, _header_dict(kwargs.get("headers") or self.headers), kwargs.get("body"))
        call.enter()
        try:
            resp = original(self, method, url, **kwargs)
        except BaseException as e:
            call.exit()
            finish(call, req_rec, error=e)
            raise
        call.exit()
        try:
            rh = _header_dict(resp.headers)
            body = None
            if kwargs.get("preload_content", True):
                body = body_value(resp.data, rh.get("content-type"))
            finish(call, req_rec, resp.status, rh, body)
        except Exception:
            finish(call, req_rec)
        return resp

    urlopen.__stacklens__ = True  # type: ignore[attr-defined]
    urlopen.__wrapped__ = original  # type: ignore[attr-defined]
    HTTPConnectionPool.urlopen = urlopen  # type: ignore[method-assign]
    return True


# ---------------------------------------------------------------------------- urllib.request (stdlib)


def _patch_urllib_request() -> bool:
    """``urllib.request.urlopen``: method, URL, headers, request body and response status/headers. The response
    body is not recorded (it is read by the caller after the call returns)."""
    import urllib.request

    original = urllib.request.AbstractHTTPHandler.do_open
    if getattr(original, "__stacklens__", False):
        return True

    def do_open(self: Any, http_class: Any, req: Any, **kwargs: Any) -> Any:
        try:
            all_headers = {**dict(req.header_items())}
            call = begin(req.get_method(), req.full_url, all_headers)
        except Exception:
            call = None
        if call is None:
            return original(self, http_class, req, **kwargs)
        try:
            if call.inject:
                for k, v in call.inject.items():
                    req.add_unredirected_header(k.capitalize(), v)
        except Exception:
            pass
        req_rec = _request_record(call.method, call.url, _header_dict(dict(req.header_items())), req.data if isinstance(req.data, (bytes, str)) else None)
        call.enter()
        try:
            resp = original(self, http_class, req, **kwargs)
        except BaseException as e:
            call.exit()
            finish(call, req_rec, error=e)
            raise
        call.exit()
        try:
            finish(call, req_rec, resp.status, _header_dict(resp.headers.items()))
        except Exception:
            finish(call, req_rec)
        return resp

    do_open.__stacklens__ = True  # type: ignore[attr-defined]
    do_open.__wrapped__ = original  # type: ignore[attr-defined]
    urllib.request.AbstractHTTPHandler.do_open = do_open  # type: ignore[method-assign]
    return True


def instrument_http_clients() -> Dict[str, bool]:
    """Patch every supported HTTP client that is installed. Idempotent."""
    for name, patch in (("requests", _patch_requests), ("httpx", _patch_httpx), ("urllib3", _patch_urllib3), ("urllib", _patch_urllib_request)):
        if not _patched.get(name):
            try:
                _patched[name] = patch()
            except Exception:
                _patched[name] = False
    return dict(_patched)


def headers_for_request(headers: Optional[Mapping[str, Any]] = None) -> Dict[str, str]:
    """``propagation_headers()`` merged over ``headers`` (for clients StackLens doesn't patch)."""
    import stacklens

    out = dict(headers or {})
    out.update(stacklens.propagation_headers())
    return out
