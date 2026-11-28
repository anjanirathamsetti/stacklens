import logging
import types

import pytest

import stacklens
from conftest import assert_valid_trace, configure, parent_of, span


class OrderRepository:
    def save(self, order):
        return {"id": 1, **order}

    @staticmethod
    def table():
        return "orders"

    @classmethod
    def create(cls):
        return cls()


class OrderService:
    def __init__(self):
        self.repo = OrderRepository()

    def place(self, order, *, notify=True):
        self.repo.table()
        return self.repo.save({**order, "status": "placed"})


class OrderController:
    def create(self, body):
        return OrderService().place(body, notify=False)


for cls in (OrderRepository, OrderService, OrderController):
    stacklens.instrument_class(cls)


def test_nested_calls_kinds_args_results(captured):
    with stacklens.trace("job"):
        OrderController().create({"sku": "A-1"})
    t = captured.one()
    assert_valid_trace(t)
    c, s, r = span(t, "OrderController.create"), span(t, "OrderService.place"), span(t, "OrderRepository.save")
    assert (c["kind"], s["kind"], r["kind"]) == ("controller", "service", "repository")
    assert parent_of(t, s) is c and parent_of(t, r) is s
    assert s["params"] == ["order", "notify"] and s["args"] == [{"sku": "A-1"}, False]
    assert r["result"] == {"id": 1, "sku": "A-1", "status": "placed"}
    assert r["resultType"] == "{ id: int; sku: str; status: str }"
    assert span(t, "OrderRepository.table")["result"] == "orders"
    assert t["kind"] == "job" and t["spans"][0]["kind"] == "job" and t["status"] == "ok"
    assert t["application"] == "test-app" and t["project"] == "tests" and t["environment"] == "test"
    assert len(t["id"]) == 32 and len(t["spans"][0]["id"]) == 16


def test_classmethod_named_after_runtime_class(captured):
    class Base:
        def find(self, id):
            return id

    class UserRepository(Base):
        pass

    stacklens.instrument_class(Base)
    with stacklens.trace("job"):
        UserRepository().find(3)
        OrderRepository.create()
    t = captured.one()
    assert span(t, "UserRepository.find")["kind"] == "repository"
    assert span(t, "OrderRepository.create")


class PaymentError(Exception):
    status_code = 402


class PaymentService:
    def charge(self, amount):
        self._validate(amount)

    def _validate(self, amount):
        raise PaymentError("card declined")


stacklens.instrument_class(PaymentService)


def test_errors_with_python_traceback_and_status(captured):
    with pytest.raises(PaymentError):
        with stacklens.trace("job"):
            PaymentService().charge(42)
    t = captured.one()
    assert t["status"] == "error"
    s = span(t, "PaymentService._validate")
    assert s["status"] == "error"
    err = s["error"]
    assert err["name"] == "PaymentError" and err["message"] == "card declined" and err["status"] == 402
    assert err["stack"].startswith("Traceback (most recent call last):")
    assert 'raise PaymentError("card declined")' in err["stack"]
    assert "stacklens/_instrument.py" not in err["stack"]  # tracer frames removed
    assert span(t, "PaymentService.charge")["status"] == "error"
    assert t["spans"][0]["error"]["name"] == "PaymentError"


def test_chained_exceptions_keep_both_tracebacks(captured):
    @stacklens.traced
    def load():
        try:
            {}["missing"]
        except KeyError as e:
            raise RuntimeError("config broken") from e

    with pytest.raises(RuntimeError):
        with stacklens.trace("job"):
            load()
    stack = span(captured.one(), "test_tracing.load")["error"]["stack"]
    assert "KeyError" in stack and "direct cause" in stack and "RuntimeError: config broken" in stack


def test_traced_decorator_forms(captured):
    @stacklens.traced
    def plain(a, b=2):
        return a + b

    @stacklens.traced(name="Billing.total", kind="service")
    def total(items):
        return sum(items)

    class Mailer:
        @stacklens.traced
        def send(self, to):
            return f"sent:{to}"

    @stacklens.traced
    class InvoiceService:
        def render(self, n):
            return f"#{n}"

    with stacklens.trace("job"):
        plain(1, b=5)
        total([1, 2])
        Mailer().send("a@b.c")
        InvoiceService().render(3)
    t = captured.one()
    p = span(t, "test_tracing.plain")
    assert p["params"] == ["a", "b"] and p["args"] == [1, 5] and p["result"] == 6 and p["kind"] == "function"
    assert span(t, "Billing.total")["kind"] == "service"
    m = span(t, "Mailer.send")
    assert m["args"] == ["a@b.c"]  # self is not recorded
    assert span(t, "InvoiceService.render")["kind"] == "service"


def test_instrument_module(captured):
    mod = types.ModuleType("shop.order_service")

    def create_order(user_id, items):
        return {"user": user_id, "n": len(items)}

    create_order.__module__ = mod.__name__
    mod.create_order = create_order
    mod.imported = len  # not defined here: left alone
    stacklens.instrument_module(mod)
    with stacklens.trace("job"):
        mod.create_order(1, [1, 2])
    s = span(captured.one(), "order_service.create_order")
    assert s["kind"] == "service" and s["result"] == {"user": 1, "n": 2}
    assert mod.imported is len


