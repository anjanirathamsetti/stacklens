import sys
import types

import pytest

django = pytest.importorskip("django")

import stacklens  # noqa: E402
from conftest import assert_valid_trace, span, spans_by_name  # noqa: E402

urls = types.ModuleType("stacklens_test_urls")
sys.modules["stacklens_test_urls"] = urls

from django.conf import settings  # noqa: E402

if not settings.configured:
    settings.configure(
        DEBUG=False,
        SECRET_KEY="test",
        ALLOWED_HOSTS=["*"],
        ROOT_URLCONF="stacklens_test_urls",
        MIDDLEWARE=["stacklens.integrations.django.StackLensMiddleware", "django.middleware.common.CommonMiddleware"],
        DATABASES={"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}},
        INSTALLED_APPS=["django.contrib.contenttypes"],
        LOGGING_CONFIG=None,
    )
    django.setup()

from django.db import connection  # noqa: E402
from django.http import Http404, JsonResponse  # noqa: E402
from django.test import Client  # noqa: E402
from django.urls import path  # noqa: E402
from django.views import View  # noqa: E402


class AccountRepository:
    def get(self, pk):
        with connection.cursor() as c:
            c.execute("SELECT %s AS id, 'ada' AS name", [pk])
            row = c.fetchone()
        return {"id": row[0], "name": row[1]}

    def touch_all(self, ids):
        for i in ids:
            with connection.cursor() as c:
                c.execute("SELECT %s", [i])


stacklens.instrument_class(AccountRepository)
repo = AccountRepository()


def account_detail(request, pk):
    if pk == 404:
        raise Http404("no account")
    if pk == 500:
        raise RuntimeError("ledger offline")
    repo.touch_all(range(15))
    return JsonResponse(repo.get(pk))


class AccountListView(View):
    def get(self, request):
        return JsonResponse({"accounts": [repo.get(1)]})


urls.urlpatterns = [path("accounts/<int:pk>/", account_detail), path("accounts/", AccountListView.as_view())]


@pytest.fixture
def client():
    return Client(raise_request_exception=False)


def test_request_view_and_sql_spans(captured, client):
    r = client.get("/accounts/7/?expand=1", HTTP_X_USER_ID="u-9")
    assert r.status_code == 200
    t = captured.one()
    assert_valid_trace(t)
    assert r["x-stacklens-trace-id"] == t["id"]
    assert t["name"] == "GET /accounts/<int:pk>/" and t["http"]["route"] == "/accounts/<int:pk>/"
    assert t["http"]["request"]["params"] == {"pk": 7} and t["http"]["request"]["query"] == {"expand": "1"}
    assert t["http"]["response"]["body"] == {"id": 7, "name": "ada"}
    assert t["userId"] == "u-9"
    v = span(t, "test_django.account_detail")
    assert v["kind"] == "controller" and v["params"] == ["request", "pk"] and v["args"][0]["name"] == "Request"
    sql = spans_by_name(t, "SQL.query")
    get_sql = next(s for s in sql if "AS id" in s.get("args", [""])[0])
    assert get_sql["kind"] == "db" and get_sql["args"][1] == [7] and get_sql["attributes"] == {"db.system": "sqlite"}
    # N+1 loop: 15 statements under touch_all fold into 10 + one aggregate
    loop = [s for s in sql if s["parentId"] == span(t, "AccountRepository.touch_all")["id"]]
    assert len(loop) == 11 and next(s for s in loop if "collapsed" in s)["collapsed"]["count"] == 5


def test_class_based_views(captured, client):
    assert client.get("/accounts/").status_code == 200
    t = captured.one()
    assert t["name"] == "GET /accounts/"
    assert span(t, "AccountListView.get")["kind"] == "controller"


def test_404_and_500(captured, client):
    assert client.get("/accounts/404/").status_code == 404
    assert client.get("/accounts/500/").status_code == 500
    traces = {t["http"]["statusCode"]: t for t in captured.flush()}
    assert traces[404]["status"] == "ok"
    err = traces[500]
    assert err["status"] == "error" and err["spans"][0]["error"]["name"] == "RuntimeError"
    assert span(err, "test_django.account_detail")["error"]["message"] == "ledger offline"


def test_sql_outside_requests_is_not_recorded(captured):
    with connection.cursor() as c:
        c.execute("SELECT 1")
    assert captured.flush() == []
