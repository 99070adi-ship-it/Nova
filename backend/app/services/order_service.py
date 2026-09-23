import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Order
from app.errors import NotFoundError, ValidationDomainError
from app.repositories import order_repo


async def list_orders(db: AsyncSession, org_id: uuid.UUID) -> list[Order]:
    return await order_repo.list_orders(db, org_id)


async def get_order_or_404(db: AsyncSession, org_id: uuid.UUID, order_id: uuid.UUID) -> Order:
    order = await order_repo.get_order(db, org_id, order_id)
    if order is None:
        raise NotFoundError("Order not found")
    return order


async def create_order(db: AsyncSession, org_id: uuid.UUID, payload) -> Order:
    items = []
    for item in payload.items:
        price = await order_repo.get_variant_price(db, item.variant_id)
        if price is None:
            raise ValidationDomainError(f"Unknown variant_id {item.variant_id}")
        items.append({"variant_id": item.variant_id, "quantity": item.quantity, "unit_price": price})
    order = await order_repo.create_order(db, org_id, customer_id=payload.customer_id, items=items)
    await db.commit()
    return order
