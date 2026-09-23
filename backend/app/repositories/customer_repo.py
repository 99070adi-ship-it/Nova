import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Customer


async def list_customers(db: AsyncSession, org_id: uuid.UUID) -> list[Customer]:
    result = await db.execute(select(Customer).where(Customer.org_id == org_id).order_by(Customer.created_at.desc()))
    return list(result.scalars().all())


async def get_customer(db: AsyncSession, org_id: uuid.UUID, customer_id: uuid.UUID) -> Customer | None:
    result = await db.execute(select(Customer).where(Customer.id == customer_id, Customer.org_id == org_id))
    return result.scalar_one_or_none()


async def create_customer(db: AsyncSession, org_id: uuid.UUID, *, email: str, name: str) -> Customer:
    customer = Customer(org_id=org_id, email=email, name=name)
    db.add(customer)
    await db.flush()
    return customer
