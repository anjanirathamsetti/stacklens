import os
import random
import sys

from sqlalchemy import ForeignKey, Integer, String, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from shared_config import DATA_DIR  # noqa: E402


class Base(DeclarativeBase):
    pass


class Warehouse(Base):
    __tablename__ = "warehouses"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(8), unique=True)
    region: Mapped[str] = mapped_column(String(20))


class StockLevel(Base):
    __tablename__ = "stock_levels"
    id: Mapped[int] = mapped_column(primary_key=True)
    sku: Mapped[str] = mapped_column(String(20), index=True)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id"))
    on_hand: Mapped[int] = mapped_column(Integer)
    reserved: Mapped[int] = mapped_column(Integer, default=0)
    warehouse: Mapped[Warehouse] = relationship(lazy="select")


class Reservation(Base):
    __tablename__ = "reservations"
    id: Mapped[int] = mapped_column(primary_key=True)
    sku: Mapped[str] = mapped_column(String(20))
    qty: Mapped[int] = mapped_column(Integer)
    warehouse_code: Mapped[str] = mapped_column(String(8))
    order_ref: Mapped[str] = mapped_column(String(40))


os.makedirs(DATA_DIR, exist_ok=True)
engine = create_engine(f"sqlite:///{os.path.join(DATA_DIR, 'inventory.sqlite3')}", connect_args={"check_same_thread": False})
Session = sessionmaker(engine, expire_on_commit=False)


@event.listens_for(engine, "connect")
def _pragmas(dbapi_conn, _record):
    dbapi_conn.execute("PRAGMA journal_mode=WAL")


def init_db() -> None:
    Base.metadata.create_all(engine)
    with Session() as s:
        if s.query(Warehouse).count():
            return
        rng = random.Random(11)
        whs = [Warehouse(code="AMS1", region="eu-west"), Warehouse(code="SFO2", region="us-west"), Warehouse(code="NYC1", region="us-east")]
        s.add_all(whs)
        s.flush()
        for prefix, n in (("kb", 40), ("au", 40), ("dp", 40), ("st", 40), ("gpu", 40)):
            for i in range(1, n + 1):
                for w in whs:
                    scarce = prefix == "gpu" or i % 9 == 0
                    s.add(StockLevel(sku=f"{prefix}-{i:02d}", warehouse_id=w.id, on_hand=rng.randint(0, 3) if scarce else rng.randint(5, 400)))
        s.commit()
