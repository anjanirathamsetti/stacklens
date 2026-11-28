"""FastAPI / Starlette: the ASGI middleware plus a span per route handler.

.. code-block:: python

    import stacklens
    from stacklens.integrations.fastapi import instrument_fastapi

    stacklens.init(application="orders-api")
    app = FastAPI()
    ...
    instrument_fastapi(app)

Route handlers become ``controller`` spans named ``<module>.<function>`` (e.g. ``orders.get_order``) with
their resolved parameters (path, query, body models, dependencies) as arguments and the returned value as
the result. Routes added after this call (``include_router`` later) are picked up on the first request."""

from __future__ import annotations

import copy
from typing import Any, Dict, List, Optional, Tuple

from .._context import current
from .._instrument import is_wrapped, wrap_function
from .asgi import StackLensASGIMiddleware

_patched = {"done": False}
_proxies: Dict[int, Tuple[Any, Any]] = {}


def _label(fn: Any) -> Optional[str]:
    qual = getattr(fn, "__qualname__", "") or ""
    parts = qual.split(".")
    if len(parts) >= 2 and parts[-2] != "<locals>":
        return parts[-2]
    mod = getattr(fn, "__module__", "") or ""
    return mod.rsplit(".", 1)[-1] if mod and mod != "__main__" else "app"


def _framework_internal(fn: Any) -> bool:
    mod = getattr(fn, "__module__", "") or ""
    return mod.startswith(("fastapi.", "starlette."))


def patch_fastapi_endpoints() -> bool:
    """Trace FastAPI route handlers where FastAPI calls them (``fastapi.routing.run_endpoint_function``), so it
    works for routes on the app, on included routers, and routes added at any time."""
    if _patched["done"]:
        return True
    try:
        import fastapi.routing as fr
    except ImportError:
        return False
    original = getattr(fr, "run_endpoint_function", None)
    if original is None:
        return False

    def proxy_for(dependant: Any) -> Any:
        entry = _proxies.get(id(dependant))
        if entry is not None and entry[0] is dependant:
            return entry[1]
        call = getattr(dependant, "call", None)
        proxy = dependant
        if call is not None and not is_wrapped(call) and not _framework_internal(call) and getattr(call, "__name__", None):
            try:
                proxy = copy.copy(dependant)
                proxy.call = wrap_function(call, call.__name__, _label(call), "controller")
            except Exception:
                proxy = dependant
        _proxies[id(dependant)] = (dependant, proxy)
        return proxy

    async def run_endpoint_function(*, dependant: Any, values: Dict[str, Any], is_coroutine: bool, **kwargs: Any) -> Any:
        if current.get() is not None:
            try:
                dependant = proxy_for(dependant)
            except Exception:
                pass
        return await original(dependant=dependant, values=values, is_coroutine=is_coroutine, **kwargs)

    run_endpoint_function.__wrapped__ = original  # type: ignore[attr-defined]
    fr.run_endpoint_function = run_endpoint_function
    _patched["done"] = True
    return True


def wrap_routes(app: Any) -> int:
    """Wrap plain Starlette route endpoints (FastAPI routes are traced by :func:`patch_fastapi_endpoints`)."""
    count = 0
    for route in list(getattr(app, "routes", []) or []):
        endpoint = getattr(route, "endpoint", None)
        if endpoint is None or is_wrapped(endpoint) or isinstance(endpoint, type) or _framework_internal(endpoint):
            continue
        if getattr(route, "dependant", None) is not None and _patched["done"]:
            continue
        name = getattr(endpoint, "__name__", None)
        if not name or name.startswith("<"):
            continue
        wrapped = wrap_function(endpoint, name, _label(endpoint), "controller")
        try:
            dependant = getattr(route, "dependant", None)
            if dependant is not None:  # FastAPI APIRoute: the handler calls dependant.call
                dependant.call = wrapped
                route.endpoint = wrapped
                try:
                    from fastapi.routing import request_response

                    route.app = request_response(route.get_route_handler())
                except Exception:
                    pass
            elif hasattr(route, "app") and getattr(route, "endpoint", None) is endpoint:
                # Starlette Route: rebuild its ASGI app around the wrapped function
                from starlette.routing import Route, request_response as sl_request_response

                if isinstance(route, Route) and not getattr(route, "_stacklens_skip", False):
                    import inspect

                    if inspect.isfunction(endpoint) or inspect.ismethod(endpoint):
                        route.endpoint = wrapped
                        route.app = sl_request_response(wrapped)
                    else:
                        continue
            else:
                continue
            count += 1
        except Exception:
            continue
    return count


def instrument_fastapi(app: Any, *, wrap_endpoints: bool = True, capture_request: bool = True, capture_response: bool = True, headers: Optional[List[str]] = None) -> Any:
    """Add the StackLens middleware to a FastAPI or Starlette app and trace its route handlers."""
    if getattr(app, "_stacklens_instrumented", False):
        return app
    app._stacklens_instrumented = True
    state = {"checked": False}

    def on_request(scope: Any) -> None:
        if wrap_endpoints and not state["checked"]:
            state["checked"] = True
            wrap_routes(app)

    if wrap_endpoints:
        patch_fastapi_endpoints()
        wrap_routes(app)
    app.add_middleware(StackLensASGIMiddleware, capture_request=capture_request, capture_response=capture_response, headers=headers, on_request=on_request)
    return app


instrument_starlette = instrument_fastapi
