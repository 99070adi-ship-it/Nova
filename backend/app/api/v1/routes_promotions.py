import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import AuthContext, require_any_role
from app.db.session import get_db
from app.schemas.promotion import PromotionCreate, PromotionOut, PromotionUpdate
from app.services import promotion_service

router = APIRouter()


@router.get("", response_model=list[PromotionOut])
async def list_promotions(ctx: AuthContext = Depends(require_any_role), db: AsyncSession = Depends(get_db)) -> list[PromotionOut]:
    promotions = await promotion_service.list_promotions(db, ctx.org_id)
    return [PromotionOut.model_validate(p) for p in promotions]


@router.post("", response_model=PromotionOut, status_code=201)
async def create_promotion(
    payload: PromotionCreate, ctx: AuthContext = Depends(require_any_role), db: AsyncSession = Depends(get_db)
) -> PromotionOut:
    promotion = await promotion_service.create_promotion(db, ctx.org_id, payload)
    return PromotionOut.model_validate(promotion)


@router.patch("/{promotion_id}", response_model=PromotionOut)
async def update_promotion(
    promotion_id: uuid.UUID, payload: PromotionUpdate, ctx: AuthContext = Depends(require_any_role),
    db: AsyncSession = Depends(get_db),
) -> PromotionOut:
    promotion = await promotion_service.update_promotion(db, ctx.org_id, promotion_id, payload)
    return PromotionOut.model_validate(promotion)
