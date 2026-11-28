"""SQLite database with a realistic amount of catalog data (created on first start)."""

import os
import random
import sys

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from shared_config import DATA_DIR  # noqa: E402

from .models import Base, Category, PriceRule, Product, Review  # noqa: E402

os.makedirs(DATA_DIR, exist_ok=True)
DB_PATH = os.path.join(DATA_DIR, "catalog.sqlite3")
engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False}, pool_size=10)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


@event.listens_for(engine, "connect")
def _pragmas(dbapi_conn, _record):
    dbapi_conn.execute("PRAGMA journal_mode=WAL")


CATEGORIES = {
    "keyboards": ["Mechanical keyboard", "Low-profile keyboard", "Split keyboard", "Keycap set"],
    "audio": ["Studio headphones", "USB microphone", "DAC amplifier", "Wireless earbuds"],
    "displays": ["27in 4K monitor", "Portable monitor", "Ultrawide monitor", "Monitor arm"],
    "storage": ["NVMe SSD 2TB", "External SSD 1TB", "NAS enclosure", "USB-C hub"],
    "gpus": ["GPU 16GB", "GPU 24GB", "eGPU dock"],
}
PREFIX = {"keyboards": "kb", "audio": "au", "displays": "dp", "storage": "st", "gpus": "gpu"}


def get_session() -> Session:
    return SessionLocal()


def init_db() -> None:
    Base.metadata.create_all(engine)
    with SessionLocal() as s:
        if s.query(Product).count():
            return
        rng = random.Random(7)
        authors = ["ada", "grace", "linus", "margaret", "ken", "barbara", "dennis", "frances"]
        for cat_name, names in CATEGORIES.items():
            cat = Category(name=cat_name)
            s.add(cat)
            for i in range(40):
                base = names[i % len(names)]
                p = Product(
                    sku=f"{PREFIX[cat_name]}-{i + 1:02d}",
                    name=f"{base} {['Mk I', 'Mk II', 'Pro', 'Lite', 'Max'][i % 5]}",
                    category=cat,
                    price_cents=rng.randint(19, 1499) * 100 + 99,
                    weight_grams=rng.randint(80, 4200),
                    active=i % 13 != 0,
                )
                for _ in range(rng.randint(0, 25)):
                    p.reviews.append(Review(author=rng.choice(authors), rating=rng.choice([2, 3, 4, 4, 5, 5]), body="Solid build, would buy again." if rng.random() > 0.3 else "Arrived late, works fine."))
                s.add(p)
        s.add_all([PriceRule(category="keyboards", percent_off=10), PriceRule(category="audio", percent_off=15), PriceRule(category="gpus", percent_off=0)])
        s.commit()
