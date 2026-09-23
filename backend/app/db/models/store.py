import uuid

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPKMixin


class Store(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "stores"

    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), nullable=False, index=True, unique=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="USD")
    domain_placeholder: Mapped[str | None] = mapped_column(String(200), nullable=True)


class BrandProfile(Base, UUIDPKMixin, TimestampMixin):
    """The persistent brand context every content/storefront-generation agent call reads from
    (ARCHITECTURE.md "Brand intelligence & context building"). Never passed whole into a model
    call — agents access it through scoped read tools that select only relevant fields."""

    __tablename__ = "brand_profiles"

    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), nullable=False, index=True, unique=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    sells_what: Mapped[str | None] = mapped_column(Text, nullable=True)
    target_customer: Mapped[str | None] = mapped_column(Text, nullable=True)
    positioning: Mapped[str | None] = mapped_column(Text, nullable=True)
    vibe_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    tone: Mapped[str | None] = mapped_column(String(100), nullable=True)
    preferred_visual_direction: Mapped[str | None] = mapped_column(Text, nullable=True)
    preferred_colors: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    typography_preference: Mapped[str | None] = mapped_column(String(200), nullable=True)
    price_positioning: Mapped[str | None] = mapped_column(String(100), nullable=True)
    brand_values: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    content_style: Mapped[str | None] = mapped_column(Text, nullable=True)
    inspiration_reference_text: Mapped[str | None] = mapped_column(Text, nullable=True)
