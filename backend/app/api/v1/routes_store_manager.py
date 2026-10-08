from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import AuthContext, require_any_role
from app.db.session import get_db
from app.schemas.ai import ActionPlanOut, StoreHealthReportOut
from app.services import store_manager_service

router = APIRouter()


@router.get("/health/latest", response_model=StoreHealthReportOut | None)
async def get_latest_store_health(ctx: AuthContext = Depends(require_any_role), db: AsyncSession = Depends(get_db)) -> StoreHealthReportOut | None:
    result = await store_manager_service.get_latest_store_health(db, ctx.org_id)
    return StoreHealthReportOut(**result) if result else None


@router.post("/health", response_model=StoreHealthReportOut)
async def get_store_health(ctx: AuthContext = Depends(require_any_role), db: AsyncSession = Depends(get_db)) -> StoreHealthReportOut:
    result = await store_manager_service.get_store_health(db, ctx.org_id)
    return StoreHealthReportOut(**result)


@router.get("/action-plan/latest", response_model=ActionPlanOut | None)
async def get_latest_action_plan(ctx: AuthContext = Depends(require_any_role), db: AsyncSession = Depends(get_db)) -> ActionPlanOut | None:
    result = await store_manager_service.get_latest_action_plan(db, ctx.org_id)
    return ActionPlanOut(**result) if result else None


@router.post("/action-plan", response_model=ActionPlanOut)
async def create_action_plan(ctx: AuthContext = Depends(require_any_role), db: AsyncSession = Depends(get_db)) -> ActionPlanOut:
    result = await store_manager_service.create_action_plan(db, ctx.org_id)
    return ActionPlanOut(**result)
