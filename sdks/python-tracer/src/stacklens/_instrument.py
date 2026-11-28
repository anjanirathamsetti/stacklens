"""Function wrapping: each call made inside a trace becomes a child span of whatever span is executing.
Calls outside a trace pass straight through."""

from __future__ import annotations

import functools
import inspect
import re
import sys
import types
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Tuple, TypeVar, Union

from ._context import TraceContext, current
from ._options import PatternLike
from ._tracer import SpanInit, tracer

F = TypeVar("F", bound=Callable[..., Any])
KindLike = Optional[str]

_WRAPPED_ATTR = "__stacklens_wrapped__"
_PATCHED_CLASSES: "set[int]" = set()

_KIND_RULES: List[Tuple["re.Pattern[str]", str]] = [
    (re.compile(r"(Controller|View|ViewSet|Resource|Router|Endpoint)$"), "controller"),
    (re.compile(r"controller$|(^|[._])(views?|routes?|routers?|endpoints?|api|resources?)$", re.I), "controller"),
    (re.compile(r"(handler|resolver|gateway|consumer|processor|listener|tasks?|jobs?|workers?)$", re.I), "handler"),
    (re.compile(r"(repository|repositories|repo|dao|model|models|crud|queries|store)$", re.I), "repository"),
    (re.compile(r"(service|services|manager|provider|facade|usecase|use_cases?|helper|helpers|client|clients|gateway)$", re.I), "service"),
]


def kind_from_name(name: Optional[str], fallback: str = "function") -> str:
    """Span kind from a class or module name: ``*Controller``/``views`` → controller, ``*Service`` → service…"""
    if not name:
        return fallback
    for rx, kind in _KIND_RULES:
        if rx.search(name):
            return kind
    return fallback


def is_wrapped(fn: Any) -> bool:
    return getattr(fn, _WRAPPED_ATTR, False) is True


class ParamInfo:
    """Declared parameters of a function: positional names (``self``/``cls`` included), the ``*args`` name,
    whether the first parameter is ``self``/``cls`` (not recorded), and every name in declaration order."""

    __slots__ = ("names", "varargs", "skip_first", "order")

    def __init__(self, names: List[str], varargs: Optional[str], skip_first: bool, order: Dict[str, int]):
        self.names = names
        self.varargs = varargs
        self.skip_first = skip_first
        self.order = order


def _param_names(fn: Callable[..., Any]) -> ParamInfo:
    code = getattr(inspect.unwrap(fn), "__code__", None)
    if code is not None:
        n = code.co_argcount
        names = list(code.co_varnames[:n])
        declared = list(code.co_varnames[: n + code.co_kwonlyargcount])
        varargs = code.co_varnames[n + code.co_kwonlyargcount] if code.co_flags & inspect.CO_VARARGS else None
    else:
        try:
            sig = inspect.signature(fn)
        except (TypeError, ValueError):
            return ParamInfo([], "args", False, {})
        params = list(sig.parameters.values())
        names = [p.name for p in params if p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD)]
        declared = [p.name for p in params if p.kind != p.VAR_POSITIONAL and p.kind != p.VAR_KEYWORD]
        varargs = next((p.name for p in params if p.kind == p.VAR_POSITIONAL), None)
    return ParamInfo(names, varargs, bool(names) and names[0] in ("self", "cls"), {k: i for i, k in enumerate(declared)})


def _bind(info: ParamInfo, args: Tuple[Any, ...], kwargs: Dict[str, Any], skip_first: Optional[bool] = None) -> Tuple[List[str], List[Any]]:
    """Recorded ``params`` and values for one call: positionals by name, extra positionals as ``*args[i]``,
    then keyword arguments in declaration order (frameworks like FastAPI pass everything by keyword)."""
    names = info.names
    skip = info.skip_first if skip_first is None else skip_first
    start = 1 if skip and args else 0
    params: List[str] = []
    values: List[Any] = []
    for i in range(start, len(args)):
        if i < len(names):
            params.append(names[i])
        else:
            params.append(f"*{info.varargs or 'args'}[{i - len(names)}]")
        values.append(args[i])
    if kwargs:
        big = len(info.order) + 1
        for k in sorted(kwargs, key=lambda key: info.order.get(key, big)):
            params.append(k)
            values.append(kwargs[k])
    return params, values


