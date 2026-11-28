"""Bounded value capture: turns any Python value into JSON the StackLens UI renders, plus an inferred type.

Serialized values use the same markers as the Node SDK::

    {"$t": "undefined"} | {"$t": "fn", "name"} | {"$t": "circular"} | {"$t": "Date", "v"}
    {"$t": "Error", "name", "message", "stack"} | {"$t": "more", "count"} | {"$t": "Set", "size", "values"}
    {"$t": "Map", "size", "entries"} | {"$t": "Promise"} | {"$t": "ref", "name", "summary"}

Objects (dataclasses, pydantic models, ORM rows, plain classes) keep their fields and get a ``$class`` key.
Type strings use Python names: ``str``, ``int``, ``list[Order]``, ``dict[str, int]``, ``Order { id: int; total: Decimal }``.
"""

from __future__ import annotations

import collections.abc as cabc
import dataclasses
import datetime as _dt
import decimal
import enum
import inspect
import re
import types
import uuid
from typing import Any, Callable, Dict, List, Optional, Tuple

TYPE_DEPTH = 3
TYPE_ARRAY_SAMPLE = 10
TYPE_MAX_KEYS = 20
MAX_SAFE_INT = 2**53 - 1
_IDENT = re.compile(r"^[A-Za-z_][\w]*$")

#: Classes (by name) summarized instead of walked: connections, sessions, sockets, frameworks' app objects.
HEAVY_NAMES = frozenset(
    {
        "Session",
        "AsyncSession",
        "scoped_session",
        "Engine",
        "AsyncEngine",
        "Connection",
        "AsyncConnection",
        "Pool",
        "QueuePool",
        "socket",
        "SSLSocket",
        "Lock",
        "RLock",
        "Condition",
        "Event",
        "Thread",
        "ThreadPoolExecutor",
        "Logger",
        "FastAPI",
        "Starlette",
        "Flask",
        "Celery",
        "Client",
        "AsyncClient",
        "HTTPConnectionPool",
        "HTTPSConnectionPool",
        "PoolManager",
        "TextIOWrapper",
        "BufferedReader",
        "BufferedWriter",
        "Cursor",
        "Task",
        "Future",
        "AbstractEventLoop",
        "BaseEventLoop",
        "_UnixSelectorEventLoop",
    }
)


class Limits:
    __slots__ = ("max_depth", "max_string_length", "max_array_length", "max_object_keys", "redact")

    def __init__(self, max_depth: int, max_string_length: int, max_array_length: int, max_object_keys: int, redact: Callable[[str], bool]):
        self.max_depth = max_depth
        self.max_string_length = max_string_length
        self.max_array_length = max_array_length
        self.max_object_keys = max_object_keys
        self.redact = redact


def _union(types_: List[str]) -> str:
    uniq = list(dict.fromkeys(types_))
    if not uniq:
        return "Any"
    if len(uniq) == 1:
        return uniq[0]
    if len(uniq) > 4:
        return "Any"
    return " | ".join(uniq)


def _cls_name(v: Any) -> str:
    try:
        return type(v).__name__
    except Exception:
        return "object"


def _safe_repr(v: Any, limit: int = 120) -> str:
    try:
        r = repr(v)
    except Exception:
        return f"<{_cls_name(v)}>"
    return r if len(r) <= limit else r[:limit] + "…"


def _summarize_request_like(name: str, v: Any) -> Optional[Dict[str, Any]]:
    """Framework request/response objects: one line instead of their (huge) internals."""
    try:
        if name.endswith("Request") and hasattr(v, "method") and (hasattr(v, "headers") or hasattr(v, "META")):
            url = getattr(v, "url", None)
            path = getattr(v, "path", None)
            target = path if isinstance(path, str) else str(getattr(url, "path", url) if url is not None else "")
            return {"$t": "ref", "name": "Request", "summary": f"{v.method} {target}".strip()}
        if (name.endswith("Response") or name.startswith("HttpResponse")) and hasattr(v, "status_code") and (hasattr(v, "headers") or hasattr(v, "items")):
            return {"$t": "ref", "name": name, "summary": f"status {v.status_code}"}
    except Exception:
        return None
    return None


def _fn_type(fn: Any) -> str:
    try:
        sig = inspect.signature(fn)
        params = ", ".join(p for p in sig.parameters if p not in ("self", "cls"))
    except (TypeError, ValueError):
        params = "..."
    prefix = "async " if inspect.iscoroutinefunction(fn) else ""
    return f"{prefix}({params}) -> Any"


