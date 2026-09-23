import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import AuthContext, require_any_role
from app.db.models import ProposalStatus
from app.db.session import get_db
from app.repositories import proposal_repo
from app.schemas.ai import ProposalOut, RejectProposal
from app.services import proposal_service

router = APIRouter()


@router.get("", response_model=list[ProposalOut])
async def list_proposals(
    status: ProposalStatus | None = None, ctx: AuthContext = Depends(require_any_role), db: AsyncSession = Depends(get_db)
) -> list[ProposalOut]:
    proposals = await proposal_repo.list_by_org(db, ctx.org_id, status=status)
    return [ProposalOut.model_validate(p) for p in proposals]


@router.post("/{proposal_id}/approve", response_model=ProposalOut)
async def approve_proposal(
    proposal_id: uuid.UUID, ctx: AuthContext = Depends(require_any_role), db: AsyncSession = Depends(get_db)
) -> ProposalOut:
    proposal = await proposal_service.approve_and_execute_proposal(db, ctx.org_id, proposal_id, approving_user_id=ctx.user_id)
    return ProposalOut.model_validate(proposal)


@router.post("/{proposal_id}/reject", response_model=ProposalOut)
async def reject_proposal(
    proposal_id: uuid.UUID, payload: RejectProposal, ctx: AuthContext = Depends(require_any_role), db: AsyncSession = Depends(get_db)
) -> ProposalOut:
    proposal = await proposal_service.reject_proposal(db, ctx.org_id, proposal_id, actor_id=ctx.user_id, reason=payload.reason)
    return ProposalOut.model_validate(proposal)
