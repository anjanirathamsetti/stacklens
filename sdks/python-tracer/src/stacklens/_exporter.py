"""Batched background export: one daemon thread seals finished traces after ``settle_ms`` and POSTs them to
``/api/ingest`` in batches. Never blocks or raises into the application; failures are reported once."""

from __future__ import annotations

import atexit
import heapq
import itertools
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from typing import TYPE_CHECKING, Any, List, Optional, Tuple

if TYPE_CHECKING:  # pragma: no cover
    from ._context import ActiveTrace
    from ._tracer import Tracer

#: Traces waiting to be exported are capped so a dead collector can't grow memory without bound.
MAX_QUEUED = 10_000


def _warn(msg: str) -> None:
    try:
        sys.stderr.write(f"[stacklens] {msg}\n")
    except Exception:
        pass


class Exporter:
    def __init__(self, tracer: "Tracer"):
        self.tracer = tracer
        self._reset()
        atexit.register(self._at_exit)
        if hasattr(os, "register_at_fork"):
            # gunicorn / celery prefork: the worker thread does not survive fork(); start a new one lazily
            os.register_at_fork(after_in_child=self._reset)

    def _reset(self) -> None:
        self._pid = os.getpid()
        self._cond = threading.Condition()
        self._heap: List[Tuple[float, int, "ActiveTrace"]] = []
        self._seq = itertools.count()
        self._thread: Optional[threading.Thread] = None
        self._flush_requested = 0
        self._flush_done = 0
        self._warned = False
        self.sent_batches = 0
        self.failed_batches = 0
        self.dropped = 0

    # ------------------------------------------------------------------ API

    def submit(self, trace: "ActiveTrace", settle_ms: float) -> None:
        if os.getpid() != self._pid:
            self._reset()
        with self._cond:
            if len(self._heap) >= MAX_QUEUED:
                self.dropped += 1
                return
            heapq.heappush(self._heap, (time.monotonic() + max(0.0, settle_ms) / 1000.0, next(self._seq), trace))
            self._ensure_thread()
            self._cond.notify()

    def flush(self, timeout: float = 5.0) -> bool:
        """Export everything queued now (including traces still settling). ``True`` when done in time."""
        if os.getpid() != self._pid:
            self._reset()
        with self._cond:
            if not self._heap and self._thread is None:
                return True
            self._ensure_thread()
            self._flush_requested += 1
            target = self._flush_requested
            self._cond.notify_all()
            deadline = time.monotonic() + timeout
            while self._flush_done < target:
                left = deadline - time.monotonic()
                if left <= 0:
                    return False
                self._cond.wait(left)
        return True

    def _at_exit(self) -> None:
        try:
            self.flush(timeout=2.0)
        except Exception:
            pass

    # ------------------------------------------------------------------ worker

    def _ensure_thread(self) -> None:
        if self._thread is None or not self._thread.is_alive():
            self._thread = threading.Thread(target=self._run, name="stacklens-exporter", daemon=True)
            self._thread.start()

    def _run(self) -> None:
        batch: List[str] = []
        batch_deadline = 0.0
        while True:
            try:
                with self._cond:
                    while True:
                        now = time.monotonic()
                        flushing = self._flush_requested > self._flush_done
                        flush_target = self._flush_requested
                        if flushing or (self._heap and self._heap[0][0] <= now) or (batch and now >= batch_deadline):
                            break
                        waits = []
                        if self._heap:
                            waits.append(self._heap[0][0] - now)
                        if batch:
                            waits.append(batch_deadline - now)
                        self._cond.wait(min(waits) if waits else None)
                    ready = []
                    while self._heap and (flushing or self._heap[0][0] <= now):
                        ready.append(heapq.heappop(self._heap)[2])
                for trace in ready:
                    encoded = self._export_one(trace)
                    if encoded is not None:
                        if not batch:
                            batch_deadline = time.monotonic() + self.tracer.opts.flush_interval_ms / 1000.0
                        batch.append(encoded)
                    if len(batch) >= max(1, self.tracer.opts.batch_size):
                        self._send(batch)
                        batch = []
                if batch and (flushing or time.monotonic() >= batch_deadline):
                    self._send(batch)
                    batch = []
                if flushing:
                    with self._cond:
                        self._flush_done = max(self._flush_done, flush_target)
                        self._cond.notify_all()
            except Exception as e:  # never let the worker die
                if self.tracer.opts.debug:
                    _warn(f"exporter error: {e!r}")
                batch = []
                time.sleep(0.05)

    def _export_one(self, trace: "ActiveTrace") -> Optional[str]:
        """Seal the trace; hand it to a custom exporter (returns None) or JSON-encode it for the batch."""
        record = self.tracer.seal(trace)
        custom = self.tracer.opts.exporter
        if custom is not None:
            try:
                custom(record)
            except Exception as e:
                if self.tracer.opts.debug:
                    _warn(f"exporter error: {e!r}")
            return None
        for attempt in range(3):
            try:
                return json.dumps(record, separators=(",", ":"), default=str, ensure_ascii=False)
            except RuntimeError:
                # a fire-and-forget call still running in another thread changed a span mid-encode: try again
                if attempt < 2:
                    time.sleep(0.005)
                    continue
                if self.tracer.opts.debug:
                    _warn("could not encode trace: it kept changing while being exported")
            except Exception as e:
                if self.tracer.opts.debug:
                    _warn(f"could not encode trace: {e}")
                break
        return None

    def _send(self, batch: List[str]) -> None:
        o = self.tracer.opts
        body = ('{"traces":[' + ",".join(batch) + "]}").encode("utf-8")
        headers = {"content-type": "application/json", "user-agent": "stacklens-python-tracer"}
        if o.api_key:
            headers["authorization"] = f"Bearer {o.api_key}"
        try:
            req = urllib.request.Request(o.endpoint, data=body, headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=10) as res:  # noqa: S310 (endpoint is configuration)
                res.read()
            self._warned = False
            self.sent_batches += 1
        except Exception as e:
            self.failed_batches += 1
            if isinstance(e, urllib.error.HTTPError):
                msg = (
                    f"HTTP 401 – {'API key rejected' if o.api_key else 'the server requires an API key (set STACKLENS_API_KEY)'}"
                    if e.code == 401
                    else f"HTTP {e.code}"
                )
            else:
                msg = str(getattr(e, "reason", None) or e)
            if o.debug and not self._warned:
                self._warned = True
                _warn(f"could not send traces to {o.endpoint}: {msg}")


def encode_traces(records: List[Any]) -> str:
    return json.dumps({"traces": records}, separators=(",", ":"), default=str)
