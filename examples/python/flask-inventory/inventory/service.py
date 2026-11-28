import logging
import random
from typing import Dict, List

import requests

from .repository import StockRepository

log = logging.getLogger("inventory.service")
REGION_ORDER = {"us-west": 0, "us-east": 1, "eu-west": 2}


class WarehouseSyncError(Exception):
    """The warehouse management system is behind; stock numbers can't be trusted."""

    status_code = 503


class InsufficientStock(Exception):
    status_code = 409


class StockService:
    def __init__(self, session):
        self.repo = StockRepository(session)

    def available(self, sku: str) -> Dict[str, int]:
        levels = self.repo.levels(sku)
        # lazy-loads each level's warehouse (a small N+1)
        return {lvl.warehouse.code: max(0, lvl.on_hand - lvl.reserved) for lvl in levels}

    def check(self, items: List[dict]) -> List[dict]:
        if random.random() < 0.03:
            raise WarehouseSyncError("warehouse sync lag > 120s, refusing to answer")
        out = []
        for item in items:
            stock = self.available(item["sku"])
            total = sum(stock.values())
            out.append({"sku": item["sku"], "requested": item["qty"], "on_hand": total, "available": total >= item["qty"]})
            if 0 < total < 5:
                log.warning("low stock for %s: %d left", item["sku"], total)
        return out

    def reserve(self, sku: str, qty: int, order_ref: str) -> dict:
        levels = sorted(self.repo.levels(sku), key=lambda l: REGION_ORDER.get(l.warehouse.region, 9))
        for level in levels:
            if level.on_hand - level.reserved >= qty:
                r = self.repo.reserve(level, qty, order_ref)
                return {"reservation": r.id, "warehouse": r.warehouse_code}
        raise InsufficientStock(f"cannot reserve {qty} x {sku}")


class SupplierClient:
    """Purchase orders go to an external supplier API (doesn't run StackLens)."""

    def __init__(self, base_url: str):
        self.base_url = base_url

    def purchase_order(self, sku: str, qty: int) -> dict:
        res = requests.post(f"{self.base_url}/suppliers/purchase-orders", json={"sku": sku, "qty": qty}, headers={"authorization": "Bearer prov_live_supplier_55e0"}, timeout=3)
        res.raise_for_status()
        return res.json()
