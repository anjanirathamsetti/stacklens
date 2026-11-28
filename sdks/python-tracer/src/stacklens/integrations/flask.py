"""Flask: the WSGI middleware plus route templates, request/response bodies, the user and a span per view.

.. code-block:: python

    import stacklens
    from stacklens.integrations.flask import instrument_flask

    stacklens.init(application="inventory-api")
    app = Flask(__name__)
    instrument_flask(app)

View functions become ``controller`` spans named ``<blueprint or module>.<function>``. The exception behind
a 500 (handled by Flask) is recorded on the request's root span."""

from __future__ import annotations

from typing import Any, List, Optional

from .._context import current
from .._instrument import is_wrapped, wrap_function
from .._tracer import tracer
from .http import MAX_BODY_BYTES, body_value
from .wsgi import ENV_TRACE, StackLensMiddleware


def _wrap_views(app: Any) -> None:
    for endpoint, fn in list(app.view_functions.items()):
        if is_wrapped(fn) or not callable(fn):
            continue
        view_class = getattr(fn, "view_class", None)
        if view_class is not None:  # MethodView: trace its get/post/… methods instead
            from .._instrument import instrument_class

            instrument_class(view_class, kind="controller")
            continue
        blueprint, _, _ = endpoint.rpartition(".")
        mod = getattr(fn, "__module__", "") or ""
        label = blueprint or (mod.rsplit(".", 1)[-1] if mod and mod != "__main__" else "app")
        app.view_functions[endpoint] = wrap_function(fn, getattr(fn, "__name__", endpoint), label, "controller")


class _UserShim:
    def __init__(self, user: Any):
        self.state = self
        self.user = user
        self.headers: dict = {}


def _flask_user(flask: Any) -> Any:
    """``g.user`` (any object/dict with an id) or flask-login's ``current_user``."""
    from .._options import default_get_user_id

    try:
        user = flask.g.get("user")
        if user is not None:
            uid = default_get_user_id(_UserShim(user))
            if uid is not None:
                return uid
    except Exception:
        pass
    try:
        from flask_login import current_user  # type: ignore

        if getattr(current_user, "is_authenticated", False):
            return current_user.get_id()
    except Exception:
        pass
    return None


def instrument_flask(app: Any, *, wrap_views: bool = True, capture_request: bool = True, capture_response: bool = True, headers: Optional[List[str]] = None) -> Any:
    """Instrument a Flask app (call after registering routes and blueprints; later ones are picked up on the first request)."""
    import flask
    from flask import got_request_exception

    if getattr(app, "_stacklens_instrumented", False):
        return app
    app._stacklens_instrumented = True
    app.wsgi_app = StackLensMiddleware(app.wsgi_app, capture_request=capture_request, capture_response=capture_response, headers=headers)
    if wrap_views:
        _wrap_views(app)

    @app.before_request
    def _stacklens_before() -> None:
        try:
            env = flask.request.environ
            if ENV_TRACE not in env:
                return
            if wrap_views:
                _wrap_views(app)
            rule = flask.request.url_rule
            if rule is not None:
                env["stacklens.route"] = rule.rule
            if flask.request.view_args:
                env["stacklens.path_params"] = dict(flask.request.view_args)
            if capture_request and (flask.request.content_length or 0) <= MAX_BODY_BYTES:
                if flask.request.is_json:
                    env["stacklens.request_body"] = flask.request.get_json(silent=True)
                elif flask.request.form:
                    env["stacklens.request_body"] = flask.request.form.to_dict()
        except Exception:
            pass

    @app.after_request
    def _stacklens_after(response: Any) -> Any:
        try:
            env = flask.request.environ
            if ENV_TRACE not in env:
                return response
            if capture_response and not response.is_streamed and (response.content_length or 0) <= MAX_BODY_BYTES:
                ctype = response.headers.get("content-type")
                env["stacklens.response_body"] = body_value(response.get_data(), ctype)
            ctx = current.get()
            if ctx is not None and not ctx.trace.record.get("userId"):
                from .._options import default_get_user_id

                custom = tracer.opts.get_user_id is not default_get_user_id
                uid = None if custom else _flask_user(flask)
                if uid is None:
                    try:
                        uid = tracer.opts.get_user_id(flask.request)
                    except Exception:
                        uid = None
                if uid is not None:
                    env["stacklens.user_id"] = uid
        except Exception:
            pass
        return response

    def _on_exception(sender: Any, exception: BaseException, **extra: Any) -> None:
        try:
            flask.request.environ["stacklens.error"] = exception
        except Exception:
            pass

    got_request_exception.connect(_on_exception, app, weak=False)
    return app
