from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..db import get_session
from ..services import CatalogService

router = APIRouter(prefix="/products", tags=["products"])


def db():
    session = get_session()
    try:
        yield session
    finally:
        session.close()


@router.get("")
def list_products(category: Optional[str] = None, limit: int = Query(20, le=100), session: Session = Depends(db)):
    return {"items": CatalogService(session).list_products(category, limit)}


@router.get("/{sku}")
def get_product(sku: str, session: Session = Depends(db)):
    return CatalogService(session).product_detail(sku)
