import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import ENUM as PGEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPKMixin, utcnow


class OrderStatus(str, enum.Enum):
    pending = "pending"
    fulfilled = "fulfilled"
    cancelled = "cancelled"
    refunded = "refunded"


class PaymentStatus(str, enum.Enum):
    pending = "pending"
    paid = "paid"
    refunded = "refunded"


class Order(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "orders"

    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), nullable=False, index=True)
    customer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("customers.id"), nullable=False, index=True)
    status: Mapped[OrderStatus] = mapped_column(
        PGEnum(OrderStatus, name="order_status", values_callable=lambda e: [m.value for m in e]),
        nullable=False,
        default=OrderStatus.pending,
    )
    payment_status: Mapped[PaymentStatus] = mapped_column(
        PGEnum(PaymentStatus, name="payment_status", values_callable=lambda e: [m.value for m in e]),
        nullable=False,
        default=PaymentStatus.pending,
    )
    total: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)

    items: Mapped[list["OrderItem"]] = relationship(back_populates="order", cascade="all, delete-orphan")


class OrderItem(Base, UUIDPKMixin):
    __tablename__ = "order_items"

    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.id"), nullable=False, index=True)
    variant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("product_variants.id"), nullable=False, index=True)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_price: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)

    order: Mapped["Order"] = relationship(back_populates="items")


class CartEventType(str, enum.Enum):
    added = "added"
    removed = "removed"
    abandoned = "abandoned"


class CartEvent(Base, UUIDPKMixin):
    __tablename__ = "cart_events"

    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), nullable=False, index=True)
    customer_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("customers.id"), nullable=True, index=True)
    variant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("product_variants.id"), nullable=False, index=True)
    event: Mapped[CartEventType] = mapped_column(
        PGEnum(CartEventType, name="cart_event_type", values_callable=lambda e: [m.value for m in e]), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class CheckoutRequest(Base, UUIDPKMixin):
    """One row per storefront checkout attempt that produced an order. The client-chosen idempotency key is
    unique per store, so a double-click, a retry after a dropped response, or a replayed request returns the
    SAME order instead of creating a second one."""

    __tablename__ = "checkout_requests"
    __table_args__ = (UniqueConstraint("org_id", "idempotency_key", name="uq_checkout_requests_org_id_key"),)

    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), nullable=False, index=True)
    idempotency_key: Mapped[str] = mapped_column(String(80), nullable=False)
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
