"""The tracer runtime: configuration, traces, spans, value capture and handing finished traces to the exporter."""

from __future__ import annotations

import logging
import random
import time
from typing import Any, Dict, List, Mapping, Optional, Tuple

from ._capture import Limits, approx_size, capture, serialize
from ._context import ActiveTrace, SiblingGroup, TraceContext, current, new_id
from ._errors import to_span_error
from ._exporter import Exporter
from ._options import Options, cached_matcher, host_matcher, matcher, resolve_options

_log = logging.getLogger("stacklens")

#: Failing collapsed calls recorded individually per group (with their arguments), so errors stay debuggable.
KEEP_COLLAPSED_ERRORS = 3

SDK_NAME = "stacklens-python-tracer"


def _sdk_info() -> Dict[str, str]:
    import platform

    from ._version import __version__

    return {"name": SDK_NAME, "version": __version__, "language": "python", "runtime": f"{platform.python_implementation()} {platform.python_version()}"}


SDK_INFO = _sdk_info()


class SpanInit:
    __slots__ = ("name", "method", "class_name", "kind", "params")

    def __init__(self, name: str, method: str, kind: str, params: List[str], class_name: Optional[str] = None):
        self.name = name
        self.method = method
        self.class_name = class_name
        self.kind = kind
        self.params = params


class CallHandle:
    """What ``begin_call`` decided for one call: ``span`` (own span), ``collapsed`` (folded into the
    group's aggregate span) or ``dropped`` (``max_spans_per_trace`` reached: run untraced)."""

    __slots__ = ("mode", "span", "group", "parent_id", "init", "start")

    def __init__(self, mode: str, span: Optional[Dict[str, Any]] = None, group: Optional[SiblingGroup] = None, parent_id: Optional[str] = None, init: Optional[SpanInit] = None, start: float = 0.0):
        self.mode = mode
        self.span = span  # own span, or the aggregate for "collapsed"
        self.group = group
        self.parent_id = parent_id
        self.init = init
        self.start = start


DROPPED = CallHandle("dropped")


def _now_ms(trace: ActiveTrace) -> float:
    return (time.perf_counter() - trace.t0) * 1000.0


