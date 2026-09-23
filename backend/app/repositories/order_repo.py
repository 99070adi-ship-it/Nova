import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.models import Order, OrderItem, OrderStatus, PaymentStatus, ProductVariant


async def list_orders(db: AsyncSession, org_id: uuid.UUID) -> list[Order]:
    result = await db.execute(
        select(Order).where(Order.org_id == org_id).options(selectinload(Order.items)).order_by(Order.created_at.desc())
    )
    return list(result.scalars().unique().all())


async def get_order(db: AsyncSession, org_id: uuid.UUID, order_id: uuid.UUID) -> Order | None:
    result = await db.execute(
        select(Order).where(Order.id == order_id, Order.org_id == org_id).options(selectinload(Order.items))
    )
    return result.scalar_one_or_none()


async def get_variant_price(db: AsyncSession, variant_id: uuid.UUID) -> float | None:
    result = await db.execute(select(ProductVariant.price).where(ProductVariant.id == variant_id))
    return result.scalar_one_or_none()


async def get_variant_product_id(db: AsyncSession, variant_id: uuid.UUID) -> uuid.UUID | None:
    result = await db.execute(select(ProductVariant.product_id).where(ProductVariant.id == variant_id))
    return result.scalar_one_or_none()


async def create_order(db: AsyncSession, org_id: uuid.UUID, *, customer_id: uuid.UUID, items: list[dict]) -> Order:
    total = sum(item["unit_price"] * item["quantity"] for item in items)
    order = Order(
        org_id=org_id, customer_id=customer_id, status=OrderStatus.pending, payment_status=PaymentStatus.pending,
        total=total,
    )
    db.add(order)
    await db.flush()
    for item in items:
        db.add(OrderItem(order_id=order.id, variant_id=item["variant_id"], quantity=item["quantity"], unit_price=item["unit_price"]))
    await db.flush()
    return await get_order(db, org_id, order.id)