def _object_fields(v: Any) -> Optional[List[Tuple[str, Any]]]:
    """Fields of an object worth showing, or None to summarize it as a ref."""
    # pydantic v2 / v1
    fields_map = getattr(type(v), "model_fields", None)
    if isinstance(fields_map, dict) and hasattr(v, "model_dump"):
        return [(k, getattr(v, k, None)) for k in fields_map]
    fields_v1 = getattr(type(v), "__fields__", None)
    if isinstance(fields_v1, dict) and hasattr(v, "dict") and hasattr(v, "json"):
        return [(k, getattr(v, k, None)) for k in fields_v1]
    if dataclasses.is_dataclass(v) and not isinstance(v, type):
        return [(f.name, getattr(v, f.name, None)) for f in dataclasses.fields(v)]
    # SQLAlchemy ORM instances: loaded column / relationship values only (no lazy loads triggered)
    state = getattr(v, "_sa_instance_state", None)
    if state is not None:
        try:
            d = v.__dict__
            return [(k, d[k]) for k in d if not k.startswith("_sa_")]
        except Exception:
            return []
    d = getattr(v, "__dict__", None)
    if isinstance(d, dict):
        return [(k, val) for k, val in d.items() if not (k.startswith("__") and k.endswith("__"))]
    slots = getattr(type(v), "__slots__", None)
    if slots:
        names = [slots] if isinstance(slots, str) else list(slots)
        out = []
        for k in names:
            if k.startswith("__"):
                continue
            try:
                out.append((k, getattr(v, k)))
            except AttributeError:
                continue
        return out
    return None


