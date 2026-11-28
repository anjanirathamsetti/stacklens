"""StackLens for Python: function-level call-tree tracing.

.. code-block:: python

    import stacklens
    stacklens.init(application="orders-api", project="storefront")

    from stacklens.integrations.fastapi import instrument_fastapi
    instrument_fastapi(app)

Every instrumented call inside a request or job becomes a span with its arguments, return value,
exception, log lines and SQL, sent in the background to the StackLens server.
"""

from __future__ import annotations

import functools
import inspect
from typing import Any, Callable, Dict, Mapping, Optional, TypeVar, Union

from ._context import TraceContext, current
from ._instrument import instrument, instrument_class, instrument_module, kind_from_name, traced, unwrap, wrap, wrap_function
from ._options import Options
from ._propagation import TRACE_ID_HEADER, format_traceparent, format_tracestate, parent_from_headers, parse_traceparent
from ._tracer import SpanInit, tracer
from ._version import __version__

__all__ = [
    "__version__",
    "init",
    "traced",
    "instrument",
    "instrument_class",
    "instrument_module",
    "wrap",
    "trace",
    "log",
    "set_user",
    "set_attributes",
    "current_trace_id",
    "propagation_headers",
    "flush",
    "options",
    "kind_from_name",
    "unwrap",
    "wrap_function",
    "parse_traceparent",
    "format_traceparent",
]

T = TypeVar("T")


def init(**options: Any) -> Options:
    """Configure the tracer. Safe to call more than once; later calls override earlier ones.

    Options use the Node SDK's names in snake_case (``application``, ``project``, ``environment``,
    ``endpoint``, ``api_key``, ``sample_rate``, ``capture_args``, ``max_repeated_calls``, …) and fall back
    to ``STACKLENS_*`` environment variables. Outgoing HTTP calls made with ``requests``, ``httpx`` and
    ``urllib3`` are traced automatically when those libraries are installed."""
    tracer.configure(options)
    o = tracer.opts
    from . import _logging

    _logging.install(o.capture_logging)
    if o.enabled and (o.capture_outbound or o.propagate):
        try:
            from .integrations import http as _http

            _http.instrument_http_clients()
        except Exception:
            pass
    return o


def options() -> Options:
    """The current (resolved) options."""
    return tracer.opts


class _TraceScope:
    """``with stacklens.trace("job"):`` / ``async with`` / ``@stacklens.trace("job")``."""

    def __init__(self, name: str, kind: str = "job", headers: Optional[Mapping[str, Any]] = None, attributes: Optional[Dict[str, Any]] = None):
        self.name = name
        self.kind = kind
        self.headers = headers
        self.attributes = attributes
        self._stack: list = []

    # -- context manager
    def __enter__(self) -> "_TraceScope":
        self._stack.append(self._start())
        return self

    def __exit__(self, exc_type: Any, exc: Optional[BaseException], tb: Any) -> None:
        self._end(self._stack.pop(), exc)

    async def __aenter__(self) -> "_TraceScope":
        return self.__enter__()

    async def __aexit__(self, exc_type: Any, exc: Optional[BaseException], tb: Any) -> None:
        self.__exit__(exc_type, exc, tb)

    @property
    def trace_id(self) -> Optional[str]:
        ctx = current.get()
        return ctx.trace.record["id"] if ctx else None

    def _start(self) -> Any:
        ctx = current.get()
        if ctx is not None and not ctx.trace.finished:
            # inside a trace: a child span instead of a new trace
            call = tracer.begin_call(ctx.trace, ctx.span_id, SpanInit(self.name, self.name, self.kind, []))
            if call.mode != "span":
                return ("none", None, None, None)
            token = current.set(TraceContext(ctx.trace, call.span["id"]))
            return ("span", ctx.trace, call.span, token)
        if not tracer.should_sample():
            return ("none", None, None, None)
        trace, root = tracer.create_trace(self.name, "job", "job")
        if self.headers:
            try:
                parent = parent_from_headers({str(k).lower(): v for k, v in self.headers.items()})
                if parent:
                    trace.record["parent"] = parent
            except Exception:
                pass
        if self.attributes:
            root["attributes"] = tracer.serialize(self.attributes)
        token = current.set(TraceContext(trace, root["id"]))
        return ("trace", trace, root, token)

    def _end(self, state: Any, exc: Optional[BaseException]) -> None:
        mode, trace, span, token = state
        if mode == "none":
            return
        try:
            current.reset(token)
        except ValueError:  # exited in another context (e.g. a different task)
            current.set(None)
        try:
            if mode == "span":
                tracer.end_span(trace, span, error=exc, has_result=False)
            else:
                tracer.finish_trace(trace, span, exc)
        except Exception:
            pass

    # -- decorator
    def __call__(self, fn: Callable[..., T]) -> Callable[..., T]:
        name, kind, headers = self.name, self.kind, self.headers
        if inspect.iscoroutinefunction(fn):

            @functools.wraps(fn)
            async def run_async(*args: Any, **kwargs: Any) -> Any:
                async with _TraceScope(name, kind, headers):
                    return await fn(*args, **kwargs)

            return run_async  # type: ignore[return-value]

        @functools.wraps(fn)
        def run(*args: Any, **kwargs: Any) -> Any:
            with _TraceScope(name, kind, headers):
                return fn(*args, **kwargs)

        return run


