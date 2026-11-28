"""Django: middleware (sync and async), view spans, and ORM SQL spans.

.. code-block:: python

    # settings.py
    MIDDLEWARE = ["stacklens.integrations.django.StackLensMiddleware", *MIDDLEWARE]

    # wsgi.py / asgi.py / apps.py (before the first request)
    import stacklens
    stacklens.init(application="accounts-api")

Each request becomes a trace named after its URL pattern (``GET /accounts/<int:pk>/``). Function views and
class-based view methods become ``controller`` spans; every SQL statement the ORM runs becomes a ``db`` span
``SQL.query`` (via ``connection.execute_wrapper``). Put the middleware first so it sees the whole request."""

from __future__ import annotations

import inspect
from typing import Any, Callable, Dict, Optional
from urllib.parse import parse_qsl

from .._context import TraceContext, current
from .._instrument import instrument_class, is_wrapped, wrap_function
from .._propagation import TRACE_ID_HEADER, parent_from_headers
from .._tracer import tracer
from ._server import filter_headers, finish_http, textual
from .http import MAX_BODY_BYTES, body_value
from .sql import sql_span

try:  # Django ≥ 4.1
    from asgiref.sync import iscoroutinefunction, markcoroutinefunction
except Exception:  # pragma: no cover
    iscoroutinefunction = inspect.iscoroutinefunction  # type: ignore

    def markcoroutinefunction(fn: Any) -> Any:  # type: ignore
        return fn


_views_wrapped = {"done": False}


def _sql_wrapper(execute: Callable[..., Any], sql: str, params: Any, many: bool, context: Dict[str, Any]) -> Any:
    if current.get() is None:
        return execute(sql, params, many, context)
    vendor = getattr(context.get("connection"), "vendor", None)
    with sql_span(sql, params, many=many, dialect=vendor) as rec:
        result = execute(sql, params, many, context)
        try:
            cursor = context.get("cursor")
            rc = getattr(cursor, "rowcount", -1)
            if isinstance(rc, int) and rc >= 0:
                rec.result = {"rowCount": rc}
        except Exception:
            pass
        return result


def install_sql() -> None:
    """Add the SQL wrapper to every current and future database connection."""
    from django.db import connections
    from django.db.backends.signals import connection_created

    def add(connection: Any) -> None:
        if _sql_wrapper not in connection.execute_wrappers:
            connection.execute_wrappers.append(_sql_wrapper)

    def on_created(sender: Any, connection: Any, **kwargs: Any) -> None:
        add(connection)

    connection_created.connect(on_created, weak=False, dispatch_uid="stacklens_sql")
    try:
        for conn in connections.all(initialized_only=True):  # type: ignore[call-arg]
            add(conn)
    except TypeError:  # Django < 4.1
        for conn in connections.all():
            add(conn)


def wrap_views() -> None:
    """Wrap URL pattern callbacks: function views as spans, class-based views by their HTTP-method handlers."""
    if _views_wrapped["done"]:
        return
    _views_wrapped["done"] = True
    try:
        from django.urls import get_resolver
    except Exception:
        return

    def walk(patterns: Any) -> None:
        for p in patterns:
            sub = getattr(p, "url_patterns", None)
            if sub is not None and p.__class__.__name__ == "URLResolver":
                walk(sub)
                continue
            cb = getattr(p, "callback", None)
            if cb is None or is_wrapped(cb):
                continue
            view_class = getattr(cb, "view_class", None) or getattr(getattr(cb, "cls", None), "__mro__", None) and getattr(cb, "cls", None)
            if isinstance(view_class, type):
                instrument_class(view_class, kind="controller", include=["get", "post", "put", "patch", "delete", "head", "options", "list", "create", "retrieve", "update", "partial_update", "destroy"])
                continue
            mod = getattr(cb, "__module__", "") or ""
            label = mod.rsplit(".", 1)[-1] if mod else "views"
            try:
                p.callback = wrap_function(cb, getattr(cb, "__name__", "view"), label, "controller")
            except Exception:
                continue

    try:
        walk(get_resolver().url_patterns)
    except Exception:
        pass


def _route(request: Any) -> Optional[str]:
    match = getattr(request, "resolver_match", None)
    if match is None:
        return None
    route = getattr(match, "route", None)
    if not route:
        return None
    route = str(route).lstrip("^").rstrip("$")
    return route if route.startswith("/") else "/" + route