def capture(value: Any, limits: Limits, with_type: bool = True) -> Tuple[Any, Optional[str]]:
    """Serialized value and inferred type in a single walk (runs for every argument and return value)."""
    seen: set = set()

    def walk(v: Any, depth: int, want_t: bool) -> Tuple[Any, Optional[str]]:
        t = type(v)
        # --- scalars (fast paths first) ---
        if t is str:
            if len(v) > limits.max_string_length:
                return v[: limits.max_string_length] + f"… (+{len(v) - limits.max_string_length} chars)", "str"
            return v, "str"
        if t is bool:
            return v, "bool"
        if t is int:
            return (v if -MAX_SAFE_INT <= v <= MAX_SAFE_INT else str(v)), "int"
        if t is float:
            return (v if v == v and v not in (float("inf"), float("-inf")) else str(v)), "float"
        if v is None:
            return None, "None"
        if isinstance(v, enum.Enum):
            inner, _ = walk(v.value, depth + 1, False)
            return inner, t.__name__
        if isinstance(v, str):  # str subclasses
            s, _ = walk(str(v), depth, False)
            return s, t.__name__
        if isinstance(v, bool):
            return bool(v), "bool"
        if isinstance(v, int):
            return walk(int(v), depth, False)[0], t.__name__
        if isinstance(v, float):
            return walk(float(v), depth, False)[0], t.__name__
        if isinstance(v, decimal.Decimal):
            return str(v), "Decimal"
        if isinstance(v, uuid.UUID):
            return str(v), "UUID"
        if isinstance(v, _dt.datetime):
            return {"$t": "Date", "v": v.isoformat()}, "datetime"
        if isinstance(v, _dt.date):
            return {"$t": "Date", "v": v.isoformat()}, "date"
        if isinstance(v, _dt.time):
            return v.isoformat(), "time"
        if isinstance(v, _dt.timedelta):
            return f"{v.total_seconds()}s", "timedelta"
        if isinstance(v, (bytes, bytearray, memoryview)):
            n = len(v) if not isinstance(v, memoryview) else v.nbytes
            return {"$t": "ref", "name": t.__name__, "summary": f"{n} bytes"}, t.__name__
        if isinstance(v, complex):
            return str(v), "complex"
        if isinstance(v, BaseException):
            from ._errors import format_stack

            return {"$t": "Error", "name": t.__name__, "message": str(v), "stack": format_stack(v)}, t.__name__
        if isinstance(v, type):
            return {"$t": "ref", "name": "class", "summary": v.__name__}, f"type[{v.__name__}]"
        if isinstance(v, types.ModuleType):
            return {"$t": "ref", "name": "module", "summary": v.__name__}, "ModuleType"
        if inspect.iscoroutine(v) or inspect.isawaitable(v) and not hasattr(v, "__dict__"):
            return {"$t": "Promise"}, "Coroutine"
        if isinstance(v, (types.FunctionType, types.MethodType, types.BuiltinFunctionType, functools_partial)):
            name = getattr(v, "__name__", None) or getattr(getattr(v, "func", None), "__name__", "anonymous")
            return {"$t": "fn", "name": name}, (_fn_type(v) if want_t else None)
        if isinstance(v, (types.GeneratorType, types.AsyncGeneratorType)) or (isinstance(v, cabc.Iterator) and not isinstance(v, cabc.Sized)):
            return {"$t": "ref", "name": t.__name__}, t.__name__

        oid = id(v)
        if oid in seen:
            return {"$t": "circular"}, "Circular"
        name = t.__name__
        if name in HEAVY_NAMES:
            return {"$t": "ref", "name": name}, name
        req = _summarize_request_like(name, v)
        if req is not None:
            return req, name

        seen.add(oid)
        try:
            # --- sequences ---
            if isinstance(v, (list, tuple, cabc.Sequence)) and not isinstance(v, (str, bytes, bytearray)) and isinstance(v, cabc.Sized):
                is_tuple = isinstance(v, tuple) and not hasattr(v, "_fields")
                if hasattr(v, "_fields") and isinstance(v, tuple):  # namedtuple → object
                    return _walk_fields(name, list(zip(v._fields, v)), depth, want_t, is_class=True)
                n = len(v)
                if depth >= limits.max_depth:
                    return {"$t": "more", "count": n, "kind": "array"}, (f"{_seq_name(v)}[Any]" if want_t else None)
                out: List[Any] = []
                tys: List[str] = []
                type_kids = want_t and n > 0 and depth < TYPE_DEPTH
                upto = max(min(n, limits.max_array_length), min(n, TYPE_ARRAY_SAMPLE) if type_kids else 0)
                for i in range(upto):
                    try:
                        item = v[i]
                    except Exception:
                        break
                    cs, ct = walk(item, depth + 1, type_kids and i < TYPE_ARRAY_SAMPLE)
                    if i < limits.max_array_length:
                        out.append(cs)
                    if type_kids and i < TYPE_ARRAY_SAMPLE:
                        tys.append(ct or "Any")
                if n > limits.max_array_length:
                    out.append({"$t": "more", "count": n - limits.max_array_length})
                ty = None
                if want_t:
                    seq = _seq_name(v)
                    if not type_kids:
                        ty = f"{seq}[Any]" if n else f"{seq}[Any]"
                    elif is_tuple and len(tys) <= 6 and n <= 6:
                        ty = f"tuple[{', '.join(tys)}]"
                    else:
                        ty = f"{seq}[{_union(tys)}]" + ("" if not is_tuple else "")
                        if is_tuple:
                            ty = f"tuple[{_union(tys)}, ...]"
                return out, ty

            # --- sets ---
            if isinstance(v, (set, frozenset, cabc.Set)):
                vals: List[Any] = []
                ty = f"{name}[Any]" if want_t else None
                for i, item in enumerate(v):
                    if i >= limits.max_array_length and not (want_t and i == 0):
                        break
                    cs, ct = walk(item, depth + 1, want_t and i == 0)
                    if i < limits.max_array_length:
                        vals.append(cs)
                    if want_t and i == 0:
                        ty = f"{name}[{ct}]"
                return {"$t": "Set", "size": len(v), "values": vals}, ty

            # --- mappings ---
            if isinstance(v, (dict, cabc.Mapping)):
                keys = list(v.keys()) if isinstance(v, dict) else list(v)
                if keys and not all(isinstance(k, str) for k in keys[: limits.max_object_keys]):
                    # non-string keys: a Map, typed dict[K, V]
                    entries = []
                    ty = "dict[Any, Any]" if want_t else None
                    for i, k in enumerate(keys[: limits.max_array_length]):
                        ks, kt = walk(k, depth + 1, want_t and i == 0)
                        vs, vt = walk(v[k], depth + 1, want_t and i == 0)
                        entries.append([ks, vs])
                        if want_t and i == 0:
                            ty = f"dict[{kt}, {vt}]"
                    return {"$t": "Map", "size": len(keys), "entries": entries}, ty
                cls_label = name if name not in ("dict", "OrderedDict", "defaultdict", "mappingproxy") and not isinstance(v, dict) else None
                return _walk_fields(cls_label, [(k, _getitem(v, k)) for k in keys], depth, want_t, is_class=cls_label is not None, total=len(keys))

            # --- objects with fields ---
            fields = _object_fields(v)
            if fields is None:
                return {"$t": "ref", "name": name, "summary": _safe_repr(v)}, name
            if hasattr(v, "_asdict") and not fields:
                fields = list(v._asdict().items())
            return _walk_fields(name, fields, depth, want_t, is_class=True)
        finally:
            seen.discard(oid)

    def _walk_fields(cls_name: Optional[str], fields: List[Tuple[str, Any]], depth: int, want_t: bool, is_class: bool, total: Optional[int] = None) -> Tuple[Any, Optional[str]]:
        total = len(fields) if total is None else total
        if depth >= limits.max_depth:
            return {"$t": "ref", "name": cls_name or "dict", "summary": "…"}, (cls_name or "dict[str, Any]") if want_t else None
        out: Dict[str, Any] = {}
        if is_class and cls_name:
            out["$class"] = cls_name
        type_kids = want_t and depth < TYPE_DEPTH and total > 0
        type_fields: List[str] = []
        upto = max(min(total, limits.max_object_keys), min(total, TYPE_MAX_KEYS) if type_kids else 0)
        for i, (key, child) in enumerate(fields[:upto]):
            key = str(key)
            want_s = i < limits.max_object_keys
            want_kt = type_kids and i < TYPE_MAX_KEYS
            if want_s and limits.redact(key):
                out[key] = "[REDACTED]"
                if want_kt:
                    type_fields.append(f"{_key(key)}: str")
                continue
            if isinstance(child, _GetterFailed):
                if want_s:
                    out[key] = f"[getter raised: {child.message}]"
                continue
            cs, ct = walk(child, depth + 1, want_kt)
            if want_s:
                out[key] = cs
            if want_kt:
                type_fields.append(f"{_key(key)}: {ct or 'Any'}")
        if total > limits.max_object_keys:
            out["…"] = {"$t": "more", "count": total - limits.max_object_keys}
        ty = None
        if want_t:
            prefix = f"{cls_name} " if is_class and cls_name else ""
            if depth >= TYPE_DEPTH:
                ty = cls_name if prefix else "dict[str, Any]"
            elif total == 0:
                ty = cls_name if prefix else "dict[str, Any]"
            else:
                if total > TYPE_MAX_KEYS:
                    type_fields.append(f"/* +{total - TYPE_MAX_KEYS} more */")
                ty = f"{prefix}{{ {'; '.join(type_fields)} }}"
        return out, ty

    try:
        s, ty = walk(value, 0, with_type)
        return s, (ty if with_type else None)
    except Exception:
        return {"$t": "ref", "name": _cls_name(value), "summary": "[capture failed]"}, (_cls_name(value) if with_type else None)


