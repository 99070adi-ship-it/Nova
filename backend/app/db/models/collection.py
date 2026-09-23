import enum
import uuid

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import ENUM as PGEnum
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPKMixin


class Collection(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "collections"

    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    slug: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)


class CollectionProductCreatedBy(str, enum.Enum):
    ai = "ai"
    owner = "owner"


class CollectionProduct(Base, UUIDPKMixin):
    __tablename__ = "collection_products"

    collection_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("collections.id"), nullable=False, index=True)
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)
    created_by: Mapped[CollectionProductCreatedBy] = mapped_column(
        PGEnum(CollectionProductCreatedBy, name="collection_product_created_by", values_callable=lambda e: [m.value for m in e]),
        nullable=False,
        default=CollectionProductCreatedBy.owner,
    )
    rule_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
