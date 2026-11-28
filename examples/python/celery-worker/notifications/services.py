import logging
import os
import sys
from string import Template

import requests

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from shared_config import PROVIDERS_URL  # noqa: E402

log = logging.getLogger("notifications")

QUOTE_EMAIL = Template("Hi,\n\nyour quote $quote_id is ready: $total USD.\nIt is valid for 7 days.\n\n— The Storefront team")


class RateLimited(Exception):
    def __init__(self, retry_after: int):
        super().__init__(f"mail provider rate limited, retry in {retry_after}s")
        self.retry_after = retry_after


class TemplateRenderer:
    def quote_ready(self, quote_id: str, total: float) -> dict:
        return {"subject": f"Your quote {quote_id}", "text": QUOTE_EMAIL.substitute(quote_id=quote_id, total=f"{total:.2f}")}


class MailProviderClient:
    """An external email API (doesn't run StackLens: no call graph, request/response recorded)."""

    def send(self, to: str, message: dict) -> dict:
        res = requests.post(
            f"{PROVIDERS_URL}/v3/mail/send",
            json={"personalizations": [{"to": [{"email": to}]}], "from": {"email": "noreply@shop.test"}, **message},
            headers={"authorization": "Bearer prov_live_mail_d41d"},
            timeout=5,
        )
        if res.status_code == 429:
            raise RateLimited(int(res.headers.get("retry-after", "2")))
        res.raise_for_status()
        return res.json()


class SearchIndexer:
    def tokenize(self, sku: str) -> list:
        return [sku, *sku.split("-")]

    def rebuild(self, skus: list) -> dict:
        terms = {}
        for sku in skus:
            for t in self.tokenize(sku):
                terms.setdefault(t, []).append(sku)
        log.info("indexed %d skus, %d terms", len(skus), len(terms))
        return {"skus": len(skus), "terms": len(terms)}
