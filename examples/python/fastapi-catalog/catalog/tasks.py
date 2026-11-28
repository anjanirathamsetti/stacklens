"""Enqueue background work for the Celery worker (notifications-worker) by task name."""

import os
import sys

from celery import Celery

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from shared_config import celery_broker_options  # noqa: E402

producer = Celery("catalog-producer")
producer.conf.update(**celery_broker_options())


class NotificationQueue:
    def quote_ready(self, quote_id: str, email: str, total: float) -> str:
        return producer.send_task("notifications.send_quote_email", args=[quote_id, email], kwargs={"total": total}).id

    def reindex(self, skus: list) -> str:
        return producer.send_task("notifications.rebuild_search_index", args=[skus]).id
