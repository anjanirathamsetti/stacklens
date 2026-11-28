"""Attach ``logging`` records emitted inside a traced call to that call's span (Node: ``captureConsole``).

Records are observed where loggers dispatch them to handlers (``Logger.callHandlers``), so the levels and
filters you configure still decide what is recorded, and ``logging.basicConfig()`` keeps working (no handler
is added to the root logger). Nothing is formatted or emitted by StackLens itself."""

from __future__ import annotations

import logging
from typing import Any, Dict

from ._context import current

_LEVELS = {logging.DEBUG: "debug", logging.INFO: "info", logging.WARNING: "warn", logging.ERROR: "error", logging.CRITICAL: "error"}

# attributes every LogRecord has; anything else came in via ``extra=`` and is kept as data
_STANDARD = set(logging.LogRecord("", 0, "", 0, "", (), None).__dict__) | {"message", "asctime", "taskName"}


class SpanLogHandler(logging.Handler):
    def __init__(self) -> None:
        super().__init__(level=logging.NOTSET)
        self.enabled = True

    def emit(self, record: logging.LogRecord) -> None:
        if not self.enabled or record.name == "stacklens" or current.get() is None:
            return
        try:
            from ._tracer import tracer

            level = _LEVELS.get(record.levelno) or ("error" if record.levelno > logging.ERROR else "debug" if record.levelno < logging.INFO else "info")
            message = record.getMessage()
            data: Dict[str, Any] = {k: v for k, v in record.__dict__.items() if k not in _STANDARD and not k.startswith("_")}
            if record.name and record.name != "root":
                data["logger"] = record.name
            if record.exc_info and record.exc_info[1] is not None:
                data["exception"] = record.exc_info[1]
            tracer.add_log(level, message, data, has_data=bool(data))
        except Exception:
            pass


_handler = SpanLogHandler()
_patched = False


def install(enabled: bool) -> None:
    global _patched
    _handler.enabled = enabled
    if not enabled or _patched:
        return
    _patched = True
    original = logging.Logger.callHandlers

    def callHandlers(self: logging.Logger, record: logging.LogRecord) -> None:
        if _handler.enabled and current.get() is not None:
            _handler.emit(record)
        original(self, record)

    callHandlers.__wrapped__ = original  # type: ignore[attr-defined]
    logging.Logger.callHandlers = callHandlers  # type: ignore[method-assign]
