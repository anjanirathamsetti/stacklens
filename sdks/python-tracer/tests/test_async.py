import asyncio
import contextvars
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest

import stacklens
from conftest import assert_valid_trace, parent_of, span, spans_by_name


class PriceClient:
    async def price(self, sku):
        await asyncio.sleep(0.01)
        return {"sku": sku, "price": 10}

    async def fail(self, sku):
        await asyncio.sleep(0.001)
        raise TimeoutError(f"pricing timed out for {sku}")


class CatalogService:
    def __init__(self):
        self.client = PriceClient()

    async def quote(self, skus):
        return await asyncio.gather(*(self.client.price(s) for s in skus))

    async def background(self):
        task = asyncio.create_task(self.client.price("bg"))
        return await task

    async def partial(self):
        return await asyncio.gather(self.client.price("a"), self.client.fail("b"), return_exceptions=True)

    def blocking(self, n):
        return n * 2

    async def offload(self):
        return await asyncio.to_thread(self.blocking, 21)


stacklens.instrument_class(PriceClient)
stacklens.instrument_class(CatalogService)


async def test_gather_children_get_the_right_parent(captured):
    async with stacklens.trace("quote"):
        result = await CatalogService().quote(["a", "b", "c"])
    assert [r["sku"] for r in result] == ["a", "b", "c"]
    t = captured.one()
    assert_valid_trace(t)
    quote = span(t, "CatalogService.quote")
    prices = spans_by_name(t, "PriceClient.price")
    assert len(prices) == 3 and all(p["parentId"] == quote["id"] for p in prices)
    assert all(p["async"] for p in prices) and quote["async"]
    # concurrent: they overlap in time
    assert max(p["start"] for p in prices) < min(p["start"] + p["duration"] for p in prices)
    assert sorted(p["args"][0] for p in prices) == ["a", "b", "c"]


async def test_create_task_and_to_thread_keep_context(captured):
    async with stacklens.trace("job"):
        await CatalogService().background()
        assert await CatalogService().offload() == 42
    t = captured.one()
    assert parent_of(t, span(t, "PriceClient.price"))["name"] == "CatalogService.background"
    assert parent_of(t, span(t, "CatalogService.blocking"))["name"] == "CatalogService.offload"


async def test_errors_in_gathered_tasks(captured):
    async with stacklens.trace("job"):
        out = await CatalogService().partial()
    assert isinstance(out[1], TimeoutError)
    t = captured.one()
    f = span(t, "PriceClient.fail")
    assert f["status"] == "error" and f["error"]["name"] == "TimeoutError"
    assert t["status"] == "ok"  # handled by return_exceptions


async def test_concurrent_traces_do_not_mix(captured):
    async def one(i):
        async with stacklens.trace(f"job-{i}"):
            await CatalogService().quote([f"s{i}"])

    await asyncio.gather(*(one(i) for i in range(5)))
    traces = captured.flush()
    assert len(traces) == 5
    for t in traces:
        i = t["name"].split("-")[1]
        assert [s["args"][0] for s in spans_by_name(t, "PriceClient.price")] == [f"s{i}"]


async def test_fire_and_forget_task_inside_settle_window():
    from conftest import configure

    cap = configure(settle_ms=200)
    async with stacklens.trace("job"):
        asyncio.create_task(CatalogService().quote(["late"]))
    await asyncio.sleep(0.05)
    t = cap.one()
    assert spans_by_name(t, "PriceClient.price")


def test_threads_with_copied_context(captured):
    svc = CatalogService()
    with stacklens.trace("job"):
        with ThreadPoolExecutor(4) as pool:
            ctx = contextvars.copy_context()
            futures = [pool.submit(contextvars.copy_context().run, svc.blocking, i) for i in range(4)]
            assert sorted(f.result() for f in futures) == [0, 2, 4, 6]
            del ctx
    t = captured.one()
    assert len(spans_by_name(t, "CatalogService.blocking")) == 4


def test_threads_without_context_are_not_attributed(captured):
    svc = CatalogService()
    with stacklens.trace("job"):
        th = threading.Thread(target=svc.blocking, args=(1,))
        th.start()
        th.join()
    assert not spans_by_name(captured.one(), "CatalogService.blocking")


async def test_cancellation_is_recorded_and_reraised(captured):
    async def slow():
        await asyncio.sleep(1)

    wrapped = stacklens.wrap(slow, "Jobs.slow")
    with pytest.raises(asyncio.TimeoutError):
        async with stacklens.trace("job"):
            await asyncio.wait_for(wrapped(), 0.01)
    s = span(captured.one(), "Jobs.slow")
    assert s["status"] == "error" and s["error"]["name"] == "CancelledError"
