from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import AuthContext, require_any_role
from app.db.session import get_db
from app.schemas.analytics import CustomerActivity, LowStockProduct, SalesSummary
from app.services import analytics_service

router = APIRouter()


@router.get("/sales", response_model=SalesSummary)
async def get_sales_summary(days: int = 30, ctx: AuthContext = Depends(require_any_role), db: AsyncSession = Depends(get_db)) -> SalesSummary:
    summary = await analytics_service.get_sales_summary(db, ctx.org_id, days=days)
    return SalesSummary(**summary)


@router.get("/low-stock", response_model=list[LowStockProduct])
async def get_low_stock(ctx: AuthContext = Depends(require_any_role), db: AsyncSession = Depends(get_db)) -> list[LowStockProduct]:
    rows = await analytics_service.get_low_stock_products(db, ctx.org_id)
    return [LowStockProduct(**r) for r in rows]


@router.get("/customers", response_model=list[CustomerActivity])
async def get_customer_activity(
    inactive_days: int = 30, ctx: AuthContext = Depends(require_any_role), db: AsyncSession = Depends(get_db)
) -> list[CustomerActivity]:
    rows = await analytics_service.get_customer_activity(db, ctx.org_id, inactive_days=inactive_days)
    return [CustomerActivity(**r) for r in rows]
