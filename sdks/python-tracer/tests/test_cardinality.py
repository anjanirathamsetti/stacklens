import pytest

import stacklens
from conftest import assert_valid_trace, configure, span, spans_by_name


class Helper:
    def step(self, i):
        if i in (500, 600, 700, 800, 900):
            raise ValueError(f"bad item {i}")
        return i * 2

    def lookup(self, i):
        return i


class Batch:
    def __init__(self):
        self.h = Helper()

    def run(self, n):
        total = 0
        for i in range(n):
            try:
                total += self.h.step(i)
            except ValueError:
                pass
        return total

    def nested(self):
        for i in range(30):
            self.inner(i)

    def inner(self, i):
        return self.h.lookup(i)


stacklens.instrument_class(Helper)
stacklens.instrument_class(Batch)


def test_repeated_calls_are_collapsed(captured):
    with stacklens.trace("job"):
        Batch().run(1000)
    t = captured.one()
    assert_valid_trace(t)
    steps = spans_by_name(t, "Helper.step")
    individual = [s for s in steps if "collapsed" not in s]
    agg = next(s for s in steps if "collapsed" in s)
    assert len(t["spans"]) < 50
    # 10 recorded individually, 3 failing collapsed calls kept as real spans (with args), the rest counted
    assert len([s for s in individual if s["status"] == "ok"]) == 10
    kept_errors = [s for s in individual if s["status"] == "error"]
    assert [s["args"] for s in kept_errors] == [[500], [600], [700]]
    c = agg["collapsed"]
    assert len(individual) + c["count"] == 1000
    assert c["errors"] == 2
    assert 0 <= c["minDuration"] <= c["maxDuration"] <= c["totalDuration"]
    assert "args" not in agg


def test_children_of_collapsed_calls_collapse_under_the_aggregate(captured):
    with stacklens.trace("job"):
        Batch().nested()
    t = captured.one()
    agg = next(s for s in spans_by_name(t, "Batch.inner") if "collapsed" in s)
    under = [s for s in spans_by_name(t, "Helper.lookup") if s["parentId"] == agg["id"]]
    assert len([s for s in under if "collapsed" not in s]) == 10 and agg["collapsed"]["count"] == 20
    assert next(s for s in under if "collapsed" in s)["collapsed"]["count"] == 10


def test_collapsing_can_be_disabled():
    cap = configure(max_repeated_calls=0)
    with stacklens.trace("job"):
        Batch().nested()
    assert len(spans_by_name(cap.one(), "Batch.inner")) == 30


def test_max_spans_per_trace_truncates():
    cap = configure(max_spans_per_trace=5, max_repeated_calls=0)
    with stacklens.trace("job"):
        Batch().nested()
    t = cap.one()
    assert len(t["spans"]) == 5 and t["truncated"] is True and t["droppedSpans"] > 0
    assert_valid_trace(t)


def test_max_capture_bytes_drops_values_but_keeps_timing():
    cap = configure(max_capture_bytes=200, max_repeated_calls=0)

    @stacklens.traced
    def echo(payload):
        return payload

    with stacklens.trace("job"):
        for _ in range(5):
            echo("x" * 100)
    t = cap.one()
    calls = spans_by_name(t, "test_cardinality.echo")
    assert "args" in calls[0]
    assert calls[-1].get("valuesDropped") is True and "args" not in calls[-1] and calls[-1]["duration"] >= 0
    assert t["valuesTruncated"] is True


def test_max_logs_per_span():
    cap = configure(max_logs_per_span=3)

    @stacklens.traced
    def noisy():
        for i in range(10):
            stacklens.log(f"line {i}")

    with stacklens.trace("job"):
        noisy()
    s = span(cap.one(), "test_cardinality.noisy")
    assert len(s["logs"]) == 3 and s["droppedLogs"] == 7


def test_spans_after_export_are_ignored(captured):
    import threading

    leaked = threading.Event()

    @stacklens.traced
    def late():
        return 1

    with stacklens.trace("job"):
        ctx = stacklens._context.current.get()
    stacklens.flush()
    token = stacklens._context.current.set(ctx)
    try:
        late()
        leaked.set()
    finally:
        stacklens._context.current.reset(token)
    t = captured.one()
    assert leaked.is_set() and not spans_by_name(t, "test_cardinality.late")


@pytest.mark.parametrize("n", [1, 10, 11])
def test_boundary_of_repeat_limit(captured, n):
    @stacklens.traced
    def f(i):
        return i

    with stacklens.trace("job"):
        for i in range(n):
            f(i)
    t = captured.one()
    spans = spans_by_name(t, "test_cardinality.f")
    assert sum(s.get("collapsed", {}).get("count", 1) for s in spans) == n
    assert any("collapsed" in s for s in spans) == (n > 10)
