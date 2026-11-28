import dataclasses
import datetime as dt
import decimal
import enum
import re
import uuid
from collections import OrderedDict, namedtuple
from typing import Any

import pytest

from stacklens._capture import Limits, approx_size, capture
from stacklens._options import DEFAULT_REDACT_KEYS, cached_matcher


def limits(**kw: Any) -> Limits:
    o = dict(max_depth=6, max_string_length=2000, max_array_length=30, max_object_keys=50)
    o.update(kw)
    return Limits(o["max_depth"], o["max_string_length"], o["max_array_length"], o["max_object_keys"], cached_matcher(DEFAULT_REDACT_KEYS))


def cap(v: Any, **kw: Any):
    return capture(v, limits(**kw))


def test_scalars_and_python_type_names():
    assert cap("x") == ("x", "str")
    assert cap(3) == (3, "int")
    assert cap(2.5) == (2.5, "float")
    assert cap(True) == (True, "bool")
    assert cap(None) == (None, "None")
    assert cap(decimal.Decimal("12.50")) == ("12.50", "Decimal")
    u = uuid.uuid4()
    assert cap(u) == (str(u), "UUID")
    assert cap(dt.datetime(2026, 1, 2, 3, 4, 5)) == ({"$t": "Date", "v": "2026-01-02T03:04:05"}, "datetime")
    assert cap(dt.date(2026, 1, 2))[1] == "date"
    assert cap(b"abc") == ({"$t": "ref", "name": "bytes", "summary": "3 bytes"}, "bytes")


def test_non_finite_and_huge_numbers_stay_json_safe():
    assert cap(float("nan"))[0] == "nan"
    assert cap(float("inf"))[0] == "inf"
    assert cap(2**70)[0] == str(2**70)


def test_long_strings_are_cut():
    v, _ = cap("a" * 50, max_string_length=10)
    assert v == "a" * 10 + "… (+40 chars)"


def test_redaction_by_key_at_any_depth():
    v, t = cap({"user": {"email": "a@b.c", "password": "hunter2", "api_key": "k", "accessToken": "t"}, "Authorization": "Bearer x", "card_number": "4111"})
    assert v["user"]["password"] == "[REDACTED]"
    assert v["user"]["api_key"] == "[REDACTED]"
    assert v["user"]["accessToken"] == "[REDACTED]"
    assert v["Authorization"] == "[REDACTED]"
    assert v["card_number"] == "[REDACTED]"
    assert v["user"]["email"] == "a@b.c"
    assert "hunter2" not in str(v)


def test_dict_shape_type():
    v, t = cap({"id": 1, "email": "x", "roles": ["a", "b"], "created": dt.datetime(2026, 1, 1)})
    assert t == "{ id: int; email: str; roles: list[str]; created: datetime }"


def test_lists_tuples_sets_and_limits():
    v, t = cap(list(range(100)), max_array_length=5)
    assert v[:5] == [0, 1, 2, 3, 4] and v[5] == {"$t": "more", "count": 95}
    assert t == "list[int]"
    assert cap([1, "a"])[1] == "list[int | str]"
    assert cap((1, "a"))[1] == "tuple[int, str]"
    v, t = cap({1, 2})
    assert v["$t"] == "Set" and v["size"] == 2 and t == "set[int]"
    assert cap([])[1] == "list[Any]"


def test_non_string_keys_become_a_map():
    v, t = cap({1: "a", 2: "b"})
    assert v == {"$t": "Map", "size": 2, "entries": [[1, "a"], [2, "b"]]}
    assert t == "dict[int, str]"


def test_object_key_limit():
    v, _ = cap({f"k{i}": i for i in range(10)}, max_object_keys=3)
    assert list(v)[:3] == ["k0", "k1", "k2"]
    assert v["…"] == {"$t": "more", "count": 7}


def test_depth_limit():
    deep: Any = {"a": {"b": {"c": {"d": {"e": 1}}}}}
    v, _ = cap(deep, max_depth=2)
    assert v["a"]["b"] == {"$t": "ref", "name": "dict", "summary": "…"}


def test_circular_references():
    a: Any = {"name": "a"}
    a["self"] = a
    v, t = cap(a)
    assert v["self"] == {"$t": "circular"}


@dataclasses.dataclass
class Order:
    id: int
    total: decimal.Decimal
    status: "Status"


class Status(enum.Enum):
    PLACED = "placed"


def test_dataclass_enum_and_class_label():
    v, t = cap(Order(1, decimal.Decimal("9.99"), Status.PLACED))
    assert v == {"$class": "Order", "id": 1, "total": "9.99", "status": "placed"}
    assert t == "Order { id: int; total: Decimal; status: Status }"


def test_pydantic_models():
    pydantic = pytest.importorskip("pydantic")

    class Item(pydantic.BaseModel):
        sku: str
        qty: int = 1
        secret_token: str = "x"

    v, t = cap(Item(sku="kb-01"))
    assert v == {"$class": "Item", "sku": "kb-01", "qty": 1, "secret_token": "[REDACTED]"}
    assert t.startswith("Item { sku: str; qty: int")


def test_plain_objects_and_namedtuples():
    class User:
        def __init__(self):
            self.id = 7
            self.name = "Ada"

    assert cap(User()) == ({"$class": "User", "id": 7, "name": "Ada"}, "User { id: int; name: str }")
    P = namedtuple("P", "x y")
    assert cap(P(1, 2))[0] == {"$class": "P", "x": 1, "y": 2}


def test_functions_classes_exceptions_and_generators():
    def handler(a, b):
        return a

    v, t = cap(handler)
    assert v == {"$t": "fn", "name": "handler"} and t == "(a, b) -> Any"
    assert cap(Order)[1] == "type[Order]"
    err, t = cap(ValueError("bad"))
    assert err["$t"] == "Error" and err["name"] == "ValueError" and err["message"] == "bad" and t == "ValueError"
    gen = (i for i in range(3))
    v, t = cap(gen)
    assert v["$t"] == "ref" and t == "generator"
    assert list(gen) == [0, 1, 2]  # not consumed


async def _coro():
    return 1


def test_coroutines_are_not_awaited():
    c = _coro()
    v, t = cap(c)
    assert v == {"$t": "Promise"} and t == "Coroutine"
    c.close()


def test_request_like_objects_are_summarized():
    class FakeRequest:
        method = "GET"
        path = "/orders/1"
        headers = {"a": "b"}

    assert cap(FakeRequest())[0] == {"$t": "ref", "name": "Request", "summary": "GET /orders/1"}


def test_getter_errors_and_odd_objects_never_raise():
    class Weird:
        __slots__ = ()

        def __repr__(self):
            raise RuntimeError("no repr")

    v, t = cap(Weird())
    assert v["$t"] == "ref" and t == "Weird"
    assert cap(OrderedDict(a=1))[0] == {"a": 1}


def test_approx_size_tracks_json_size():
    v = {"a": "xxxx", "b": [1, 2, 3]}
    assert 15 < approx_size(v) < 60
    assert re.match(r"\d+", str(approx_size(None)))
