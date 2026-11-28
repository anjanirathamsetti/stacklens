"""Celery: one trace (kind ``job``) per task execution, linked to the call that enqueued it.

.. code-block:: python

    from stacklens.integrations.celery import instrument_celery
    stacklens.init(application="billing-worker")
    instrument_celery()          # in the worker and in the processes that enqueue tasks

Producer side: ``task.delay()`` / ``apply_async()`` inside a trace records an ``enqueue <task>`` span and
sends ``traceparent`` / ``tracestate`` in the message headers. Worker side: the task becomes a trace whose
``parent`` points at that span, with a span for the task function (arguments, return value, exception).
Retries are logged on the task span. A task run eagerly inside a request is recorded as a child span."""

from __future__ import annotations

import threading
from typing import Any, Dict, Optional, Tuple

from .._context import TraceContext, current
from .._instrument import ParamInfo, _bind, _param_names
from .._propagation import format_traceparent, format_tracestate, parent_from_headers
from .._tracer import SpanInit, tracer

_lock = threading.Lock()
_publishing: Dict[str, Tuple[Any, Dict[str, Any]]] = {}
_running: Dict[str, Dict[str, Any]] = {}
_installed = {"done": False}


def _short(task_name: str) -> Tuple[Optional[str], str]:
    """``app.tasks.send_receipt`` → (``tasks``, ``send_receipt``)."""
    parts = task_name.split(".")
    if len(parts) >= 2:
        return parts[-2], parts[-1]
    return None, task_name


def _body_name(task: Any, task_name: str) -> Tuple[Optional[str], str]:
    """Span name for the task function: ``<module>.<function>`` of the code that runs (``tasks.send_receipt``),
    falling back to the last two parts of the task name."""
    run = getattr(task, "run", None)
    fn = getattr(run, "__func__", run)
    mod = getattr(fn, "__module__", None)
    fname = getattr(fn, "__name__", None)
    if mod and fname and fname != "run" and not mod.startswith("celery."):
        return mod.rsplit(".", 1)[-1], fname
    return _short(task_name)


# ---------------------------------------------------------------------------- producer


def _before_publish(sender: Any = None, body: Any = None, headers: Optional[Dict[str, Any]] = None, **kwargs: Any) -> None:
    ctx = current.get()
    if ctx is None or ctx.trace.finished or headers is None:
        return
    try:
        task_name = str(sender or headers.get("task") or "task")
        task_id = headers.get("id")
        call = tracer.begin_call(ctx.trace, ctx.span_id, SpanInit(f"enqueue {task_name}", "apply_async", "job", ["task", "args", "kwargs"], "Celery"))
        span = call.span if call.mode == "span" else None
        if span is not None:
            args = body[0] if isinstance(body, (list, tuple)) and body else headers.get("argsrepr")
            kw = body[1] if isinstance(body, (list, tuple)) and len(body) > 1 else headers.get("kwargsrepr")
            tracer.capture_args(ctx.trace, span, [task_name, args, kw])
            span["attributes"] = {"celery.task_id": task_id, "celery.queue": kwargs.get("routing_key")}
        if tracer.opts.propagate:
            headers["traceparent"] = format_traceparent(ctx.trace.record["id"], span["id"] if span else ctx.span_id)
            state = format_tracestate(tracer.opts.application)
            if state:
                headers["tracestate"] = state
        if span is not None and task_id:
            with _lock:
                _publishing[str(task_id)] = (ctx.trace, span)
    except Exception:
        pass


def _after_publish(sender: Any = None, headers: Optional[Dict[str, Any]] = None, body: Any = None, **kwargs: Any) -> None:
    try:
        task_id = (headers or {}).get("id")
        if not task_id:
            return
        with _lock:
            item = _publishing.pop(str(task_id), None)
        if item is not None:
            trace, span = item
            tracer.end_span(trace, span, {"taskId": task_id}, None)
    except Exception:
        pass


# ---------------------------------------------------------------------------- worker


