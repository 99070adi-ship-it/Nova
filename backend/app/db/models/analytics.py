import enum
import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Numeric
from sqlalchemy.dialects.postgresql import ENUM as PGEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, UUIDPKMixin, utcnow


class AnalyticsEventType(str, enum.Enum):
    page_view = "page_view"
    product_view = "product_view"
    collection_view = "collection_view"
    search = "search"
    add_to_cart = "add_to_cart"
    remove_from_cart = "remove_from_cart"
    checkout_start = "checkout_start"
    purchase = "purchase"
    wishlist_add = "wishlist_add"
    promotion_click = "promotion_click"
    hero_click = "hero_click"
    collection_click = "collection_click"
    section_click = "section_click"


class AnalyticsEvent(Base, UUIDPKMixin):
    """Extensible event log (ARCHITECTURE.md "Analytics"). Prototype 1 wires page_view,
    product_view, collection_view, add_to_cart, checkout_start, purchase, hero_click — the rest
    are typed and ready for later phases to emit."""

    __tablename__ = "analytics_events"

    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), nullable=False, index=True)
    event_type: Mapped[AnalyticsEventType] = mapped_column(
        PGEnum(AnalyticsEventType, name="analytics_event_type", values_callable=lambda e: [m.value for m in e]), nullable=False
    )
    product_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("products.id"), nullable=True, index=True)
    collection_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("collections.id"), nullable=True)
    page_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    section_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    customer_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("customers.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class SalesMetricDaily(Base, UUIDPKMixin):
    """Pre-aggregated rollup — agents query this, never raw events, so every AI call isn't an
    ad hoc aggregation over the full event log (ARCHITECTURE.md "Analytics")."""

    __tablename__ = "sales_metrics_daily"

    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), nullable=False, index=True)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    product_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("products.id"), nullable=True)
    revenue: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False, default=0)
    orders: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    units: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
