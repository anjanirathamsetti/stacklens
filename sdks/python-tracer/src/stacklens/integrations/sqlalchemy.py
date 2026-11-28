"""SQLAlchemy (1.4 / 2.x, Core and ORM, sync and asyncio): one ``SQL.query`` span (kind ``db``) per statement.

.. code-block:: python

    from stacklens.integrations.sqlalchemy import instrument_sqlalchemy
    instrument_sqlalchemy()            # every engine
    instrument_sqlalchemy(engine)      # or one engine (an AsyncEngine works too)

The span's arguments are the SQL as sent to the driver and its parameters; the result is the row count
when the driver reports one. Statements in a loop (N+1 queries) are folded like any repeated call."""

from __future__ import annotations

from typing import Any, Optional

from .sql import begin_sql, end_sql, sql_span

_KEY = "_stacklens_sql"
_installed = {"global": False}
_engines: "set[int]" = set()


def _dialect(conn: Any) -> Optional[str]:
    try:
        return conn.dialect.name
    except Exception:
        return None


def _before(conn: Any, cursor: Any, statement: str, parameters: Any, context: Any, executemany: bool) -> None:
    from .._context import current

    if current.get() is None:
        return
    s = sql_span(statement, parameters, many=executemany, dialect=_dialect(conn))
    try:
        begin_sql(s)
    except Exception:
        return
    if s.call is None:
        return
    try:
        setattr(context, _KEY, s)
    except Exception:
        conn.info.setdefault(_KEY, []).append(s)


def _pop(conn: Any, context: Any) -> Optional[sql_span]:
    s = getattr(context, _KEY, None) if context is not None else None
    if s is not None:
        try:
            delattr(context, _KEY)
        except Exception:
            pass
        return s
    stack = conn.info.get(_KEY) if conn is not None else None
    return stack.pop() if stack else None


def _after(conn: Any, cursor: Any, statement: str, parameters: Any, context: Any, executemany: bool) -> None:
    s = _pop(conn, context)
    if s is None:
        return
    try:
        rc = getattr(cursor, "rowcount", -1)
        if isinstance(rc, int) and rc >= 0:
            s.rec.result = {"rowCount": rc}
    except Exception:
        pass
    try:
        end_sql(s, None)
    except Exception:
        pass


def _error(exception_context: Any) -> None:
    try:
        s = _pop(getattr(exception_context, "connection", None), getattr(exception_context, "execution_context", None))
        if s is not None:
            end_sql(s, exception_context.original_exception)
    except Exception:
        pass


def instrument_sqlalchemy(engine: Any = None) -> None:
    """Record SQL for one engine, or for every engine when called without arguments. Idempotent."""
    from sqlalchemy import event
    from sqlalchemy.engine import Engine

    if engine is None:
        if _installed["global"]:
            return
        _installed["global"] = True
        target: Any = Engine
    else:
        target = getattr(engine, "sync_engine", engine)  # AsyncEngine
        if _installed["global"] or id(target) in _engines:
            return
        _engines.add(id(target))
    event.listen(target, "before_cursor_execute", _before)
    event.listen(target, "after_cursor_execute", _after)
    event.listen(target, "handle_error", _error)
