import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import BrandProfile, ProductDraft, ProductDraftStatus, StoreCreationSession, StoreCreationStatus


async def get_current_session(db: AsyncSession, org_id: uuid.UUID) -> StoreCreationSession | None:
    result = await db.execute(
        select(StoreCreationSession)
        .where(StoreCreationSession.org_id == org_id, StoreCreationSession.status != StoreCreationStatus.completed)
        .order_by(StoreCreationSession.created_at.desc())
    )
    return result.scalars().first()


async def create_session(db: AsyncSession, org_id: uuid.UUID) -> StoreCreationSession:
    session = StoreCreationSession(org_id=org_id, status=StoreCreationStatus.brand_input, current_step="brand_input")
    db.add(session)
    await db.flush()
    return session


async def get_brand_profile(db: AsyncSession, org_id: uuid.UUID) -> BrandProfile | None:
    result = await db.execute(select(BrandProfile).where(BrandProfile.org_id == org_id))
    return result.scalar_one_or_none()


async def upsert_brand_profile(db: AsyncSession, org_id: uuid.UUID, **fields) -> BrandProfile:
    profile = await get_brand_profile(db, org_id)
    if profile is None:
        profile = BrandProfile(org_id=org_id, **fields)
        db.add(profile)
    else:
        for key, value in fields.items():
            setattr(profile, key, value)
    await db.flush()
    return profile


async def list_product_drafts(db: AsyncSession, org_id: uuid.UUID, session_id: uuid.UUID) -> list[ProductDraft]:
    result = await db.execute(
        select(ProductDraft)
        .where(ProductDraft.org_id == org_id, ProductDraft.session_id == session_id)
        .order_by(ProductDraft.created_at.asc())
    )
    return list(result.scalars().all())


async def list_product_drafts_by_org(db: AsyncSession, org_id: uuid.UUID) -> list[ProductDraft]:
    """Across every session, not just the current one — onboarding progress (ARCHITECTURE.md
    "Onboarding — the NOVA Guide") must still see a draft's outcome after its session completes."""

    result = await db.execute(
        select(ProductDraft).where(ProductDraft.org_id == org_id).order_by(ProductDraft.created_at.asc())
    )
    return list(result.scalars().all())


async def get_product_draft(db: AsyncSession, org_id: uuid.UUID, draft_id: uuid.UUID) -> ProductDraft | None:
    result = await db.execute(select(ProductDraft).where(ProductDraft.id == draft_id, ProductDraft.org_id == org_id))
    return result.scalar_one_or_none()


async def create_product_draft(
    db: AsyncSession, org_id: uuid.UUID, session_id: uuid.UUID, *, fields: dict, field_status: dict,
    source_image_refs: list[str] | None,
) -> ProductDraft:
    draft = ProductDraft(
        org_id=org_id, session_id=session_id, status=ProductDraftStatus.owner_reviewing, fields=fields,
        field_status=field_status, source_image_refs=source_image_refs,
    )
    db.add(draft)
    await db.flush()
    return draft