class _Meta:
    """How a wrapped function names its spans. ``class_name`` may be resolved at call time from ``self``."""

    __slots__ = ("class_name", "method", "kind", "dynamic_class", "owner")

    def __init__(self, method: str, class_name: Optional[str] = None, kind: KindLike = None, dynamic_class: bool = False, owner: Optional[type] = None):
        self.method = method
        self.class_name = class_name
        self.kind = kind
        self.dynamic_class = dynamic_class
        self.owner = owner

    def resolve(self, args: Tuple[Any, ...]) -> Tuple[Optional[str], str]:
        cls_name = self.class_name
        if self.dynamic_class and args and self.owner is not None:
            first = args[0]
            try:
                if isinstance(first, type) and issubclass(first, self.owner):
                    cls_name = first.__name__
                elif isinstance(first, self.owner):
                    cls_name = type(first).__name__
            except Exception:
                pass
        kind = self.kind or kind_from_name(cls_name, "service" if cls_name else "function")
        return cls_name, kind


def _begin(ctx: TraceContext, meta: _Meta, params_info: ParamInfo, args: Tuple[Any, ...], kwargs: Dict[str, Any]):
    cls_name, kind = meta.resolve(args)
    params, values = _bind(params_info, args, kwargs)
    name = f"{cls_name}.{meta.method}" if cls_name else meta.method
    call = tracer.begin_call(ctx.trace, ctx.span_id, SpanInit(name, meta.method, kind, params, cls_name))
    return call, values


def wrap_function(fn: F, method: Optional[str] = None, class_name: Optional[str] = None, kind: KindLike = None, *, dynamic_class: bool = False, owner: Optional[type] = None) -> F:
    """Wrap one function (sync, async, generator or async generator) so its calls are traced."""
    if not callable(fn) or is_wrapped(fn) or isinstance(fn, type):
        return fn
    meta = _Meta(method or getattr(fn, "__name__", "anonymous"), class_name, kind, dynamic_class, owner)
    params_info_cache: List[Any] = []

    def params_info():
        if not params_info_cache:
            try:
                params_info_cache.append(_param_names(fn))
            except Exception:
                params_info_cache.append(ParamInfo([], "args", False, {}))
        return params_info_cache[0]

    if inspect.iscoroutinefunction(fn):

        @functools.wraps(fn)
        async def async_traced(*args: Any, **kwargs: Any) -> Any:
            ctx = current.get()
            if ctx is None or ctx.trace.finished or not tracer.opts.enabled:
                return await fn(*args, **kwargs)
            try:
                call, values = _begin(ctx, meta, params_info(), args, kwargs)
            except Exception:
                return await fn(*args, **kwargs)
            if call.mode == "dropped":
                return await fn(*args, **kwargs)
            span = call.span
            token = current.set(TraceContext(ctx.trace, span["id"]))
            if call.mode == "collapsed":
                try:
                    result = await fn(*args, **kwargs)
                except BaseException as e:
                    current.reset(token)
                    _safe(tracer.end_collapsed, ctx.trace, call, values, True, e)
                    raise
                current.reset(token)
                _safe(tracer.end_collapsed, ctx.trace, call, values, True, None)
                return result
            span["async"] = True
            _safe(tracer.capture_args, ctx.trace, span, values)
            try:
                result = await fn(*args, **kwargs)
            except BaseException as e:
                current.reset(token)
                _safe(tracer.end_span, ctx.trace, span, None, e)
                raise
            current.reset(token)
            _safe(tracer.end_span, ctx.trace, span, result)
            return result

        traced: Callable[..., Any] = async_traced
    elif inspect.isgeneratorfunction(fn) or inspect.isasyncgenfunction(fn):
        # generators: the span covers creating the generator; values it yields are not captured
        is_async_gen = inspect.isasyncgenfunction(fn)

        @functools.wraps(fn)
        def gen_traced(*args: Any, **kwargs: Any) -> Any:
            ctx = current.get()
            if ctx is None or ctx.trace.finished or not tracer.opts.enabled:
                return fn(*args, **kwargs)
            try:
                call, values = _begin(ctx, meta, params_info(), args, kwargs)
            except Exception:
                return fn(*args, **kwargs)
            if call.mode == "dropped":
                return fn(*args, **kwargs)
            if call.mode == "collapsed":
                result = fn(*args, **kwargs)
                _safe(tracer.end_collapsed, ctx.trace, call, values, is_async_gen, None)
                return result
            span = call.span
            span["async"] = is_async_gen
            _safe(tracer.capture_args, ctx.trace, span, values)
            result = fn(*args, **kwargs)
            _safe(tracer.end_span, ctx.trace, span, result)
            return result

        traced = gen_traced
    else:

        @functools.wraps(fn)
        def sync_traced(*args: Any, **kwargs: Any) -> Any:
            ctx = current.get()
            if ctx is None or ctx.trace.finished or not tracer.opts.enabled:
                return fn(*args, **kwargs)
            try:
                call, values = _begin(ctx, meta, params_info(), args, kwargs)
            except Exception:
                return fn(*args, **kwargs)
            if call.mode == "dropped":
                return fn(*args, **kwargs)
            span = call.span
            token = current.set(TraceContext(ctx.trace, span["id"]))
            if call.mode == "collapsed":
                # folded into the aggregate: timing only, no value capture (the expensive part)
                try:
                    result = fn(*args, **kwargs)
                except BaseException as e:
                    current.reset(token)
                    _safe(tracer.end_collapsed, ctx.trace, call, values, False, e)
                    raise
                current.reset(token)
                _safe(tracer.end_collapsed, ctx.trace, call, values, _is_awaitable(result), None)
                return result
            _safe(tracer.capture_args, ctx.trace, span, values)
            try:
                result = fn(*args, **kwargs)
            except BaseException as e:
                current.reset(token)
                _safe(tracer.end_span, ctx.trace, span, None, e)
                raise
            current.reset(token)
            if _is_awaitable(result):
                # a sync function returning an awaitable (e.g. a wrapped coroutine factory)
                span["async"] = True
            _safe(tracer.end_span, ctx.trace, span, result)
            return result

        traced = sync_traced

    setattr(traced, _WRAPPED_ATTR, True)
    return traced  # type: ignore[return-value]