class Tracer:
    def __init__(self) -> None:
        self.opts: Options = Options()
        self.exporter = Exporter(self)
        self.initialized = False
        self._apply()

    def configure(self, given: Mapping[str, Any]) -> None:
        self.opts = resolve_options(given, base=self.opts if self.initialized else None)
        self.initialized = True
        self._apply()

    def _apply(self) -> None:
        o = self.opts
        self.limits = Limits(o.max_depth, o.max_string_length, o.max_array_length, o.max_object_keys, cached_matcher(o.redact_keys))
        self.is_ignored_method = matcher(o.ignore_methods)
        self.propagates_to = host_matcher(o.propagate_to)

    # ------------------------------------------------------------------ values

    def serialize(self, v: Any) -> Any:
        return serialize(v, self.limits)

    def capture(self, v: Any) -> Tuple[Any, Optional[str]]:
        return capture(v, self.limits, self.opts.infer_types)

    # ------------------------------------------------------------------ traces

    @staticmethod
    def current() -> Optional[TraceContext]:
        return current.get()

    def should_sample(self) -> bool:
        o = self.opts
        return o.enabled and (o.sample_rate >= 1 or random.random() < o.sample_rate)

    def is_ignored_path(self, path: str) -> bool:
        for p in self.opts.ignore_paths:
            if isinstance(p, str):
                if path.startswith(p):
                    return True
            elif p.search(path):
                return True
        return False

    def create_trace(self, name: str, kind: str, root_kind: str) -> Tuple[ActiveTrace, Dict[str, Any]]:
        o = self.opts
        record: Dict[str, Any] = {
            "id": new_id(16),
            "service": o.application,
            "application": o.application,
            "project": o.project,
            "environment": o.environment,
            "name": name,
            "kind": kind,
            "startTime": time.time() * 1000.0,
            "duration": 0,
            "status": "pending",
            "spans": [],
            "sdk": SDK_INFO,
        }
        trace = ActiveTrace(record, time.perf_counter())
        root = self.start_span(trace, None, SpanInit(name, name, root_kind, []))
        assert root is not None
        return trace, root

    def start_span(self, trace: ActiveTrace, parent_id: Optional[str], s: SpanInit, start: Optional[float] = None) -> Optional[Dict[str, Any]]:
        """``None`` when the trace is finished or ``max_spans_per_trace`` was reached."""
        with trace.lock:
            if trace.finished:
                return None
            if trace.span_count >= self.opts.max_spans_per_trace:
                trace.record["truncated"] = True
                trace.record["droppedSpans"] = trace.record.get("droppedSpans", 0) + 1
                return None
            trace.span_count += 1
            span: Dict[str, Any] = {
                "id": new_id(8),
                "parentId": parent_id,
                "name": s.name,
                "method": s.method,
                "kind": s.kind,
                "start": _now_ms(trace) if start is None else start,
                "duration": 0,
                "status": "pending",
                "async": False,
                "params": s.params,
            }
            if s.class_name:
                span["className"] = s.class_name
            trace.record["spans"].append(span)
            trace.by_id[span["id"]] = span
            return span

    def begin_call(self, trace: ActiveTrace, parent_id: Optional[str], init: SpanInit) -> CallHandle:
        """The first ``max_repeated_calls`` calls of a function under the same parent get their own span;
        later ones fold into one aggregate span, so a helper called in a 10,000-item loop costs one span."""
        if trace.finished:
            return DROPPED
        limit = self.opts.max_repeated_calls
        if limit <= 0:
            span = self.start_span(trace, parent_id, init)
            return CallHandle("span", span) if span else DROPPED
        key = (parent_id, init.name)
        group = trace.siblings.get(key)
        if group is None:
            group = trace.siblings.setdefault(key, SiblingGroup())
        if group.recorded < limit:
            span = self.start_span(trace, parent_id, init)
            if span is None:
                return DROPPED
            group.recorded += 1
            return CallHandle("span", span)
        start = _now_ms(trace)
        if group.aggregate is None:
            agg = self.start_span(trace, parent_id, init, start)
            if agg is None:
                return DROPPED
            agg["collapsed"] = {"count": 0, "totalDuration": 0.0, "minDuration": float("inf"), "maxDuration": 0.0, "errors": 0}
            agg["status"] = "ok"
            group.aggregate = agg
        return CallHandle("collapsed", group.aggregate, group, parent_id, init, start)

    def end_collapsed(self, trace: ActiveTrace, h: CallHandle, args: List[Any], is_async: bool, error: Optional[BaseException] = None) -> None:
        end = _now_ms(trace)
        agg = h.span
        assert agg is not None and h.group is not None and h.init is not None
        if is_async:
            agg["async"] = True
        agg["duration"] = max(agg["duration"], end - agg["start"])
        # the first few failures become real spans (with arguments) and are not counted in the aggregate
        if error is not None and h.group.errors_kept < KEEP_COLLAPSED_ERRORS and not trace.finished:
            span = self.start_span(trace, h.parent_id, h.init, h.start)
            if span is not None:
                h.group.errors_kept += 1
                span["async"] = is_async
                self.capture_args(trace, span, args)
                self.end_span(trace, span, error=error)
                return
        d = end - h.start
        c = agg["collapsed"]
        c["count"] += 1
        c["totalDuration"] += d
        if d < c["minDuration"]:
            c["minDuration"] = d
        if d > c["maxDuration"]:
            c["maxDuration"] = d
        if error is not None:
            c["errors"] += 1

    def _has_budget(self, trace: ActiveTrace, span: Dict[str, Any]) -> bool:
        if trace.capture_bytes < self.opts.max_capture_bytes:
            return True
        span["valuesDropped"] = True
        trace.record["valuesTruncated"] = True
        return False

    def capture_args(self, trace: ActiveTrace, span: Dict[str, Any], args: List[Any]) -> None:
        if not self.opts.capture_args or not self._has_budget(trace, span):
            return
        values = []
        types_ = []
        for a in args:
            v, t = self.capture(a)
            values.append(v)
            types_.append(t or "Any")
        span["args"] = values
        if self.opts.infer_types:
            span["argTypes"] = types_
        trace.capture_bytes += approx_size(values)

    def end_span(self, trace: ActiveTrace, span: Dict[str, Any], result: Any = None, error: Optional[BaseException] = None, has_result: bool = True) -> None:
        span["duration"] = max(0.0, _now_ms(trace) - span["start"])
        if error is not None:
            span["status"] = "error"
            span["error"] = to_span_error(error)
            return
        span["status"] = "ok"
        # Python functions without a return statement return None; record it like any other value
        if self.opts.capture_results and has_result and not trace.finished and self._has_budget(trace, span):
            v, t = self.capture(result)
            span["result"] = v
            if t is not None:
                span["resultType"] = t
            trace.capture_bytes += approx_size(v)

    def capture_late(self, trace: ActiveTrace, span: Dict[str, Any], value: Any) -> Any:
        if trace.finished or not self.opts.capture_results or not self._has_budget(trace, span):
            return None
        v, _ = self.capture(value)
        trace.capture_bytes += approx_size(v)
        return v

    def add_log(self, level: str, message: str, data: Any = None, has_data: bool = False) -> bool:
        """Attach a log line to the currently executing span. ``False`` outside a trace."""
        ctx = current.get()
        if ctx is None or ctx.trace.finished:
            return False
        span = ctx.trace.by_id.get(ctx.span_id)
        if span is None:
            return False
        logs = span.get("logs")
        if logs is not None and len(logs) >= self.opts.max_logs_per_span:
            span["droppedLogs"] = span.get("droppedLogs", 0) + 1
            return True
        entry: Dict[str, Any] = {"t": _now_ms(ctx.trace), "level": level, "message": message}
        if has_data:
            entry["data"] = self.serialize(data)
        if logs is None:
            span["logs"] = [entry]
        else:
            logs.append(entry)
        return True

    def finish_trace(self, trace: ActiveTrace, root: Dict[str, Any], error: Optional[BaseException] = None) -> None:
        """Close the root span; export once fire-and-forget work has had ``settle_ms`` to finish."""
        if trace.finished or root["status"] != "pending":
            return
        self.end_span(trace, root, error=error, has_result=False)
        rec = trace.record
        rec["duration"] = root["duration"]
        http = rec.get("http") or {}
        failed = root["status"] == "error" or (http.get("statusCode") or 0) >= 500
        rec["status"] = "error" if failed else "ok"
        self.exporter.submit(trace, self.opts.settle_ms)

    def seal(self, trace: ActiveTrace) -> Dict[str, Any]:
        """Mark a trace finished (later spans are ignored) and make the record JSON-valid."""
        with trace.lock:
            trace.finished = True
            for g in trace.siblings.values():
                agg = g.aggregate
                if agg is not None and agg["collapsed"]["minDuration"] == float("inf"):
                    agg["collapsed"]["minDuration"] = 0
            # spans still running when the trace was exported (fire-and-forget work)
            for s in trace.record["spans"]:
                if s["status"] == "pending":
                    s["duration"] = max(0.0, _now_ms(trace) - s["start"])
            rec = dict(trace.record)
            rec["spans"] = list(trace.record["spans"])
            return rec

    def flush(self, timeout: float = 5.0) -> bool:
        return self.exporter.flush(timeout)


tracer = Tracer()
