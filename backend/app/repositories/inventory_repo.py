import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Inventory, InventoryLocation, InventoryMovement, Product, ProductVariant


async def get_or_create_default_location(db: AsyncSession, org_id: uuid.UUID) -> InventoryLocation:
    result = await db.execute(select(InventoryLocation).where(InventoryLocation.org_id == org_id))
    location = result.scalars().first()
    if location is not None:
        return location
    location = InventoryLocation(org_id=org_id, name="Main Warehouse")
    db.add(location)
    await db.flush()
    return location


async def list_inventory(db: AsyncSession, org_id: uuid.UUID) -> list[dict]:
    result = await db.execute(
        select(Inventory, ProductVariant, Product)
        .join(ProductVariant, Inventory.variant_id == ProductVariant.id)
        .join(Product, ProductVariant.product_id == Product.id)
        .where(Product.org_id == org_id)
        .order_by(Inventory.on_hand.asc())
    )
    rows = []
    for inv, variant, product in result.all():
        rows.append(
            {
                "id": inv.id, "variant_id": inv.variant_id, "location_id": inv.location_id,
                "on_hand": inv.on_hand, "reserved": inv.reserved, "low_stock_threshold": inv.low_stock_threshold,
                "sku": variant.sku, "product_id": product.id, "product_title": product.title,
            }
        )
    return rows


async def get_inventory_scoped(db: AsyncSession, org_id: uuid.UUID, inventory_id: uuid.UUID) -> Inventory | None:
    result = await db.execute(
        select(Inventory)
        .join(ProductVariant, Inventory.variant_id == ProductVariant.id)
        .join(Product, ProductVariant.product_id == Product.id)
        .where(Inventory.id == inventory_id, Product.org_id == org_id)
    )
    return result.scalar_one_or_none()


async def create_inventory_row(
    db: AsyncSession, *, variant_id: uuid.UUID, location_id: uuid.UUID, on_hand: int, low_stock_threshold: int
) -> Inventory:
    inv = Inventory(variant_id=variant_id, location_id=location_id, on_hand=on_hand, low_stock_threshold=low_stock_threshold)
    db.add(inv)
    await db.flush()
    return inv


async def apply_movement(db: AsyncSession, inventory: Inventory, *, delta: int, reason: str) -> Inventory:
    inventory.on_hand = inventory.on_hand + delta
    db.add(InventoryMovement(inventory_id=inventory.id, delta=delta, reason=reason))
    await db.flush()
    return inventory
