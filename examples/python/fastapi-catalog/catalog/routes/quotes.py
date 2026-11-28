from typing import List

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..auth import current_user
from ..services import QuoteService
from .products import db

router = APIRouter(prefix="/quotes", tags=["quotes"])


class QuoteItem(BaseModel):
    sku: str
    qty: int = Field(1, ge=1, le=20)


class QuoteRequest(BaseModel):
    items: List[QuoteItem]
    zip: str = "94107"
    currency: str = "USD"


@router.post("", status_code=201)
async def create_quote(body: QuoteRequest, user: dict = Depends(current_user), session: Session = Depends(db)):
    items = [i.model_dump() for i in body.items]
    return await QuoteService(session).create_quote(user, items, body.zip, body.currency)
