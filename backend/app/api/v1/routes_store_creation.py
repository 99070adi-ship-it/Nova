import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import AuthContext, require_owner
from app.db.session import get_db
from app.schemas.store_creation import BrandInput, ProductDraftInput, ProductDraftOut, SessionOut
from app.services import product_agent_service, store_creation_service

router = APIRouter()


@router.post("/start", response_model=SessionOut)
async def start(ctx: AuthContext = Depends(require_owner), db: AsyncSession = Depends(get_db)) -> SessionOut:
    session = await store_creation_service.start_or_get_session(db, ctx.org_id)
    return SessionOut.model_validate(session)


@router.get("/current", response_model=SessionOut)
async def current(ctx: AuthContext = Depends(require_owner), db: AsyncSession = Depends(get_db)) -> SessionOut:
    session = await store_creation_service.get_current_session_or_404(db, ctx.org_id)
    return SessionOut.model_validate(session)


@router.put("/brand-input", response_model=SessionOut)
async def brand_input(
    payload: BrandInput, ctx: AuthContext = Depends(require_owner), db: AsyncSession = Depends(get_db)
) -> SessionOut:
    session = await store_creation_service.submit_brand_input(db, ctx.org_id, payload)
    return SessionOut.model_validate(session)


@router.get("/product-drafts", response_model=list[ProductDraftOut])
async def list_product_drafts(
    ctx: AuthContext = Depends(require_owner), db: AsyncSession = Depends(get_db)
) -> list[ProductDraftOut]:
    drafts = await store_creation_service.list_product_drafts(db, ctx.org_id)
    return [ProductDraftOut.model_validate(d) for d in drafts]


@router.post("/product-drafts", response_model=ProductDraftOut, status_code=201)
async def create_product_draft(
    payload: ProductDraftInput, ctx: AuthContext = Depends(require_owner), db: AsyncSession = Depends(get_db)
) -> ProductDraftOut:
    draft = await store_creation_service.create_product_draft(db, ctx.org_id, payload)
    return ProductDraftOut.model_validate(draft)


@router.post("/product-drafts/{draft_id}/generate", response_model=ProductDraftOut)
async def generate_product_draft_content(
    draft_id: uuid.UUID, ctx: AuthContext = Depends(require_owner), db: AsyncSession = Depends(get_db)
) -> ProductDraftOut:
    draft = await product_agent_service.generate_draft_content(db, ctx.org_id, draft_id)
    return ProductDraftOut.model_validate(draft)


@router.post("/product-drafts/{draft_id}/accept", response_model=ProductDraftOut)
async def accept_product_draft(
    draft_id: uuid.UUID, ctx: AuthContext = Depends(require_owner), db: AsyncSession = Depends(get_db)
) -> ProductDraftOut:
    draft = await store_creation_service.accept_product_draft(db, ctx.org_id, draft_id)
    return ProductDraftOut.model_validate(draft)


@router.post("/product-drafts/{draft_id}/reject", response_model=ProductDraftOut)
async def reject_product_draft(
    draft_id: uuid.UUID, ctx: AuthContext = Depends(require_owner), db: AsyncSession = Depends(get_db)
) -> ProductDraftOut:
    draft = await store_creation_service.reject_product_draft(db, ctx.org_id, draft_id)
    return ProductDraftOut.model_validate(draft)


@router.post("/generate-storefront", response_model=SessionOut)
async def generate_storefront(ctx: AuthContext = Depends(require_owner), db: AsyncSession = Depends(get_db)) -> SessionOut:
    session = await store_creation_service.generate_storefront(db, ctx.org_id)
    return SessionOut.model_validate(session)
