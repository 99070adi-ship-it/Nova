import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.models import (
    GeneratedBy,
    Organization,
    StorePage,
    StoreSection,
    StoreTheme,
    StorefrontVersion,
    StorefrontVersionStatus,
)


def _full_version_query():
    return select(StorefrontVersion).options(
        selectinload(StorefrontVersion.pages).selectinload(StorePage.sections),
        selectinload(StorefrontVersion.theme),
    )


async def _get_version_full(db: AsyncSession, version_id: uuid.UUID) -> StorefrontVersion:
    result = await db.execute(_full_version_query().where(StorefrontVersion.id == version_id))
    version = result.unique().scalar_one()
    return version


async def get_draft(db: AsyncSession, org_id: uuid.UUID) -> StorefrontVersion | None:
    result = await db.execute(
        _full_version_query().where(
            StorefrontVersion.org_id == org_id, StorefrontVersion.status == StorefrontVersionStatus.draft
        )
    )
    return result.unique().scalar_one_or_none()


async def get_live(db: AsyncSession, org_id: uuid.UUID) -> StorefrontVersion | None:
    result = await db.execute(
        _full_version_query()
        .where(StorefrontVersion.org_id == org_id, StorefrontVersion.status == StorefrontVersionStatus.live)
        .order_by(StorefrontVersion.published_at.desc())
    )
    return result.unique().scalars().first()


async def get_org_by_slug(db: AsyncSession, slug: str) -> Organization | None:
    result = await db.execute(select(Organization).where(Organization.slug == slug))
    return result.scalar_one_or_none()


async def create_version(
    db: AsyncSession, org_id: uuid.UUID, *, status: StorefrontVersionStatus, generated_by: GeneratedBy,
    pages: list[dict], theme_tokens: dict, published_at=None,
) -> StorefrontVersion:
    version = StorefrontVersion(org_id=org_id, status=status, generated_by=generated_by, published_at=published_at)
    db.add(version)
    await db.flush()

    db.add(StoreTheme(storefront_version_id=version.id, tokens=theme_tokens))

    for page_data in pages:
        page = StorePage(
            storefront_version_id=version.id, slug=page_data["slug"], title=page_data["title"],
            order=page_data.get("order", 0),
        )
        db.add(page)
        await db.flush()
        for section_data in page_data.get("sections", []):
            db.add(
                StoreSection(
                    page_id=page.id, type=section_data["type"], order=section_data.get("order", 0),
                    configuration=section_data.get("configuration", {}),
                )
            )
    await db.flush()
    # Reload with pages/sections/theme eagerly loaded — the relationship collections we just
    # populated via db.add() aren't guaranteed populated on `version` in-memory (SQLAlchemy async
    # would otherwise attempt a lazy load outside the greenlet context on first attribute access
    # during Pydantic serialization, raising MissingGreenlet).
    return await _get_version_full(db, version.id)
