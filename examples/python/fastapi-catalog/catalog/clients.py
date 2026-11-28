"""Calls to other services. inventory-api (Flask) and billing-api (Node/NestJS) run StackLens, so their
call trees link under these calls; shipping-service (Node) and the providers don't."""

import os
import sys

import httpx

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from shared_config import BILLING_URL, INVENTORY_URL, PROVIDERS_URL, SHIPPING_URL  # noqa: E402


class UpstreamError(Exception):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


_http = httpx.AsyncClient(timeout=httpx.Timeout(5.0, connect=2.0))


class InventoryClient:
    async def check(self, items: list) -> dict:
        res = await _http.post(f"{INVENTORY_URL}/stock/check", json={"items": items})
        if res.status_code >= 500:
            raise UpstreamError(f"inventory-api answered {res.status_code}")
        return res.json()


class BillingClient:
    async def invoice(self, user_id: int) -> dict:
        res = await _http.get(f"{BILLING_URL}/orders/invoice/{user_id}")
        if res.status_code == 404:
            raise UpstreamError(f"no billing account for user {user_id}", 404)
        res.raise_for_status()
        return res.json()


class ShippingClient:
    async def quote(self, zip_code: str, items: list) -> dict:
        res = await _http.post(f"{SHIPPING_URL}/quotes", json={"zip": zip_code, "items": items, "service": "ground"}, headers={"x-api-key": "demo-shipping-key"})
        if res.status_code >= 400:
            raise UpstreamError(f"shipping-service answered {res.status_code}: {res.text[:80]}", 502 if res.status_code >= 500 else 422)
        return res.json()


class FxClient:
    async def rate(self, currency: str) -> float:
        if currency == "USD":
            return 1.0
        res = await _http.get(f"{PROVIDERS_URL}/fx/latest", params={"base": "USD", "symbols": currency}, headers={"authorization": "Bearer prov_live_fx_7c1d"})
        res.raise_for_status()
        return float(res.json()["rates"][currency])


class FraudClient:
    def score(self, email: str, amount: float) -> dict:
        # a blocking call made from a sync helper (runs in the threadpool)
        res = httpx.get(f"{PROVIDERS_URL}/fraud/score", params={"email": email, "amount": amount}, headers={"authorization": "Bearer prov_live_fraud_19ab"}, timeout=3)
        return res.json()
