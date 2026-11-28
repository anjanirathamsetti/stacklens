"""SQL spans shared by the database integrations: ``SQL.query`` (kind ``db``) with the statement as the first
argument and its parameters as the second, the same shape as the Node SDK's TypeORM spans, so the UI's SQL
view, N+1 detection and loop collapsing work the same for every language."""

from __future__ import annotations

from typing import Any, Optional

from .._context import current
from .._tracer import SpanInit, tracer

SQL_PARAMS = ["query", "parameters"]


class _SqlRecord:
    __slots__ = ("result",)

    def __init__(self) -> None:
        self.result: Any = None


class sql_span:
    """``with sql_span(statement, params) as rec: ...; rec.result = {...}``. No-op outside a trace."""

    __slots__ = ("sql", "params", "many", "dialect", "ctx", "call", "values", "rec")

    def __init__(self, sql: Any, params: Any = None, *, many: bool = False, dialect: Optional[str] = None):
        self.sql = sql if isinstance(sql, str) else str(sql)
        self.params = params
        self.many = many
        self.dialect = dialect
        self.ctx: Any = None
        self.call: Any = None
        self.values: Any = None
        self.rec = _SqlRecord()

    def __enter__(self) -> _SqlRecord:
        try:
            begin_sql(self)
        except Exception:
            self.call = None
        return self.rec

    def __exit__(self, exc_type: Any, exc: Optional[BaseException], tb: Any) -> None:
        try:
            end_sql(self, exc)
        except Exception:
            pass


def begin_sql(s: sql_span) -> None:
    ctx = current.get()
    if ctx is None or ctx.trace.finished or not tracer.opts.enabled:
        return
    s.ctx = ctx
    s.call = tracer.begin_call(ctx.trace, ctx.span_id, SpanInit("SQL.query", "query", "db", list(SQL_PARAMS), "SQL"))
    params = s.params
    if s.many and isinstance(params, (list, tuple)) and len(params) > 3:
        params = {"batches": len(params), "first": params[:3]}
    s.values = [s.sql, params] if params not in (None, (), [], {}) else [s.sql]
    if s.call.mode == "span":
        tracer.capture_args(ctx.trace, s.call.span, s.values)
        if s.dialect:
            s.call.span["attributes"] = {"db.system": s.dialect}


def end_sql(s: sql_span, error: Optional[BaseException]) -> None:
    call = s.call
    if call is None or call.mode == "dropped":
        return
    if call.mode == "collapsed":
        tracer.end_collapsed(s.ctx.trace, call, s.values, False, error)
        return
    tracer.end_span(s.ctx.trace, call.span, s.rec.result, error, has_result=s.rec.result is not None)