def _is_awaitable(v: Any) -> bool:
    return inspect.isawaitable(v) and not isinstance(v, type)


def _safe(fn: Callable[..., Any], *args: Any) -> None:
    """Tracer bookkeeping must never raise into the application."""
    try:
        fn(*args)
    except Exception:
        pass


def unwrap(fn: F) -> F:
    while is_wrapped(fn) and hasattr(fn, "__wrapped__"):
        fn = fn.__wrapped__  # type: ignore[assignment]
    return fn


# ---------------------------------------------------------------------------- classes and modules

_SKIP = frozenset({"__init__", "__new__", "__repr__", "__str__", "__eq__", "__hash__", "__del__", "__getattr__", "__getattribute__", "__setattr__", "__init_subclass__", "__class_getitem__"})


def _matches(patterns: Optional[Sequence[PatternLike]], name: str) -> bool:
    if not patterns:
        return False
    for p in patterns:
        if isinstance(p, str):
            if p == name:
                return True
        elif p.search(name):
            return True
    return False


def _should_wrap(name: str, include: Optional[Sequence[PatternLike]], exclude: Optional[Sequence[PatternLike]]) -> bool:
    if name in _SKIP or (name.startswith("__") and name.endswith("__") and name != "__call__"):
        return False
    if tracer.is_ignored_method(name):
        return False
    if include is not None and not _matches(include, name):
        return False
    if _matches(exclude, name):
        return False
    return True


def instrument_class(cls: type, *, name: Optional[str] = None, kind: KindLike = None, include: Optional[Sequence[PatternLike]] = None, exclude: Optional[Sequence[PatternLike]] = None, inherited: bool = True) -> type:
    """Trace every method of a class (instance, class and static methods), so all instances are traced.

    Methods inherited from base classes defined in the same top-level package are traced too (shown under
    the runtime class name, e.g. ``UserRepository.find`` for ``BaseRepository.find``)."""
    if not isinstance(cls, type):
        return cls
    top = (cls.__module__ or "").split(".")[0]
    targets = [cls]
    if inherited:
        for base in cls.__mro__[1:]:
            if base is object or (base.__module__ or "").split(".")[0] != top or base.__module__ in ("builtins", "abc", "typing"):
                continue
            targets.append(base)
    for target in targets:
        key = id(target)
        if key in _PATCHED_CLASSES and target is not cls:
            continue
        _PATCHED_CLASSES.add(key)
        label = name if (name and target is cls) else None
        for attr, raw in list(vars(target).items()):
            if not _should_wrap(attr, include, exclude):
                continue
            try:
                if isinstance(raw, staticmethod):
                    fn = raw.__func__
                    if is_wrapped(fn):
                        continue
                    setattr(target, attr, staticmethod(wrap_function(fn, attr, label or target.__name__, kind or kind_from_name(label or target.__name__, "service"))))
                elif isinstance(raw, classmethod):
                    fn = raw.__func__
                    if is_wrapped(fn):
                        continue
                    setattr(target, attr, classmethod(wrap_function(fn, attr, label or target.__name__, kind, dynamic_class=label is None, owner=target)))
                elif isinstance(raw, (types.FunctionType,)):
                    if is_wrapped(raw):
                        continue
                    setattr(target, attr, wrap_function(raw, attr, label or target.__name__, kind, dynamic_class=label is None, owner=target))
            except (AttributeError, TypeError):
                continue  # read-only / slotted
    return cls


