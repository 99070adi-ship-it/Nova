from sqlalchemy import Boolean, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPKMixin


class Organization(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "organizations"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    # Unambiguous, DB-level tag for "this org is a demo workspace" — never inferred from slug/email
    # string matching (see alembic/versions/f4ac7eee2dba_organization_is_demo_flag.py). Real
    # signups always get the default false; only demo_service.py's seeding paths set this true.
    is_demo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
