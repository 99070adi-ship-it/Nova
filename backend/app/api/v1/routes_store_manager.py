from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import AuthContext, require_any_role
from app.db.session import get_db
from app.schemas.ai import ActionPlanOut, StoreHealthReportOut
from app.services import store_manager_service

router = APIRouter()


@router.post("/health", response_model=StoreHealthReportOut)
async def get_store_health(ctx: AuthContext = Depends(require_any_role), db: AsyncSession = Depends(get_db)) -> StoreHealthReportOut:
    result = await store_manager_service.get_store_health(db, ctx.org_id)
    return StoreHealthReportOut(**result)


@router.post("/action-plan", response_model=ActionPlanOut)
async def create_action_plan(ctx: AuthContext = Depends(require_any_role), db: AsyncSession = Depends(get_db)) -> ActionPlanOut:
    result = await store_manager_service.create_action_plan(db, ctx.org_id)
    return ActionPlanOut(**result)