def instrument_module(module: Union[types.ModuleType, str], *, name: Optional[str] = None, kind: KindLike = None, include: Optional[Sequence[PatternLike]] = None, exclude: Optional[Sequence[PatternLike]] = None) -> types.ModuleType:
    """Trace the functions and classes defined in a module (not ones it imported).

    Functions are named ``<module>.<function>`` using the last part of the module name, e.g.
    ``orders.create_order``; their kind is inferred from the module name (``order_service`` → service)."""
    mod = sys.modules[module] if isinstance(module, str) else module
    label = name or mod.__name__.rsplit(".", 1)[-1]
    mod_kind = kind or kind_from_name(label, "function")
    for attr, value in list(vars(mod).items()):
        if attr.startswith("__") or not _should_wrap(attr, include, exclude):
            continue
        if getattr(value, "__module__", None) != mod.__name__:
            continue
        if isinstance(value, type):
            instrument_class(value, kind=kind)
        elif isinstance(value, types.FunctionType) and not is_wrapped(value):
            setattr(mod, attr, wrap_function(value, attr, label, mod_kind))
    return mod


def _owner_from_qualname(fn: Callable[..., Any]) -> Optional[str]:
    qual = getattr(fn, "__qualname__", "") or ""
    parts = qual.split(".")
    # "Outer.method" → Outer; "func.<locals>.inner" is a local function, not a method
    return parts[-2] if len(parts) >= 2 and parts[-2] != "<locals>" else None


def traced(_fn: Any = None, *, name: Optional[str] = None, kind: KindLike = None, include: Optional[Sequence[PatternLike]] = None, exclude: Optional[Sequence[PatternLike]] = None) -> Any:
    """Decorator. On a function or method, trace that function; on a class, trace all its methods.

    ``@traced``, ``@traced()``, ``@traced(name="OrderService.place", kind="service")``. Without a name,
    methods are named ``Class.method`` and module-level functions ``<module>.<function>``."""

    def decorate(target: Any) -> Any:
        if isinstance(target, type):
            return instrument_class(target, name=name, kind=kind, include=include, exclude=exclude)
        if isinstance(target, (staticmethod, classmethod)):
            return type(target)(decorate(target.__func__))
        if not callable(target):
            return target
        if name:
            cls_name, _, method = name.rpartition(".")
            cls_name = cls_name or None
        else:
            method = getattr(target, "__name__", "anonymous")
            cls_name = _owner_from_qualname(target)
            if cls_name is None:
                mod = getattr(target, "__module__", None) or ""
                cls_name = mod.rsplit(".", 1)[-1] if mod and mod != "__main__" else None
        k = kind or kind_from_name(cls_name, "function")
        return wrap_function(target, method, cls_name, k)

    if _fn is not None and (callable(_fn) or isinstance(_fn, (staticmethod, classmethod))):
        return decorate(_fn)
    return decorate


def instrument(target: Any, **options: Any) -> Any:
    """Instrument a class, a module, or an object's class."""
    if isinstance(target, type):
        return instrument_class(target, **options)
    if isinstance(target, types.ModuleType):
        return instrument_module(target, **options)
    if callable(target) and not hasattr(target, "__dict__"):
        return target
    instrument_class(type(target), **options)
    return target


def wrap(fn: F, name: Optional[str] = None, kind: KindLike = None) -> F:
    """Wrap a single function. ``name`` may be ``"Class.method"``."""
    if name and "." in name:
        cls_name, _, method = name.rpartition(".")
    else:
        cls_name, method = None, name or getattr(fn, "__name__", "anonymous")
    return wrap_function(fn, method, cls_name, kind or kind_from_name(cls_name))


def iter_wrapped(items: Iterable[Any]) -> List[Any]:  # pragma: no cover - debugging helper
    return [i for i in items if is_wrapped(i)]
