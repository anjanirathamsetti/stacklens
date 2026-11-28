import pytest

celery = pytest.importorskip("celery")
from celery import Celery  # noqa: E402
from celery.contrib.testing.worker import start_worker  # noqa: E402

import stacklens  # noqa: E402
from stacklens.integrations.celery import instrument_celery  # noqa: E402
from conftest import assert_valid_trace, span  # noqa: E402

app = Celery("billing", broker="memory://", backend="cache+memory://")
app.conf.update(task_always_eager=False, worker_hijack_root_logger=False)


class ReceiptService:
    def render(self, order_id, total):
        return f"Receipt #{order_id}: {total:.2f}"


stacklens.instrument_class(ReceiptService)


@app.task(name="billing.tasks.send_receipt")
def send_receipt(order_id, total, email=None):
    return {"sent": True, "body": ReceiptService().render(order_id, total), "to": email}


@app.task(name="billing.tasks.charge", bind=True)
def charge(self, order_id):
    raise RuntimeError(f"gateway refused order {order_id}")


instrument_celery()


def wait_for_trace(captured, name, timeout=10.0):
    """The result is stored before task_postrun closes the task's trace, so wait for it to be exported."""
    import time

    deadline = time.time() + timeout
    while time.time() < deadline:
        captured.flush()
        found = [t for t in captured.traces if t["name"] == name]
        if found:
            return found[0]
        time.sleep(0.05)
    raise AssertionError(f"no trace {name}; have {[t['name'] for t in captured.traces]}")


@pytest.fixture(scope="module")
def worker():
    with start_worker(app, perform_ping_check=False, pool="solo", loglevel="WARNING"):
        yield


def test_task_trace_is_linked_to_the_enqueueing_call(captured, worker):
    with stacklens.trace("checkout"):
        res = send_receipt.delay(42, 99.5, email="ada@shop.test")
    assert res.get(timeout=10)["sent"] is True
    task = wait_for_trace(captured, "billing.tasks.send_receipt")
    producer = next(t for t in captured.traces if t["name"] == "checkout")
    assert_valid_trace(producer)
    assert_valid_trace(task)
    enqueue = span(producer, "enqueue billing.tasks.send_receipt")
    assert enqueue["kind"] == "job" and enqueue["args"][0] == "billing.tasks.send_receipt"
    assert enqueue["attributes"]["celery.task_id"] == res.id
    assert task["kind"] == "job" and task["parent"]["traceId"] == producer["id"] and task["parent"]["spanId"] == enqueue["id"]
    assert task["parent"]["service"] == "test-app"
    body = span(task, "test_celery.send_receipt")
    assert body["kind"] == "handler" and body["params"] == ["order_id", "total", "email"] and body["args"] == [42, 99.5, "ada@shop.test"]
    assert body["result"]["body"] == "Receipt #42: 99.50"
    assert span(task, "ReceiptService.render")["parentId"] == body["id"]


def test_failing_bound_task(captured, worker):
    res = charge.delay(7)
    with pytest.raises(RuntimeError):
        res.get(timeout=10)
    task = wait_for_trace(captured, "billing.tasks.charge")
    assert task["status"] == "error" and "parent" not in task
    body = span(task, "test_celery.charge")
    assert body["params"] == ["order_id"] and body["args"] == [7]
    assert body["status"] == "error" and body["error"]["message"] == "gateway refused order 7"


def test_eager_task_inside_a_trace_is_a_child_span(captured):
    with stacklens.trace("job"):
        send_receipt.apply(args=(1, 2.0))
    t = captured.one("job")
    assert span(t, "test_celery.send_receipt")["parentId"] == t["spans"][0]["id"]
