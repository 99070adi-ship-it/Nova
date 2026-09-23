from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import AuthContext, require_any_role
from app.db.session import get_db
from app.repositories import ai_repo
from app.schemas.ai import AuditLogOut

router = APIRouter()


@router.get("", response_model=list[AuditLogOut])
async def list_activity(ctx: AuthContext = Depends(require_any_role), db: AsyncSession = Depends(get_db)) -> list[AuditLogOut]:
    logs = await ai_repo.list_recent_audit_logs(db, ctx.org_id)
    return [AuditLogOut.model_validate(log) for log in logs]