class _Exchange:
    __slots__ = ("trace", "root", "token", "error", "method")

    def __init__(self, trace: Any, root: Dict[str, Any], token: Any, method: str):
        self.trace = trace
        self.root = root
        self.token = token
        self.error: Optional[BaseException] = None
        self.method = method


class StackLensMiddleware:
    sync_capable = True
    async_capable = True

    def __init__(self, get_response: Callable[..., Any]):
        self.get_response = get_response
        self.async_mode = iscoroutinefunction(get_response)
        if self.async_mode:
            markcoroutinefunction(self)
        try:
            install_sql()
        except Exception:
            pass

    # -- request lifecycle

    def _start(self, request: Any) -> Optional[_Exchange]:
        path = request.path
        if not tracer.should_sample() or tracer.is_ignored_path(path) or current.get() is not None:
            return None
        wrap_views()
        method = request.method.upper()
        trace, root = tracer.create_trace(f"{method} {path}", "http", "http")
        qs = request.META.get("QUERY_STRING") or ""
        trace.record["http"] = {"method": method, "url": f"{path}?{qs}" if qs else path}
        ip = request.META.get("REMOTE_ADDR")
        if ip:
            trace.record["http"]["ip"] = ip
        try:
            parent = parent_from_headers({k.lower(): v for k, v in request.headers.items()})
            if parent:
                trace.record["parent"] = parent
        except Exception:
            pass
        request.stacklens_trace_id = trace.record["id"]
        request._stacklens_body = None
        try:
            ctype = request.META.get("CONTENT_TYPE")
            if textual(ctype) and int(request.META.get("CONTENT_LENGTH") or 0) <= MAX_BODY_BYTES and method not in ("GET", "HEAD"):
                request._stacklens_body = body_value(request.body, ctype)  # request.body is cached by Django
        except Exception:
            pass
        token = current.set(TraceContext(trace, root["id"]))
        ex = _Exchange(trace, root, token, method)
        request._stacklens_exchange = ex
        return ex

    def _finish(self, request: Any, response: Any, error: Optional[BaseException]) -> None:
        ex: Optional[_Exchange] = getattr(request, "_stacklens_exchange", None)
        if ex is None:
            return
        request._stacklens_exchange = None
        try:
            current.reset(ex.token)
        except ValueError:
            pass
        try:
            status = getattr(response, "status_code", None) if response is not None else 500
            headers = {k.lower(): v for k, v in request.headers.items()}
            qs = request.META.get("QUERY_STRING") or ""
            match = getattr(request, "resolver_match", None)
            req = {
                "headers": filter_headers(headers, None),
                "query": dict(parse_qsl(qs, keep_blank_values=True)) if qs else {},
                "params": dict(getattr(match, "kwargs", {}) or {}),
                "body": getattr(request, "_stacklens_body", None),
            }
            res = None
            if response is not None:
                rh = {k.lower(): v for k, v in response.items()} if hasattr(response, "items") else {}
                body = None
                if not getattr(response, "streaming", False) and textual(rh.get("content-type")) and len(getattr(response, "content", b"") or b"") <= MAX_BODY_BYTES:
                    body = body_value(response.content, rh.get("content-type"))
                res = {"headers": rh, "body": body}
                try:
                    response[TRACE_ID_HEADER] = ex.trace.record["id"]
                except Exception:
                    pass
            uid = None
            try:
                uid = tracer.opts.get_user_id(request)
            except Exception:
                uid = None
            err = error or (ex.error if (status or 500) >= 500 else None)
            finish_http(ex.trace, ex.root, method=ex.method, status=status, route=_route(request), request=req, response=res, user_id=uid, error=err)
        except Exception:
            tracer.finish_trace(ex.trace, ex.root, error)

    def __call__(self, request: Any) -> Any:
        if self.async_mode:
            return self.__acall__(request)
        if self._start(request) is None:
            return self.get_response(request)
        try:
            response = self.get_response(request)
        except BaseException as e:
            self._finish(request, None, e)
            raise
        self._finish(request, response, None)
        return response

    async def __acall__(self, request: Any) -> Any:
        if self._start(request) is None:
            return await self.get_response(request)
        try:
            response = await self.get_response(request)
        except BaseException as e:
            self._finish(request, None, e)
            raise
        self._finish(request, response, None)
        return response

    def process_exception(self, request: Any, exception: BaseException) -> None:
        """The exception behind a 500 that Django turns into a response."""
        ex = getattr(request, "_stacklens_exchange", None)
        if ex is not None:
            ex.error = exception
        return None
