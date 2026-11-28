"""Data access. Every method becomes a ``repository`` span; the SQL it runs shows up beneath it."""

from typing import List, Optional, Sequence

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from .models import Category, PriceRule, Product, Review


class ProductRepository:
    def __init__(self, session: Session):
        self.session = session

    def by_sku(self, sku: str) -> Optional[Product]:
        return self.session.scalars(select(Product).where(Product.sku == sku)).first()

    def by_skus(self, skus: Sequence[str]) -> List[Product]:
        return list(self.session.scalars(select(Product).where(Product.sku.in_(skus))).unique())

    def search(self, category: Optional[str], limit: int, offset: int = 0) -> List[Product]:
        q = select(Product).where(Product.active.is_(True)).order_by(Product.sku).limit(limit).offset(offset)
        if category:
            q = q.join(Product.category).where(Category.name == category)
        return list(self.session.scalars(q).unique())

    def all_active(self) -> List[Product]:
        return list(self.session.scalars(select(Product).where(Product.active.is_(True))).unique())

    def update_price(self, product: Product, price_cents: int) -> Product:
        product.price_cents = price_cents
        self.session.commit()
        return product


class ReviewRepository:
    def __init__(self, session: Session):
        self.session = session

    def summary(self, product_id: int) -> dict:
        row = self.session.execute(select(func.count(Review.id), func.avg(Review.rating)).where(Review.product_id == product_id)).one()
        return {"count": row[0], "average": round(float(row[1] or 0), 2)}


class PriceRuleRepository:
    def __init__(self, session: Session):
        self.session = session

    def for_category(self, category: str) -> Optional[PriceRule]:
        return self.session.scalars(select(PriceRule).where(PriceRule.category == category)).first()


class ReportRepository:
    def __init__(self, session: Session):
        self.session = session

    def category_revenue(self, weeks: int) -> List[dict]:
        # deliberately heavy: a recursive CTE fabricates daily sales per product (a slow query on purpose)
        sql = text(
            """
            WITH RECURSIVE days(d) AS (SELECT 0 UNION ALL SELECT d + 1 FROM days WHERE d < :days)
            SELECT c.name AS category, COUNT(*) AS sale_days, SUM(p.price_cents * ((p.id * 7 + d) % 5)) / 100.0 AS revenue
            FROM products p JOIN categories c ON c.id = p.category_id CROSS JOIN days
            GROUP BY c.name ORDER BY revenue DESC
            """
        )
        return [dict(r._mapping) for r in self.session.execute(sql, {"days": weeks * 7 * 40})]
