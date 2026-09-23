import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Promotion


async def list_promotions(db: AsyncSession, org_id: uuid.UUID) -> list[Promotion]:
    result = await db.execute(select(Promotion).where(Promotion.org_id == org_id).order_by(Promotion.created_at.desc()))
    return list(result.scalars().all())


async def get_promotion(db: AsyncSession, org_id: uuid.UUID, promotion_id: uuid.UUID) -> Promotion | None:
    result = await db.execute(select(Promotion).where(Promotion.id == promotion_id, Promotion.org_id == org_id))
    return result.scalar_one_or_none()


async def create_promotion(db: AsyncSession, org_id: uuid.UUID, **fields) -> Promotion:
    promotion = Promotion(org_id=org_id, **fields)
    db.add(promotion)
    await db.flush()
    return promotion


async def update_promotion(db: AsyncSession, org_id: uuid.UUID, promotion_id: uuid.UUID, **fields) -> Promotion | None:
    promotion = await get_promotion(db, org_id, promotion_id)
    if promotion is None:
        return None
    for key, value in fields.items():
        if value is not None:
            setattr(promotion, key, value)
    await db.flush()
    return promotion
