from typing import List

from sqlalchemy import select

from .models import Reservation, StockLevel


class StockRepository:
    def __init__(self, session):
        self.session = session

    def levels(self, sku: str) -> List[StockLevel]:
        return list(self.session.scalars(select(StockLevel).where(StockLevel.sku == sku)))

    def reserve(self, level: StockLevel, qty: int, order_ref: str) -> Reservation:
        level.reserved += qty
        r = Reservation(sku=level.sku, qty=qty, warehouse_code=level.warehouse.code, order_ref=order_ref)
        self.session.add(r)
        self.session.commit()
        return r
