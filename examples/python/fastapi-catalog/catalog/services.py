"""Business logic. Every method becomes a ``service`` span with its arguments and return value."""

import asyncio
import logging
import uuid
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from .clients import BillingClient, FraudClient, FxClient, InventoryClient, ShippingClient, UpstreamError
from .repositories import PriceRuleRepository, ProductRepository, ReportRepository, ReviewRepository
from .tasks import NotificationQueue

log = logging.getLogger("catalog.services")


class OutOfStock(Exception):
    status_code = 409


class UnknownProduct(Exception):
    status_code = 404


@dataclass
class QuoteLine:
    sku: str
    name: str
    qty: int
    unit_price: Decimal
    discount: Decimal


@dataclass
class Quote:
    id: str
    user_id: int
    currency: str
    lines: List[QuoteLine]
    shipping: Decimal
    total: Decimal
    warnings: List[str] = field(default_factory=list)


def money(v: float) -> Decimal:
    return Decimal(str(v)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


class PricingService:
    def __init__(self, session: Session):
        self.rules = PriceRuleRepository(session)

    def unit_price(self, product) -> Decimal:
        price = money(product.price_cents / 100)
        return price - self.discount(product, price)

    def discount(self, product, price: Decimal) -> Decimal:
        rule = self.rules.for_category(product.category.name)
        return money(float(price) * rule.percent_off / 100) if rule else Decimal("0")

    def bundle_discount(self, product, qty: int) -> Decimal:
        """Multi-buy discount. Bug kept on purpose: the GPU rule is 0% and the split divides by it."""
        if qty < 2:
            return Decimal("0")
        rule = self.rules.for_category(product.category.name)
        if rule is None:
            return Decimal("0")
        per_unit_split = (qty - 1) / rule.percent_off
        return money(product.price_cents / 100 * min(per_unit_split, 0.05))


class CatalogService:
    def __init__(self, session: Session):
        self.products = ProductRepository(session)
        self.reviews = ReviewRepository(session)
        self.pricing = PricingService(session)

    def list_products(self, category: Optional[str], limit: int) -> List[dict]:
        return [self.to_card(p) for p in self.products.search(category, limit)]

    def product_detail(self, sku: str) -> dict:
        product = self.products.by_sku(sku)
        if product is None:
            raise UnknownProduct(f"no product with sku {sku!r}")
        card = self.to_card(product)
        card["reviews"] = self.reviews.summary(product.id)
        return card

    def to_card(self, product) -> dict:
        return {"sku": product.sku, "name": product.name, "category": product.category.name, "price": float(self.pricing.unit_price(product))}

    def reindex_ratings(self) -> Dict[str, float]:
        """Legacy job: touches every product's reviews one by one (an N+1 on purpose)."""
        out = {}
        for product in self.products.all_active():
            ratings = [r.rating for r in product.reviews]  # lazy load per product
            out[product.sku] = round(sum(ratings) / len(ratings), 2) if ratings else 0.0
        return out


class QuoteService:
    def __init__(self, session: Session):
        self.products = ProductRepository(session)
        self.pricing = PricingService(session)
        self.inventory = InventoryClient()
        self.billing = BillingClient()
        self.shipping = ShippingClient()
        self.fx = FxClient()
        self.fraud = FraudClient()
        self.queue = NotificationQueue()

    async def create_quote(self, user: dict, items: List[dict], zip_code: str, currency: str) -> Quote:
        products = {p.sku: p for p in self.products.by_skus([i["sku"] for i in items])}
        missing = [i["sku"] for i in items if i["sku"] not in products]
        if missing:
            raise UnknownProduct(f"unknown sku(s): {', '.join(missing)}")
        # fan out to three services at once
        stock, invoice, shipping = await asyncio.gather(
            self.inventory.check(items),
            self.billing.invoice(user["id"]),
            self.shipping.quote(zip_code, items),
        )
        short = [s["sku"] for s in stock["items"] if not s["available"]]
        if short:
            log.warning("quote blocked, out of stock: %s", short)
            raise OutOfStock(f"out of stock: {', '.join(short)}")
        rate = Decimal(str(await self.fx.rate(currency)))
        lines = [self.line(products[i["sku"]], i["qty"], rate) for i in items]
        total = sum((l.unit_price * l.qty for l in lines), Decimal("0")) + money(shipping["price"]) * rate
        quote = Quote(id=f"q_{uuid.uuid4().hex[:10]}", user_id=user["id"], currency=currency, lines=lines, shipping=money(shipping["price"]) * rate, total=total.quantize(Decimal("0.01")))
        if invoice.get("discount"):
            quote.warnings.append(f"loyalty discount {invoice['discount']} applies at checkout")
        risk = await asyncio.to_thread(self.fraud.score, user["email"], float(quote.total))
        if risk.get("score", 0) > 0.8:
            quote.warnings.append("manual review required")
        self.queue.quote_ready(quote.id, user["email"], float(quote.total))
        log.info("quote %s created for user %s: %s %s", quote.id, user["id"], quote.total, currency)
        return quote

    def line(self, product, qty: int, rate: Decimal) -> QuoteLine:
        unit = (self.pricing.unit_price(product) - self.pricing.bundle_discount(product, qty)) * rate
        return QuoteLine(sku=product.sku, name=product.name, qty=qty, unit_price=unit.quantize(Decimal("0.01")), discount=money(product.price_cents / 100) * rate - unit)


class AdminService:
    def __init__(self, session: Session):
        self.products = ProductRepository(session)
        self.queue = NotificationQueue()

    def reprice(self, sku: str, price: float) -> dict:
        product = self.products.by_sku(sku)
        if product is None:
            raise UnknownProduct(sku)
        if price <= 0:
            raise ValueError("price must be positive")
        self.products.update_price(product, int(round(price * 100)))
        self.queue.reindex([sku])
        return {"sku": sku, "price": price}


class ReportService:
    def __init__(self, session: Session):
        self.reports = ReportRepository(session)

    def category_revenue(self, weeks: int) -> List[dict]:
        return self.reports.category_revenue(weeks)


__all__ = ["CatalogService", "QuoteService", "AdminService", "ReportService", "UpstreamError", "OutOfStock", "UnknownProduct"]
