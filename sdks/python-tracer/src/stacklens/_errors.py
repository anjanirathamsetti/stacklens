"""Turn exceptions into the contract's ``SpanError`` with a Python traceback, minus the tracer's own frames."""

from __future__ import annotations

import os
import traceback
from typing import Any, Dict, Optional

_PKG_DIR = os.path.dirname(os.path.abspath(__file__)) + os.sep
MAX_STACK_CHARS = 16_000


def _own_frame(filename: str) -> bool:
    return filename.startswith(_PKG_DIR)


def _filter(te: traceback.TracebackException, seen: set) -> None:
    if id(te) in seen:
        return
    seen.add(id(te))
    try:
        frames = [f for f in te.stack if not _own_frame(f.filename)]
        if len(frames) != len(te.stack):
            te.stack = traceback.StackSummary.from_list(frames)
    except Exception:
        pass
    for nxt in (te.__cause__, te.__context__):
        if nxt is not None:
            _filter(nxt, seen)


def format_stack(e: BaseException) -> Optional[str]:
    """``Traceback (most recent call last): …`` including chained exceptions, tracer frames removed."""
    try:
        te = traceback.TracebackException(type(e), e, e.__traceback__, capture_locals=False)
        _filter(te, set())
        text = "".join(te.format()).rstrip("\n")
    except Exception:
        return None
    if len(text) > MAX_STACK_CHARS:
        # keep the head (outermost frames) and the tail (where it was raised + the message)
        half = MAX_STACK_CHARS // 2
        text = text[:half] + "\n  … (traceback trimmed) …\n" + text[-half:]
    return text


def _status_of(e: BaseException) -> Optional[int]:
    for attr in ("status_code", "status", "code"):
        try:
            v = getattr(e, attr, None)
        except Exception:
            continue
        if callable(v):
            continue
        if isinstance(v, int) and not isinstance(v, bool) and 100 <= v < 600:
            return v
    resp = getattr(e, "response", None)  # requests.HTTPError, httpx.HTTPStatusError
    code = getattr(resp, "status_code", None)
    if isinstance(code, int) and 100 <= code < 600:
        return code
    return None


def _message_of(e: BaseException) -> str:
    # werkzeug / Starlette HTTPException: ``detail`` / ``description`` carry the message
    for attr in ("detail", "description"):
        v = getattr(e, attr, None)
        if isinstance(v, str) and v:
            return v
    try:
        msg = str(e)
    except Exception:
        msg = ""
    if not msg and e.args:
        msg = repr(e.args[0])
    return msg


def to_span_error(e: Any) -> Dict[str, Any]:
    if not isinstance(e, BaseException):
        return {"name": type(e).__name__, "message": str(e)}
    out: Dict[str, Any] = {"name": type(e).__name__, "message": _message_of(e)}
    stack = format_stack(e)
    if stack:
        out["stack"] = stack
    status = _status_of(e)
    if status is not None:
        out["status"] = status
    return out
