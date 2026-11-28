"""Trace state and the contextvar that carries "current trace + current span" through calls, threads and asyncio tasks."""

from __future__ import annotations

import contextvars
import os
import threading
from typing import Any, Dict, List, NamedTuple, Optional


def new_id(nbytes: int = 8) -> str:
    """Random hex id: 16 bytes for traces, 8 for spans (the W3C trace-context widths)."""
    return os.urandom(nbytes).hex()


class SiblingGroup:
    """Repeated calls of one function under one parent (see ``max_repeated_calls``)."""

    __slots__ = ("recorded", "aggregate", "errors_kept")

    def __init__(self) -> None:
        self.recorded = 0
        self.aggregate: Optional[Dict[str, Any]] = None
        self.errors_kept = 0


class ActiveTrace:
    """A trace that is still being recorded."""

    __slots__ = ("record", "t0", "span_count", "by_id", "siblings", "capture_bytes", "finished", "lock")

    def __init__(self, record: Dict[str, Any], t0: float):
        self.record = record
        #: ``time.perf_counter()`` (seconds) when the trace started; span offsets are relative to it
        self.t0 = t0
        self.span_count = 0
        self.by_id: Dict[str, Dict[str, Any]] = {}
        self.siblings: Dict[Any, SiblingGroup] = {}
        self.capture_bytes = 0
        #: set once the trace has been handed to the exporter; later spans are ignored
        self.finished = False
        #: spans may be added from several threads (thread pools) at once
        self.lock = threading.Lock()

    @property
    def spans(self) -> List[Dict[str, Any]]:
        return self.record["spans"]


class TraceContext(NamedTuple):
    trace: ActiveTrace
    span_id: str


#: The current trace and executing span. asyncio tasks copy it when created, so ``gather``-ed calls
#: get the right parent; ``contextvars.copy_context().run`` carries it into threads.
current: "contextvars.ContextVar[Optional[TraceContext]]" = contextvars.ContextVar("stacklens_current", default=None)