def trace(name: str, fn: Optional[Callable[..., T]] = None, *args: Any, headers: Optional[Mapping[str, Any]] = None, attributes: Optional[Dict[str, Any]] = None, **kwargs: Any) -> Any:
    """Start a root trace outside HTTP (cron jobs, queue consumers, scripts). Inside a trace it records a child span.

    - ``with stacklens.trace("nightly-report"): ...`` (or ``async with``)
    - ``@stacklens.trace("nightly-report")`` on a sync or async function
    - ``stacklens.trace("nightly-report", fn, *args)`` runs ``fn`` now (returns a coroutine for async ``fn``)

    ``headers`` (e.g. message headers carrying ``traceparent``) link the trace to the call that enqueued it."""
    scope = _TraceScope(name, "job", headers, attributes)
    if fn is None:
        return scope
    return scope(fn)(*args, **kwargs)


def log(message: str, data: Any = None, level: str = "info") -> None:
    """Attach a log line (and optional data) to the currently executing call."""
    try:
        tracer.add_log(level if level in ("log", "info", "warn", "error", "debug") else "info", str(message), data, has_data=data is not None)
    except Exception:
        pass


def set_attributes(attributes: Optional[Dict[str, Any]] = None, **kw: Any) -> None:
    """Add custom attributes to the currently executing call."""
    ctx = current.get()
    if ctx is None:
        return
    span = ctx.trace.by_id.get(ctx.span_id)
    if span is None:
        return
    merged = dict(attributes or {}, **kw)
    try:
        span["attributes"] = {**span.get("attributes", {}), **tracer.serialize(merged)}
    except Exception:
        pass


def set_user(user_id: Union[str, int]) -> None:
    """Set the end-user id of the current trace (overrides ``get_user_id``)."""
    ctx = current.get()
    if ctx is not None and user_id is not None:
        ctx.trace.record["userId"] = str(user_id)


def current_trace_id() -> Optional[str]:
    """Id of the current trace, e.g. to include in error responses or logs."""
    ctx = current.get()
    return ctx.trace.record["id"] if ctx else None


def propagation_headers() -> Dict[str, str]:
    """``traceparent`` / ``tracestate`` for the current call, for transports StackLens doesn't patch
    (message queues, gRPC, a custom HTTP client). ``{}`` outside a trace or with ``propagate=False``."""
    ctx = current.get()
    if ctx is None or not tracer.opts.propagate:
        return {}
    out = {"traceparent": format_traceparent(ctx.trace.record["id"], ctx.span_id)}
    state = format_tracestate(tracer.opts.application)
    if state:
        out["tracestate"] = state
    return out


def flush(timeout: float = 5.0) -> bool:
    """Send queued traces now (call before exit in scripts and tests). ``True`` when everything was sent in time."""
    return tracer.flush(timeout)


# re-exported for integrations and advanced use
TRACE_ID_HEADER = TRACE_ID_HEADER
