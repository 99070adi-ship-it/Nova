import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import AuthContext, require_any_role
from app.db.session import get_db
from app.schemas.storefront import DiffOut, SectionCreate, SectionUpdate, StorefrontVersionOut, ThemeUpdate
from app.services import storefront_service

router = APIRouter()


@router.get("/draft", response_model=StorefrontVersionOut)
async def get_draft(ctx: AuthContext = Depends(require_any_role), db: AsyncSession = Depends(get_db)) -> StorefrontVersionOut:
    draft = await storefront_service.get_or_create_draft(db, ctx.org_id)
    return StorefrontVersionOut.from_version(draft)


@router.get("/live", response_model=StorefrontVersionOut)
async def get_live(ctx: AuthContext = Depends(require_any_role), db: AsyncSession = Depends(get_db)) -> StorefrontVersionOut:
    live = await storefront_service.get_live_or_404(db, ctx.org_id)
    return StorefrontVersionOut.from_version(live)


@router.post("/publish", response_model=StorefrontVersionOut)
async def publish(ctx: AuthContext = Depends(require_any_role), db: AsyncSession = Depends(get_db)) -> StorefrontVersionOut:
    live = await storefront_service.publish(db, ctx.org_id)
    return StorefrontVersionOut.from_version(live)


@router.get("/diff", response_model=DiffOut)
async def diff_draft_vs_live(ctx: AuthContext = Depends(require_any_role), db: AsyncSession = Depends(get_db)) -> DiffOut:
    changes = await storefront_service.diff_draft_against_live(db, ctx.org_id)
    return DiffOut(changes=changes)


@router.post("/sections", response_model=StorefrontVersionOut, status_code=201)
async def add_section(
    payload: SectionCreate, ctx: AuthContext = Depends(require_any_role), db: AsyncSession = Depends(get_db)
) -> StorefrontVersionOut:
    await storefront_service.add_section(
        db, ctx.org_id, payload.page_id, type=payload.type, order=payload.order, configuration=payload.configuration
    )
    draft = await storefront_service.get_or_create_draft(db, ctx.org_id)
    return StorefrontVersionOut.from_version(draft)


@router.patch("/sections/{section_id}", response_model=StorefrontVersionOut)
async def update_section(
    section_id: uuid.UUID, payload: SectionUpdate, ctx: AuthContext = Depends(require_any_role),
    db: AsyncSession = Depends(get_db),
) -> StorefrontVersionOut:
    await storefront_service.update_section(db, ctx.org_id, section_id, order=payload.order, configuration=payload.configuration)
    draft = await storefront_service.get_or_create_draft(db, ctx.org_id)
    return StorefrontVersionOut.from_version(draft)


@router.delete("/sections/{section_id}", response_model=StorefrontVersionOut)
async def delete_section(
    section_id: uuid.UUID, ctx: AuthContext = Depends(require_any_role), db: AsyncSession = Depends(get_db)
) -> StorefrontVersionOut:
    await storefront_service.delete_section(db, ctx.org_id, section_id)
    draft = await storefront_service.get_or_create_draft(db, ctx.org_id)
    return StorefrontVersionOut.from_version(draft)


@router.patch("/theme", response_model=StorefrontVersionOut)
async def update_theme(
    payload: ThemeUpdate, ctx: AuthContext = Depends(require_any_role), db: AsyncSession = Depends(get_db)
) -> StorefrontVersionOut:
    tokens = {k: v for k, v in payload.model_dump().items() if v is not None}
    draft = await storefront_service.update_theme(db, ctx.org_id, tokens)
    return StorefrontVersionOut.from_version(draft)
