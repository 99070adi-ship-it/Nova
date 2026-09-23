import uuid
from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import ProposalStatus, RiskClassification, ToolProposal


async def create_proposal(
    db: AsyncSession, org_id: uuid.UUID, *, requesting_agent_run_id: uuid.UUID | None,
    requesting_user_id: uuid.UUID | None, tool_name: str, arguments: dict, canonical_arguments: dict,
    payload_hash: str, risk_classification: RiskClassification, expires_at: datetime,
) -> ToolProposal:
    proposal = ToolProposal(
        org_id=org_id, requesting_agent_run_id=requesting_agent_run_id, requesting_user_id=requesting_user_id,
        tool_name=tool_name, arguments=arguments, canonical_arguments=canonical_arguments, payload_hash=payload_hash,
        risk_classification=risk_classification, status=ProposalStatus.proposed, expires_at=expires_at,
    )
    db.add(proposal)
    await db.flush()
    return proposal


async def get_proposal(db: AsyncSession, org_id: uuid.UUID, proposal_id: uuid.UUID) -> ToolProposal | None:
    result = await db.execute(select(ToolProposal).where(ToolProposal.id == proposal_id, ToolProposal.org_id == org_id))
    return result.scalar_one_or_none()


async def list_by_org(db: AsyncSession, org_id: uuid.UUID, *, status: ProposalStatus | None = None, limit: int = 50) -> list[ToolProposal]:
    query = select(ToolProposal).where(ToolProposal.org_id == org_id)
    if status is not None:
        query = query.where(ToolProposal.status == status)
    query = query.order_by(ToolProposal.created_at.desc()).limit(limit)
    result = await db.execute(query)
    return list(result.scalars().all())


async def try_transition(
    db: AsyncSession, org_id: uuid.UUID, proposal_id: uuid.UUID, *,
    from_statuses: list[ProposalStatus], to_status: ProposalStatus, extra_values: dict | None = None,
) -> ToolProposal | None:
    """Conditional UPDATE ... WHERE status IN (from_statuses) — the database-enforced guard that
    makes duplicate approval/execution structurally impossible. Returns None if no row matched
    (already transitioned by a concurrent request, or not found)."""

    values = {"status": to_status, **(extra_values or {})}
    stmt = (
        update(ToolProposal)
        .where(ToolProposal.id == proposal_id, ToolProposal.org_id == org_id, ToolProposal.status.in_(from_statuses))
        .values(**values)
        .returning(ToolProposal)
    )
    result = await db.execute(stmt)
    row = result.scalar_one_or_none()
    if row is not None:
        await db.flush()
    return row
