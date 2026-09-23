import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import AnalyticsEventType
from app.repositories import analytics_repo, product_repo


async def record_public_event(
    db: AsyncSession, org_id: uuid.UUID, *, event_type: AnalyticsEventType, product_slug: str | None = None
) -> None:
    product_id = None
    if product_slug:
        product = await product_repo.get_published_product_by_slug(db, org_id, product_slug)
        product_id = product.id if product is not None else None
    await analytics_repo.record_event(db, org_id, event_type=event_type, product_id=product_id)
    await db.commit()


async def get_sales_summary(db: AsyncSession, org_id: uuid.UUID, *, days: int = 30) -> dict:
    return await analytics_repo.get_sales_summary(db, org_id, days=days)


async def get_low_stock_products(db: AsyncSession, org_id: uuid.UUID) -> list[dict]:
    return await analytics_repo.get_low_stock_products(db, org_id)


async def get_customer_activity(db: AsyncSession, org_id: uuid.UUID, *, inactive_days: int = 30) -> list[dict]:
    return await analytics_repo.get_customer_activity(db, org_id, inactive_days=inactive_days)