class _GetterFailed:
    __slots__ = ("message",)

    def __init__(self, message: str):
        self.message = message


def _getitem(m: Any, k: Any) -> Any:
    try:
        return m[k]
    except Exception as e:  # mappings with side-effecting __getitem__
        return _GetterFailed(str(e))


def _key(k: str) -> str:
    return k if _IDENT.match(k) else repr(k)


def _seq_name(v: Any) -> str:
    if isinstance(v, list):
        return "list"
    if isinstance(v, tuple):
        return "tuple"
    return type(v).__name__


try:
    from functools import partial as functools_partial
except ImportError:  # pragma: no cover
    functools_partial = type(None)  # type: ignore


def serialize(value: Any, limits: Limits) -> Any:
    return capture(value, limits, with_type=False)[0]


def infer_type(value: Any, limits: Limits) -> str:
    return capture(value, limits, with_type=True)[1] or "Any"


def approx_size(v: Any, depth: int = 0) -> int:
    """Approximate JSON size of an already-serialized value (bounded by the serializer limits)."""
    t = type(v)
    if t is str:
        return len(v) + 2
    if t is int or t is float:
        return 8
    if t is bool:
        return 5
    if v is None:
        return 4
    if depth > 12:
        return 16
    if t is list:
        return 2 + sum(approx_size(x, depth + 1) + 1 for x in v)
    if t is dict:
        return 2 + sum(len(k) + 4 + approx_size(x, depth + 1) for k, x in v.items())
    return 8
