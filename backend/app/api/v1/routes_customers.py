import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import AuthContext, require_any_role
from app.db.session import get_db
from app.schemas.customer import CustomerCreate, CustomerOut
from app.services import customer_service

router = APIRouter()


@router.get("", response_model=list[CustomerOut])
async def list_customers(ctx: AuthContext = Depends(require_any_role), db: AsyncSession = Depends(get_db)) -> list[CustomerOut]:
    customers = await customer_service.list_customers(db, ctx.org_id)
    return [CustomerOut.model_validate(c) for c in customers]


@router.get("/{customer_id}", response_model=CustomerOut)
async def get_customer(
    customer_id: uuid.UUID, ctx: AuthContext = Depends(require_any_role), db: AsyncSession = Depends(get_db)
) -> CustomerOut:
    customer = await customer_service.get_customer_or_404(db, ctx.org_id, customer_id)
    return CustomerOut.model_validate(customer)


@router.post("", response_model=CustomerOut, status_code=201)
async def create_customer(
    payload: CustomerCreate, ctx: AuthContext = Depends(require_any_role), db: AsyncSession = Depends(get_db)
) -> CustomerOut:
    customer = await customer_service.create_customer(db, ctx.org_id, payload)
    return CustomerOut.model_validate(customer)
