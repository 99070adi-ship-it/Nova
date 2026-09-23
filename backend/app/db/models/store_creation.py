import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import ENUM as PGEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPKMixin


class StoreCreationStatus(str, enum.Enum):
    brand_input = "brand_input"
    product_input = "product_input"
    generating_products = "generating_products"
    generating_storefront = "generating_storefront"
    ready_for_review = "ready_for_review"
    completed = "completed"


class StoreCreationSession(Base, UUIDPKMixin, TimestampMixin):
    """The persisted state machine behind "Create My Store" — resumable, auditable, not just UI
    wizard state (ARCHITECTURE.md "Create My Store — onboarding workflow")."""

    __tablename__ = "store_creation_sessions"

    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), nullable=False, index=True)
    status: Mapped[StoreCreationStatus] = mapped_column(
        PGEnum(StoreCreationStatus, name="store_creation_status", values_callable=lambda e: [m.value for m in e]),
        nullable=False,
        default=StoreCreationStatus.brand_input,
    )
    current_step: Mapped[str | None] = mapped_column(String(100), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
