import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPKMixin, utcnow


class InventoryLocation(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "inventory_locations"

    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)


class Inventory(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "inventory"

    variant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("product_variants.id"), nullable=False, index=True)
    location_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("inventory_locations.id"), nullable=False, index=True)
    on_hand: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    reserved: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    low_stock_threshold: Mapped[int] = mapped_column(Integer, nullable=False, default=5)


class InventoryMovement(Base, UUIDPKMixin):
    """Append-only ledger — on_hand adjustments derive from this, never edited in place."""

    __tablename__ = "inventory_movements"

    inventory_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("inventory.id"), nullable=False, index=True)
    delta: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str] = mapped_column(String(200), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
