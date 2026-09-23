import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Customer
from app.errors import NotFoundError
from app.repositories import customer_repo


async def list_customers(db: AsyncSession, org_id: uuid.UUID) -> list[Customer]:
    return await customer_repo.list_customers(db, org_id)


async def get_customer_or_404(db: AsyncSession, org_id: uuid.UUID, customer_id: uuid.UUID) -> Customer:
    customer = await customer_repo.get_customer(db, org_id, customer_id)
    if customer is None:
        raise NotFoundError("Customer not found")
    return customer


async def create_customer(db: AsyncSession, org_id: uuid.UUID, payload) -> Customer:
    customer = await customer_repo.create_customer(db, org_id, email=payload.email, name=payload.name)
    await db.commit()
    return customer
