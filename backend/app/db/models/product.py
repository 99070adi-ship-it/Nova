import enum
import uuid

from sqlalchemy import ForeignKey, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import ENUM as PGEnum
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPKMixin


class ProductStatus(str, enum.Enum):
    draft = "draft"
    published = "published"
    archived = "archived"


class Product(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "products"

    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    slug: Mapped[str] = mapped_column(String(300), nullable=False)
    status: Mapped[ProductStatus] = mapped_column(
        PGEnum(ProductStatus, name="product_status", values_callable=lambda e: [m.value for m in e]),
        nullable=False,
        default=ProductStatus.draft,
    )
    category: Mapped[str | None] = mapped_column(String(200), nullable=True)
    tags: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    seo_title: Mapped[str | None] = mapped_column(String(300), nullable=True)
    seo_description: Mapped[str | None] = mapped_column(Text, nullable=True)

    variants: Mapped[list["ProductVariant"]] = relationship(back_populates="product", cascade="all, delete-orphan")


class ProductVariant(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "product_variants"
    # A SKU identifies a variant within ONE store; two tenants may use the same SKU.
    __table_args__ = (UniqueConstraint("org_id", "sku", name="uq_product_variants_org_id_sku"),)

    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), nullable=False, index=True)
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)
    sku: Mapped[str] = mapped_column(String(100), nullable=False)
    price: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    cost: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    attributes: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    product: Mapped["Product"] = relationship(back_populates="variants")


class ProductDraftStatus(str, enum.Enum):
    pending_generation = "pending_generation"
    generated = "generated"
    owner_reviewing = "owner_reviewing"
    accepted = "accepted"
    rejected = "rejected"


class ProductDraft(Base, UUIDPKMixin, TimestampMixin):
    """AI-generated product content lives here first — never directly in Product. Promoting a
    draft to a real Product is an explicit owner action (accept), never automatic
    (ARCHITECTURE.md "Product ingestion & AI product content workflow")."""

    __tablename__ = "product_drafts"

    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), nullable=False, index=True)
    session_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("store_creation_sessions.id"), nullable=True, index=True
    )
    status: Mapped[ProductDraftStatus] = mapped_column(
        PGEnum(ProductDraftStatus, name="product_draft_status", values_callable=lambda e: [m.value for m in e]),
        nullable=False,
        default=ProductDraftStatus.pending_generation,
    )
    # fields: {title, description, price, sku, category, tags, seo_title, seo_description, ...}
    fields: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    # field_status: {"title": "known"|"suggested"|"requires_confirmation", ...} — one entry per key
    # in `fields`, never overwritten from "known" by generation.
    field_status: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    source_image_refs: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    accepted_product_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("products.id"), nullable=True)


class ProductImageRole(str, enum.Enum):
    canonical = "canonical"
    generated = "generated"


class ProductImage(Base, UUIDPKMixin, TimestampMixin):
    """The canonical image is never overwritten by AI generation — only an explicit owner upload
    can replace it. Generated rows always point back at their source via source_image_id."""

    __tablename__ = "product_images"

    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)
    url: Mapped[str] = mapped_column(String(1000), nullable=False)
    role: Mapped[ProductImageRole] = mapped_column(
        PGEnum(ProductImageRole, name="product_image_role", values_callable=lambda e: [m.value for m in e]),
        nullable=False,
    )
    alt_text: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_ai_generated: Mapped[bool] = mapped_column(nullable=False, default=False)
    provider: Mapped[str | None] = mapped_column(String(50), nullable=True)
    model: Mapped[str | None] = mapped_column(String(100), nullable=True)
    prompt_metadata: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    environment: Mapped[str | None] = mapped_column(String(100), nullable=True)
    mood: Mapped[str | None] = mapped_column(String(100), nullable=True)
    source_image_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("product_images.id"), nullable=True)
