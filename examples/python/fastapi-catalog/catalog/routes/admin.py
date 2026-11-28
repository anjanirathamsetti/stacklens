from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..auth import admin_user
from ..services import AdminService, CatalogService, ReportService
from .products import db

router = APIRouter(prefix="/admin", tags=["admin"])


class Reprice(BaseModel):
    price: float


@router.put("/products/{sku}/price")
def reprice(sku: str, body: Reprice, user: dict = Depends(admin_user), session: Session = Depends(db)):
    return AdminService(session).reprice(sku, body.price)


@router.post("/reindex-ratings")
def reindex_ratings(user: dict = Depends(admin_user), session: Session = Depends(db)):
    ratings = CatalogService(session).reindex_ratings()
    return {"products": len(ratings), "top": sorted(ratings.items(), key=lambda kv: -kv[1])[:5]}


@router.get("/reports/category-revenue")
def category_revenue(weeks: int = 4, user: dict = Depends(admin_user), session: Session = Depends(db)):
    return {"weeks": weeks, "rows": ReportService(session).category_revenue(weeks)}
