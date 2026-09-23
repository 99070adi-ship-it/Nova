from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import AuthContext, require_any_role
from app.db.session import get_db
from app.schemas.storefront import StorefrontVersionOut
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
