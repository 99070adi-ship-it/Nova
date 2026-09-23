import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import AuthContext, require_any_role
from app.db.session import get_db
from app.schemas.inventory import InventoryAdjust, InventoryOut
from app.services import inventory_service

router = APIRouter()


@router.get("", response_model=list[InventoryOut])
async def list_inventory(ctx: AuthContext = Depends(require_any_role), db: AsyncSession = Depends(get_db)) -> list[InventoryOut]:
    rows = await inventory_service.list_inventory(db, ctx.org_id)
    return [InventoryOut.model_validate(r) for r in rows]


@router.post("/{inventory_id}/adjust", response_model=InventoryOut)
async def adjust_inventory(
    inventory_id: uuid.UUID, payload: InventoryAdjust, ctx: AuthContext = Depends(require_any_role),
    db: AsyncSession = Depends(get_db),
) -> InventoryOut:
    inv = await inventory_service.adjust_inventory(db, ctx.org_id, inventory_id, delta=payload.delta, reason=payload.reason)
    rows = await inventory_service.list_inventory(db, ctx.org_id)
    row = next(r for r in rows if r["id"] == inv.id)
    return InventoryOut.model_validate(row)
