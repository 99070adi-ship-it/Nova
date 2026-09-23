import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Promotion
from app.errors import NotFoundError
from app.repositories import promotion_repo


async def list_promotions(db: AsyncSession, org_id: uuid.UUID) -> list[Promotion]:
    return await promotion_repo.list_promotions(db, org_id)


async def create_promotion(db: AsyncSession, org_id: uuid.UUID, payload) -> Promotion:
    promotion = await promotion_repo.create_promotion(db, org_id, **payload.model_dump())
    await db.commit()
    return promotion


async def update_promotion(db: AsyncSession, org_id: uuid.UUID, promotion_id: uuid.UUID, payload) -> Promotion:
    promotion = await promotion_repo.update_promotion(db, org_id, promotion_id, **payload.model_dump(exclude_unset=True))
    if promotion is None:
        raise NotFoundError("Promotion not found")
    await db.commit()
    return promotion
