"""notifications-worker.

    celery -A notifications.worker worker --pool=threads -c 4 -l info   (from examples/python/celery-worker)
"""

import os
import sys

import stacklens
from stacklens.integrations.celery import instrument_celery

stacklens.init(application="notifications-worker", project="storefront")
instrument_celery()

from celery import Celery  # noqa: E402

from . import services  # noqa: E402

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from shared_config import celery_broker_options  # noqa: E402

stacklens.instrument_module(services)

app = Celery("notifications")
app.conf.update(**celery_broker_options(), worker_hijack_root_logger=False)


@app.task(name="notifications.send_quote_email", bind=True, max_retries=3)
def send_quote_email(self, quote_id: str, email: str, total: float = 0.0) -> dict:
    message = services.TemplateRenderer().quote_ready(quote_id, total)
    try:
        receipt = services.MailProviderClient().send(email, message)
    except services.RateLimited as e:
        raise self.retry(exc=e, countdown=e.retry_after)
    return {"quote": quote_id, "message_id": receipt["message_id"]}


@app.task(name="notifications.rebuild_search_index")
def rebuild_search_index(skus: list) -> dict:
    # a bulk job: thousands of tokenize() calls collapse into one span with count and timings
    expanded = [f"{s}-{v}" for s in skus for v in ("black", "white", "red", "eu", "us", "uk")] * 40
    return services.SearchIndexer().rebuild(expanded)


@app.task(name="notifications.nightly_digest")
def nightly_digest(day: str) -> dict:
    with stacklens.trace("build-digest"):
        return {"day": day, "sections": 3}
