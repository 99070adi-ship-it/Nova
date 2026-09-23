import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import AuthContext, require_any_role
from app.db.session import get_db
from app.schemas.order import OrderCreate, OrderOut
from app.services import order_service

router = APIRouter()


@router.get("", response_model=list[OrderOut])
async def list_orders(ctx: AuthContext = Depends(require_any_role), db: AsyncSession = Depends(get_db)) -> list[OrderOut]:
    orders = await order_service.list_orders(db, ctx.org_id)
    return [OrderOut.model_validate(o) for o in orders]


@router.get("/{order_id}", response_model=OrderOut)
async def get_order(
    order_id: uuid.UUID, ctx: AuthContext = Depends(require_any_role), db: AsyncSession = Depends(get_db)
) -> OrderOut:
    order = await order_service.get_order_or_404(db, ctx.org_id, order_id)
    return OrderOut.model_validate(order)


@router.post("", response_model=OrderOut, status_code=201)
async def create_order(
    payload: OrderCreate, ctx: AuthContext = Depends(require_any_role), db: AsyncSession = Depends(get_db)
) -> OrderOut:
    order = await order_service.create_order(db, ctx.org_id, payload)
    return OrderOut.model_validate(order)