def test_outside_a_trace_calls_pass_through(captured):
    assert OrderController().create({"sku": "x"})["status"] == "placed"
    assert captured.flush() == []


def test_disabled_tracing_records_nothing():
    cap = configure(enabled=False)
    with stacklens.trace("job"):
        OrderController().create({"sku": "x"})
    assert cap.flush() == []


def test_capture_args_and_results_can_be_turned_off():
    cap = configure(capture_args=False, capture_results=False)
    with stacklens.trace("job"):
        OrderController().create({"sku": "x"})
    s = span(cap.one(), "OrderService.place")
    assert "args" not in s and "result" not in s and s["status"] == "ok"


def test_logs_from_stacklens_log_and_logging(captured):
    logger = logging.getLogger("tests.audit")
    logger.setLevel(logging.INFO)

    @stacklens.traced
    def record(event):
        stacklens.log("recorded", {"event": event})
        logger.info("user %s logged in", "ada", extra={"ip": "10.0.0.1"})
        logger.debug("not recorded: below the logger level")
        try:
            1 / 0
        except ZeroDivisionError:
            logger.exception("division failed")

    with stacklens.trace("job"):
        record("login")
    logs = span(captured.one(), "test_tracing.record")["logs"]
    assert [entry["message"] for entry in logs] == ["recorded", "user ada logged in", "division failed"]
    assert logs[0]["data"] == {"event": "login"}
    assert logs[1]["level"] == "info" and logs[1]["data"]["ip"] == "10.0.0.1" and logs[1]["data"]["logger"] == "tests.audit"
    assert logs[2]["level"] == "error" and logs[2]["data"]["exception"]["name"] == "ZeroDivisionError"


def test_logging_basic_config_still_works_after_init(captured):
    root = logging.getLogger()
    assert all(type(h).__name__ != "SpanLogHandler" for h in root.handlers)


def test_set_user_attributes_and_trace_id(captured):
    seen = {}
    with stacklens.trace("job", attributes={"batch": 7}) as scope:
        stacklens.set_user(42)
        stacklens.set_attributes({"plan": "pro"}, region="eu")
        seen["id"] = stacklens.current_trace_id()
        seen["scope"] = scope.trace_id
        seen["headers"] = stacklens.propagation_headers()
    t = captured.one()
    assert t["userId"] == "42" and seen["id"] == t["id"] == seen["scope"]
    assert t["spans"][0]["attributes"] == {"batch": 7, "plan": "pro", "region": "eu"}
    assert seen["headers"]["traceparent"] == f"00-{t['id']}-{t['spans'][0]['id']}-01"
    assert seen["headers"]["tracestate"] == "stacklens=test-app"
    assert stacklens.propagation_headers() == {} and stacklens.current_trace_id() is None


def test_trace_as_decorator_function_call_and_nested(captured):
    @stacklens.trace("nightly-report")
    def report(day):
        with stacklens.trace("load-rows"):
            pass
        return day

    assert report("mon") == "mon"
    assert stacklens.trace("cleanup", lambda x: x * 2, 21) == 42
    traces = {t["name"]: t for t in captured.flush()}
    assert set(traces) == {"nightly-report", "cleanup"}
    child = span(traces["nightly-report"], "load-rows")
    assert child["kind"] == "job" and child["parentId"] == traces["nightly-report"]["spans"][0]["id"]


def test_trace_links_to_incoming_headers(captured):
    tp = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"
    with stacklens.trace("consume", headers={"Traceparent": tp, "tracestate": "stacklens=orders-api"}):
        pass
    assert captured.one()["parent"] == {"traceId": "0af7651916cd43dd8448eb211c80319c", "spanId": "b7ad6b7169203331", "service": "orders-api"}


def test_sampling():
    cap = configure(sample_rate=0)
    with stacklens.trace("job"):
        pass
    assert cap.flush() == []


def test_ignore_methods_and_include_exclude(captured):
    class Repo:
        def find(self):
            return 1

        def health(self):
            return 2

        def _cache(self):
            return 3

    stacklens.instrument_class(Repo, exclude=["health"])
    with stacklens.trace("job"):
        Repo().find()
        Repo().health()
        Repo()._cache()
    names = {s["name"] for s in captured.one()["spans"]}
    assert "Repo.find" in names and "Repo._cache" in names and "Repo.health" not in names


def test_generators_record_creation_without_consuming(captured):
    @stacklens.traced
    def rows():
        yield 1
        yield 2

    with stacklens.trace("job"):
        assert list(rows()) == [1, 2]
    s = span(captured.one(), "test_tracing.rows")
    assert s["result"]["$t"] == "ref" and s["resultType"] == "generator"


def test_wrapped_functions_keep_metadata():
    def documented(a: int) -> int:
        """Doc."""
        return a

    w = stacklens.wrap(documented, "Calc.documented")
    assert w.__name__ == "documented" and w.__doc__ == "Doc." and w.__wrapped__ is documented
    assert stacklens.unwrap(w) is documented
