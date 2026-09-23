import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import ENUM as PGEnum
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPKMixin


class StorefrontVersionStatus(str, enum.Enum):
    draft = "draft"
    live = "live"


class GeneratedBy(str, enum.Enum):
    ai = "ai"
    owner = "owner"
    mixed = "mixed"


class StorefrontVersion(Base, UUIDPKMixin, TimestampMixin):
    """Publishing copies the current draft's section tree into a new immutable `live` version —
    always a rollback point, and the basis for before/after diffing (ARCHITECTURE.md "Store
    Builder")."""

    __tablename__ = "storefront_versions"

    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), nullable=False, index=True)
    status: Mapped[StorefrontVersionStatus] = mapped_column(
        PGEnum(StorefrontVersionStatus, name="storefront_version_status", values_callable=lambda e: [m.value for m in e]),
        nullable=False,
        default=StorefrontVersionStatus.draft,
    )
    generated_by: Mapped[GeneratedBy] = mapped_column(
        PGEnum(GeneratedBy, name="generated_by", values_callable=lambda e: [m.value for m in e]),
        nullable=False,
        default=GeneratedBy.owner,
    )
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    pages: Mapped[list["StorePage"]] = relationship(back_populates="storefront_version", cascade="all, delete-orphan")
    theme: Mapped["StoreTheme"] = relationship(back_populates="storefront_version", uselist=False, cascade="all, delete-orphan")


class StorePage(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "store_pages"

    storefront_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("storefront_versions.id"), nullable=False, index=True
    )
    slug: Mapped[str] = mapped_column(String(200), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    storefront_version: Mapped["StorefrontVersion"] = relationship(back_populates="pages")
    sections: Mapped[list["StoreSection"]] = relationship(back_populates="page", cascade="all, delete-orphan")


class StoreSection(Base, UUIDPKMixin, TimestampMixin):
    """`configuration` is section-type-specific JSON the renderer interprets (hero, product_grid,
    featured_collection, brand_story, promo_banner, …) — never markup. The one storefront
    renderer is the only thing that ever turns this into HTML, for both the live site and the
    admin preview pane."""

    __tablename__ = "store_sections"

    page_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("store_pages.id"), nullable=False, index=True)
    type: Mapped[str] = mapped_column(String(50), nullable=False)
    order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    configuration: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    page: Mapped["StorePage"] = relationship(back_populates="sections")


class StoreTheme(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "store_themes"

    storefront_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("storefront_versions.id"), nullable=False, unique=True, index=True
    )
    tokens: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    storefront_version: Mapped["StorefrontVersion"] = relationship(back_populates="theme")
