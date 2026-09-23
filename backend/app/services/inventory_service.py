import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Inventory
from app.errors import NotFoundError, ValidationDomainError
from app.repositories import inventory_repo


async def list_inventory(db: AsyncSession, org_id: uuid.UUID) -> list[dict]:
    return await inventory_repo.list_inventory(db, org_id)


async def adjust_inventory(db: AsyncSession, org_id: uuid.UUID, inventory_id: uuid.UUID, *, delta: int, reason: str) -> Inventory:
    inventory = await inventory_repo.get_inventory_scoped(db, org_id, inventory_id)
    if inventory is None:
        raise NotFoundError("Inventory row not found")
    if inventory.on_hand + delta < 0:
        raise ValidationDomainError("Adjustment would make on_hand negative")
    inventory = await inventory_repo.apply_movement(db, inventory, delta=delta, reason=reason)
    await db.commit()
    return inventory
