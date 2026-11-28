"""W3C Trace Context (https://www.w3.org/TR/trace-context/) helpers, identical in behaviour to the Node SDK.

Trace ids are 16 random bytes (32 hex) and span ids 8 bytes (16 hex), the ``traceparent`` widths, so ids pass
through unchanged. The callee keeps its own trace id and records the caller as ``parent``."""

from __future__ import annotations

import re
from typing import Any, Dict, Mapping, Optional

_TRACEPARENT = re.compile(r"^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})(?:-.*)?$")
_HEX32 = re.compile(r"^[0-9a-f]{32}$")
_HEX16 = re.compile(r"^[0-9a-f]{16}$")
_HEX = re.compile(r"^[0-9a-f]+$")
_ZERO = re.compile(r"^0+$")
_TS_BAD = re.compile(r"[^\x20-\x7e]|[,=]")

TRACESTATE_KEY = "stacklens"
#: Response header an instrumented callee sets to its own trace id.
TRACE_ID_HEADER = "x-stacklens-trace-id"


def _to_hex(id_: str, width: int) -> str:
    lower = id_.lower()
    if (_HEX32 if width == 32 else _HEX16).match(lower) and not _ZERO.match(lower):
        return lower
    if _HEX.match(lower) and len(lower) < width and not _ZERO.match(lower):
        return lower.rjust(width, "0")
    # custom ids: a stable FNV-1a hash repeated to the width (same algorithm as Node)
    out = ""
    h = 0x811C9DC5
    while len(out) < width:
        for ch in id_:
            h = ((h ^ ord(ch)) * 0x01000193) & 0xFFFFFFFF
        h = ((h ^ len(out)) * 0x01000193) & 0xFFFFFFFF
        out += format(h, "08x")
    out = out[:width]
    return "1".rjust(width, "0") if _ZERO.match(out) else out


def format_traceparent(trace_id: str, span_id: str) -> str:
    """``00-<trace id>-<span id>-01``."""
    return f"00-{_to_hex(trace_id, 32)}-{_to_hex(span_id, 16)}-01"


def parse_traceparent(header: Any) -> Optional[Dict[str, str]]:
    """Parse an incoming ``traceparent``; ``None`` when missing or invalid (all-zero ids, version ff)."""
    value = header[0] if isinstance(header, (list, tuple)) and header else header
    if isinstance(value, bytes):
        value = value.decode("latin-1")
    if not isinstance(value, str):
        return None
    v = value.strip().lower()
    m = _TRACEPARENT.match(v)
    if not m or m.group(1) == "ff" or (m.group(1) == "00" and len(v) != 55):
        return None
    if _ZERO.match(m.group(2)) or _ZERO.match(m.group(3)):
        return None
    return {"traceId": m.group(2), "spanId": m.group(3)}


def format_tracestate(application: str) -> str:
    value = _TS_BAD.sub("_", application)[:256].rstrip()
    return f"{TRACESTATE_KEY}={value}" if value else ""


def parse_tracestate(header: Any) -> Optional[str]:
    value = ",".join(header) if isinstance(header, (list, tuple)) else header
    if isinstance(value, bytes):
        value = value.decode("latin-1")
    if not isinstance(value, str):
        return None
    for member in value.split(","):
        k, eq, v = member.partition("=")
        if eq and k.strip() == TRACESTATE_KEY:
            return v.strip() or None
    return None


def parent_from_headers(headers: Optional[Mapping[str, Any]]) -> Optional[Dict[str, str]]:
    """The caller recorded on a trace started by an incoming request (``headers`` keyed lower-case)."""
    if not headers:
        return None
    tp = parse_traceparent(headers.get("traceparent"))
    if tp is None:
        return None
    service = parse_tracestate(headers.get("tracestate"))
    if service:
        tp["service"] = service
    return tp