def _incoming_headers(task: Any) -> Dict[str, Any]:
    req = getattr(task, "request", None)
    out: Dict[str, Any] = {}
    for key in ("traceparent", "tracestate"):
        v = getattr(req, key, None)
        if v is None:
            hdrs = getattr(req, "headers", None) or {}
            v = hdrs.get(key) if isinstance(hdrs, dict) else None
        if v is not None:
            out[key] = v
    return out


def _prerun(sender: Any = None, task_id: Any = None, task: Any = None, args: Any = None, kwargs: Any = None, **extra: Any) -> None:
    if task is None or not tracer.opts.enabled:
        return
    try:
        name = getattr(task, "name", None) or str(sender)
        label, method = _body_name(task, name)
        ctx = current.get()
        state: Dict[str, Any] = {}
        if ctx is not None and not ctx.trace.finished:
            trace, parent_id = ctx.trace, ctx.span_id  # eager task inside a request / job
            state["mode"] = "child"
        else:
            if not tracer.should_sample():
                return
            trace, root = tracer.create_trace(name, "job", "job")
            parent = parent_from_headers(_incoming_headers(task))
            if parent:
                trace.record["parent"] = parent
            req = getattr(task, "request", None)
            root["attributes"] = tracer.serialize({"celery.task_id": task_id, "celery.retries": getattr(req, "retries", 0), "celery.queue": (getattr(req, "delivery_info", None) or {}).get("routing_key")})
            parent_id = root["id"]
            state.update(mode="trace", root=root)
        run = getattr(task, "run", None)
        try:
            info = _param_names(run) if run is not None else ParamInfo([], "args", False, {})
        except Exception:
            info = ParamInfo([], "args", False, {})
        # bound tasks (bind=True) declare ``self`` but Celery's ``args`` don't include it
        positional = ((None,) if info.skip_first else ()) + tuple(args or ())
        params, values = _bind(info, positional, dict(kwargs or {}))
        call = tracer.begin_call(trace, parent_id, SpanInit(f"{label}.{method}" if label else method, method, "handler", params, label))
        span = call.span if call.mode == "span" else None
        if span is not None:
            tracer.capture_args(trace, span, values)
        state.update(trace=trace, span=span, token=current.set(TraceContext(trace, span["id"] if span else parent_id)))
        with _lock:
            _running[str(task_id)] = state
    except Exception:
        pass


def _failure(sender: Any = None, task_id: Any = None, exception: Optional[BaseException] = None, **extra: Any) -> None:
    with _lock:
        state = _running.get(str(task_id))
    if state is not None and exception is not None:
        state["error"] = exception


def _retry(sender: Any = None, request: Any = None, reason: Any = None, **extra: Any) -> None:
    tracer.add_log("warn", f"retrying: {reason}", None)


def _postrun(sender: Any = None, task_id: Any = None, task: Any = None, retval: Any = None, state: Any = None, **extra: Any) -> None:
    with _lock:
        st = _running.pop(str(task_id), None)
    if st is None:
        return
    try:
        try:
            current.reset(st["token"])
        except ValueError:
            current.set(None)
        trace, span = st["trace"], st["span"]
        err = st.get("error")
        if err is None and state in ("FAILURE",) and isinstance(retval, BaseException):
            err = retval
        retry = type(err).__name__ == "Retry" if err is not None else False
        if span is not None:
            if err is not None and not retry:
                tracer.end_span(trace, span, error=err)
            else:
                tracer.end_span(trace, span, retval if not isinstance(retval, BaseException) else None, has_result=not isinstance(retval, BaseException))
        if st["mode"] == "trace":
            tracer.finish_trace(trace, st["root"], err if (err is not None and not retry) else None)
    except Exception:
        pass


def instrument_celery(app: Any = None) -> None:
    """Connect the Celery signals (process-wide; ``app`` is accepted for symmetry). Idempotent."""
    if _installed["done"]:
        return
    _installed["done"] = True
    from celery import signals

    signals.before_task_publish.connect(_before_publish, weak=False)
    signals.after_task_publish.connect(_after_publish, weak=False)
    signals.task_prerun.connect(_prerun, weak=False)
    signals.task_failure.connect(_failure, weak=False)
    signals.task_retry.connect(_retry, weak=False)
    signals.task_postrun.connect(_postrun, weak=False)
