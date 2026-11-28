import pytest

sqlalchemy = pytest.importorskip("sqlalchemy")

from sqlalchemy import ForeignKey, String, create_engine, select, text  # noqa: E402
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship  # noqa: E402

import stacklens  # noqa: E402
from stacklens.integrations.sqlalchemy import instrument_sqlalchemy  # noqa: E402
from conftest import assert_valid_trace, span, spans_by_name  # noqa: E402


class Base(DeclarativeBase):
    pass


class Customer(Base):
    __tablename__ = "customers"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(100))
    password_hash: Mapped[str] = mapped_column(String(100), default="x")
    orders: Mapped[list["Order"]] = relationship(back_populates="customer")


class Order(Base):
    __tablename__ = "orders"
    id: Mapped[int] = mapped_column(primary_key=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"))
    total: Mapped[int]
    customer: Mapped[Customer] = relationship(back_populates="orders")


engine = create_engine("sqlite://")
Base.metadata.create_all(engine)
with Session(engine) as s:
    s.add_all([Customer(id=i, email=f"c{i}@shop.test", orders=[Order(total=10 * i), Order(total=5)]) for i in range(1, 16)])
    s.commit()
instrument_sqlalchemy()


class CustomerRepository:
    def __init__(self, session):
        self.session = session

    def by_email(self, email):
        return self.session.scalars(select(Customer).where(Customer.email == email)).first()

    def all_with_orders_n_plus_one(self):
        out = []
        for c in self.session.scalars(select(Customer)).all():
            out.append((c.email, sum(o.total for o in c.orders)))  # lazy load per customer
        return out


stacklens.instrument_class(CustomerRepository)


def test_orm_queries_become_sql_spans(captured):
    with Session(engine) as session, stacklens.trace("job"):
        c = CustomerRepository(session).by_email("c3@shop.test")
    assert c.id == 3
    t = captured.one()
    assert_valid_trace(t)
    q = span(t, "SQL.query")
    assert q["kind"] == "db" and q["className"] == "SQL" and q["method"] == "query" and q["params"] == ["query", "parameters"]
    assert q["args"][0].startswith("SELECT customers.id, customers.email") and "WHERE customers.email = ?" in q["args"][0]
    assert q["args"][1] == ["c3@shop.test"]
    assert q["parentId"] == span(t, "CustomerRepository.by_email")["id"]
    repo = span(t, "CustomerRepository.by_email")
    assert repo["result"]["$class"] == "Customer" and repo["result"]["password_hash"] == "x"
    assert repo["resultType"].startswith("Customer { ")


def test_n_plus_one_collapses(captured):
    with Session(engine) as session, stacklens.trace("job"):
        rows = CustomerRepository(session).all_with_orders_n_plus_one()
    assert len(rows) == 15
    t = captured.one()
    sql = spans_by_name(t, "SQL.query")
    individual = [s for s in sql if "collapsed" not in s]
    agg = next(s for s in sql if "collapsed" in s)
    assert len(individual) == 10 and agg["collapsed"]["count"] == 6  # 1 list query + 15 lazy loads = 16
    assert len(t["spans"]) < 20


def test_sql_errors_and_dml_row_counts(captured):
    with engine.begin() as conn, stacklens.trace("job"):
        conn.execute(text("UPDATE orders SET total = total + 1 WHERE total = 5"))
        with pytest.raises(sqlalchemy.exc.OperationalError):
            conn.execute(text("SELECT * FROM no_such_table"))
    t = captured.one()
    update, bad = spans_by_name(t, "SQL.query")[:2]
    assert update["result"] == {"rowCount": 15}
    assert bad["status"] == "error" and bad["error"]["name"] == "OperationalError" and "no_such_table" in bad["error"]["message"]


def test_single_engine_instrumentation_is_idempotent():
    e2 = create_engine("sqlite://")
    instrument_sqlalchemy(e2)
    instrument_sqlalchemy(e2)


async def test_asyncio_engine(captured):
    pytest.importorskip("greenlet")
    pytest.importorskip("aiosqlite")
    from sqlalchemy.ext.asyncio import create_async_engine

    aengine = create_async_engine("sqlite+aiosqlite://")
    instrument_sqlalchemy(aengine)

    @stacklens.traced
    async def count_rows():
        async with aengine.connect() as conn:
            return (await conn.execute(text("SELECT 41 + 1 AS answer"))).scalar_one()

    async with stacklens.trace("job"):
        assert await count_rows() == 42
    t = captured.one()
    q = span(t, "SQL.query")
    assert q["parentId"] == span(t, "test_sqlalchemy.count_rows")["id"] and q["args"][0] == "SELECT 41 + 1 AS answer"
    await aengine.dispose()
