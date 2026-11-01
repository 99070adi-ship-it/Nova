import enum
import uuid

from sqlalchemy import ForeignKey, Integer, LargeBinary, String, Text
from sqlalchemy.dialects.postgresql import ENUM as PGEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPKMixin


class StudioImageKind(str, enum.Enum):
    generated = "generated"
    edited = "edited"
    upload = "upload"  # the user's original, kept so a before/after comparison is always possible


class StudioImage(Base, UUIDPKMixin, TimestampMixin):
    """Photo Studio output. Only SUCCESSFUL results are ever stored: a failed or blocked request leaves no row, so the daily
    usage count and the history never include something that was not actually produced. Bytes live in the database so the
    app needs no shared disk to be deployed (fine at demo scale; move to object storage before real scale)."""

    __tablename__ = "studio_images"

    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), nullable=False, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    kind: Mapped[StudioImageKind] = mapped_column(
        PGEnum(StudioImageKind, name="studio_image_kind", values_callable=lambda e: [m.value for m in e]), nullable=False
    )
    prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    style: Mapped[str | None] = mapped_column(String(40), nullable=True)
    provider: Mapped[str | None] = mapped_column(String(40), nullable=True)
    model: Mapped[str | None] = mapped_column(String(120), nullable=True)
    mime_type: Mapped[str] = mapped_column(String(40), nullable=False)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    data: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    source_image_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("studio_images.id", ondelete="SET NULL"), nullable=True)
