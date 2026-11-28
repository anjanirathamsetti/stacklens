"""Shared helpers for incoming-request integrations (ASGI, WSGI, Django)."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from .._context import ActiveTrace
from .._tracer import tracer
from .http import MAX_BODY_BYTES, _TEXTUAL, body_value


class BodyBuffer:
    """Bounded collector for body chunks of textual content types."""

    __slots__ = ("chunks", "size", "overflow")

    def __init__(self) -> None:
        self.chunks: List[bytes] = []
        self.size = 0
        self.overflow = False

    def add(self, chunk: Any) -> None:
        if not chunk:
            return
        if isinstance(chunk, str):
            chunk = chunk.encode("utf-8", "replace")
        if not isinstance(chunk, (bytes, bytearray, memoryview)):
            return
        n = len(chunk)
        self.size += n
        if self.overflow:
            return
        room = MAX_BODY_BYTES - (self.size - n)
        if n > room:
            self.overflow = True
            chunk = chunk[: max(0, room)]
        self.chunks.append(bytes(chunk))

    def value(self, content_type: Optional[str]) -> Any:
        if not self.size:
            return None
        ctype = (content_type or "").split(";")[0].strip()
        if ctype and not _TEXTUAL.search(ctype):
            return f"[{ctype} body, {self.size} bytes]"
        raw = b"".join(self.chunks)
        if self.overflow:
            return raw.decode("utf-8", "replace") + f"… [{self.size} bytes, cut at {MAX_BODY_BYTES}]"
        return body_value(raw, content_type or "application/json" if raw[:1] in (b"{", b"[") else content_type)


def textual(content_type: Optional[str]) -> bool:
    return not content_type or bool(_TEXTUAL.search(content_type))


def finish_http(
    trace: ActiveTrace,
    root: Dict[str, Any],
    *,
    method: str,
    status: Optional[int],
    route: Optional[str],
    request: Optional[Dict[str, Any]],
    response: Optional[Dict[str, Any]],
    user_id: Any,
    error: Optional[BaseException],
) -> None:
    """Fill in the trace's ``http`` exchange and close it (shared by every server integration)."""
    try:
        http = trace.record.setdefault("http", {"method": method, "url": "/"})
        if status is not None:
            http["statusCode"] = int(status)
        if route:
            http["route"] = route
            trace.record["name"] = f"{method} {route}"
            root["name"] = trace.record["name"]
            root["method"] = trace.record["name"]
        if request is not None:
            http["request"] = {k: tracer.serialize(v) for k, v in request.items() if v is not None}
        if response is not None:
            http["response"] = {k: tracer.serialize(v) for k, v in response.items() if v is not None}
        if not trace.record.get("userId") and user_id not in (None, ""):
            trace.record["userId"] = str(user_id)
        if status is not None:
            root["attributes"] = {**root.get("attributes", {}), "statusCode": int(status)}
    except Exception:
        pass
    err = error
    if err is None and status is not None and status >= 500:
        err = ServerError(f"HTTP {status}", status)
    tracer.finish_trace(trace, root, err)


class ServerError(Exception):
    """Stands in for a 5xx response that wasn't caused by an exception we saw."""

    def __init__(self, message: str, status: int):
        super().__init__(message)
        self.status = status


def resolve_user(get_user_id: Any, request: Any) -> Any:
    try:
        return get_user_id(request)
    except Exception:
        return None


def filter_headers(headers: Dict[str, Any], keep: Optional[List[str]]) -> Dict[str, Any]:
    if not keep:
        return headers
    wanted = {h.lower() for h in keep}
    return {k: v for k, v in headers.items() if k in wanted}


def split_target(path: str, query: str) -> Tuple[str, str]:
    return path or "/", (f"{path or '/'}?{query}" if query else path or "/")
