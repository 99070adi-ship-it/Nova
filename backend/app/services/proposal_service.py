"""Orchestrates the immutable proposal pipeline end to end (ARCHITECTURE.md "Approval / proposal
pipeline"): schema validation -> persist -> [human decision] -> re-validate state -> execute the
exact persisted payload -> verify -> audit. Every step that can fail closed does."""

import uuid
from datetime import timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.proposals import canonicalize_arguments, compute_payload_hash
from app.ai.tools import (
    TOOL_REGISTRY,
    CancelOrderArgs,
    DraftCampaignArgs,
    ToolValidationError,
    UpdateProductContentArgs,
    validate_tool_arguments,
)
from app.config import get_settings
from app.core.audit import write_audit_event
from app.db.base import utcnow
from app.db.models import AuditActorType, OrderStatus, ProposalStatus, RiskClassification, StorefrontVersionStatus, ToolProposal
from app.errors import ConflictError, StaleProposalError, ValidationDomainError
from app.repositories import order_repo, product_repo, proposal_repo, storefront_repo
from app.services.storefront_service import snapshot_pages

settings = get_settings()


def _expiry_for(risk: RiskClassification):
    hours = settings.proposal_expiry_hours_high_risk if risk == RiskClassification.high else settings.proposal_expiry_hours_low_risk
    return utcnow() + timedelta(hours=hours)


async def create_proposal(
    db: AsyncSession, org_id: uuid.UUID, *, tool_name: str, raw_arguments: dict,
    requesting_agent_run_id: uuid.UUID | None, requesting_user_id: uuid.UUID | None,
) -> ToolProposal:
    try:
        parsed = validate_tool_arguments(tool_name, raw_arguments)
    except ToolValidationError as exc:
        raise ValidationDomainError(str(exc)) from exc

    spec = TOOL_REGISTRY[tool_name]
    if not spec.is_mutating:
        raise ValidationDomainError(f"'{tool_name}' is read-only and does not create a proposal")

    risk = spec.risk_classification
    assert risk is not None

    canonical = canonicalize_arguments(parsed.model_dump())
    payload_hash = compute_payload_hash(canonical)

    proposal = await proposal_repo.create_proposal(
        db, org_id, requesting_agent_run_id=requesting_agent_run_id, requesting_user_id=requesting_user_id,
        tool_name=tool_name, arguments=parsed.model_dump(mode="json"), canonical_arguments=canonical,
        payload_hash=payload_hash, risk_classification=RiskClassification(risk), expires_at=_expiry_for(RiskClassification(risk)),
    )
    await write_audit_event(
        db, org_id=org_id, actor_type=AuditActorType.ai if requesting_agent_run_id else AuditActorType.user,
        actor_id=requesting_user_id, action="tool_proposal.created", entity_type="tool_proposal", entity_id=proposal.id,
        after={"tool_name": tool_name, "risk_classification": risk, "payload_hash": payload_hash},
    )
    await db.commit()
    return proposal


async def _fail_closed(
    db: AsyncSession, org_id: uuid.UUID, proposal_id: uuid.UUID, *, from_status: ProposalStatus, to_status: ProposalStatus,
    extra_values: dict, action: str, actor_id: uuid.UUID | None, http_error: Exception,
) -> None:
    await proposal_repo.try_transition(db, org_id, proposal_id, from_statuses=[from_status], to_status=to_status, extra_values=extra_values)
    await write_audit_event(
        db, org_id=org_id, actor_type=AuditActorType.system, actor_id=actor_id, action=action,
        entity_type="tool_proposal", entity_id=proposal_id, after=extra_values,
    )
    await db.commit()
    raise http_error


async def reject_proposal(db: AsyncSession, org_id: uuid.UUID, proposal_id: uuid.UUID, *, actor_id: uuid.UUID, reason: str | None) -> ToolProposal:
    proposal = await proposal_repo.get_proposal(db, org_id, proposal_id)
    if proposal is None:
        raise ConflictError("Proposal not found")

    if proposal.status == ProposalStatus.proposed and proposal.expires_at <= utcnow():
        await _fail_closed(
            db, org_id, proposal_id, from_status=ProposalStatus.proposed, to_status=ProposalStatus.expired,
            extra_values={}, action="tool_proposal.expired", actor_id=actor_id,
            http_error=ConflictError("Proposal has expired", details={"status": "expired"}),
        )

    if proposal.status != ProposalStatus.proposed:
        raise ConflictError(f"Proposal already {proposal.status}", details={"status": proposal.status})

    rejected = await proposal_repo.try_transition(
        db, org_id, proposal_id, from_statuses=[ProposalStatus.proposed], to_status=ProposalStatus.rejected,
        extra_values={"reviewed_by": actor_id, "reviewed_at": utcnow(), "rejection_reason": reason},
    )
    if rejected is None:
        raise ConflictError("Proposal was resolved concurrently", details={"status": "already_resolved"})

    await write_audit_event(
        db, org_id=org_id, actor_type=AuditActorType.user, actor_id=actor_id, action="tool_proposal.rejected",
        entity_type="tool_proposal", entity_id=proposal_id, after={"reason": reason},
    )
    await db.commit()
    return rejected


async def _execute_update_product_content(db: AsyncSession, org_id: uuid.UUID, proposal: ToolProposal) -> dict:
    args = UpdateProductContentArgs.model_validate(proposal.canonical_arguments)
    product = await product_repo.update_product(
        db, org_id, uuid.UUID(args.product_id), title=args.title, description=args.description,
        category=args.category, seo_title=args.seo_title, seo_description=args.seo_description,
    )
    if product is None:
        raise StaleProposalError("Product no longer exists")
    return {"product_id": str(product.id), "title": product.title}


async def _execute_publish_storefront(db: AsyncSession, org_id: uuid.UUID, proposal: ToolProposal) -> dict:
    draft = await storefront_repo.get_draft(db, org_id)
    if draft is None:
        raise StaleProposalError("No draft exists to publish")
    live = await storefront_repo.create_version(
        db, org_id, status=StorefrontVersionStatus.live, generated_by=draft.generated_by,
        pages=snapshot_pages(draft), theme_tokens=draft.theme.tokens, published_at=utcnow(),
    )
    return {"storefront_version_id": str(live.id)}


async def _execute_draft_campaign(db: AsyncSession, org_id: uuid.UUID, proposal: ToolProposal) -> dict:
    # No external send integration in Prototype 1 — "executing" this proposal just means the
    # campaign draft (goal/segment/copy) is recorded as approved output, nothing is sent
    # (ARCHITECTURE.md "Marketing Agent").
    args = DraftCampaignArgs.model_validate(proposal.canonical_arguments)
    return {"goal": args.goal, "target_segment": args.target_segment, "campaign_copy": args.campaign_copy, "status": "drafted_not_sent"}


async def _execute_cancel_order(db: AsyncSession, org_id: uuid.UUID, proposal: ToolProposal) -> dict:
    args = CancelOrderArgs.model_validate(proposal.canonical_arguments)
    order = await order_repo.set_status(db, org_id, uuid.UUID(args.order_id), status=OrderStatus.cancelled)
    if order is None:
        raise StaleProposalError("Order no longer exists")
    return {"order_id": str(order.id), "status": order.status.value, "reason": args.reason}


_EXECUTORS = {
    "update_product_content": _execute_update_product_content,
    "publish_storefront": _execute_publish_storefront,
    "draft_campaign": _execute_draft_campaign,
    "cancel_order": _execute_cancel_order,
}


async def approve_and_execute_proposal(
    db: AsyncSession, org_id: uuid.UUID, proposal_id: uuid.UUID, *, approving_user_id: uuid.UUID | None = None,
) -> ToolProposal:
    """approving_user_id is None for system-driven auto-execution (AgentActionPlan items flagged
    auto_executable=True) — same state machine, payload-hash re-verification, and audit trail as a
    human approval, just with the audit actor recorded as `system` instead of `user`."""

    proposal = await proposal_repo.get_proposal(db, org_id, proposal_id)
    if proposal is None:
        raise ConflictError("Proposal not found")

    if proposal.status == ProposalStatus.proposed and proposal.expires_at <= utcnow():
        await _fail_closed(
            db, org_id, proposal_id, from_status=ProposalStatus.proposed, to_status=ProposalStatus.expired,
            extra_values={}, action="tool_proposal.expired", actor_id=approving_user_id,
            http_error=ConflictError("Proposal has expired", details={"status": "expired"}),
        )

    if proposal.status != ProposalStatus.proposed:
        raise ConflictError(f"Proposal already {proposal.status}", details={"status": proposal.status})

    approved = await proposal_repo.try_transition(
        db, org_id, proposal_id, from_statuses=[ProposalStatus.proposed], to_status=ProposalStatus.approved,
        extra_values={"reviewed_by": approving_user_id, "reviewed_at": utcnow()},
    )
    if approved is None:
        raise ConflictError("Proposal was resolved concurrently", details={"status": "already_resolved"})
    await write_audit_event(
        db, org_id=org_id, actor_type=AuditActorType.user if approving_user_id else AuditActorType.system,
        actor_id=approving_user_id, action="tool_proposal.approved", entity_type="tool_proposal", entity_id=proposal_id, after={},
    )

    executing = await proposal_repo.try_transition(
        db, org_id, proposal_id, from_statuses=[ProposalStatus.approved], to_status=ProposalStatus.executing, extra_values={},
    )
    if executing is None:
        raise ConflictError("Proposal execution already in progress or completed", details={"status": "already_executed"})

    if compute_payload_hash(executing.canonical_arguments) != executing.payload_hash:
        await _fail_closed(
            db, org_id, proposal_id, from_status=ProposalStatus.executing, to_status=ProposalStatus.execution_failed,
            extra_values={"failure_reason": "payload_hash_mismatch"}, action="tool_proposal.execution_failed",
            actor_id=approving_user_id, http_error=ConflictError("Payload integrity check failed"),
        )

    executor = _EXECUTORS[executing.tool_name]
    try:
        result = await executor(db, org_id, executing)
    except StaleProposalError as exc:
        await _fail_closed(
            db, org_id, proposal_id, from_status=ProposalStatus.executing, to_status=ProposalStatus.stale,
            extra_values={"failure_reason": str(exc)}, action="tool_proposal.stale", actor_id=approving_user_id, http_error=exc,
        )
    except Exception as exc:  # execution failed unexpectedly — fail closed, never silently succeed
        await _fail_closed(
            db, org_id, proposal_id, from_status=ProposalStatus.executing, to_status=ProposalStatus.execution_failed,
            extra_values={"failure_reason": str(exc)}, action="tool_proposal.execution_failed",
            actor_id=approving_user_id, http_error=ConflictError("Execution failed"),
        )

    executed = await proposal_repo.try_transition(
        db, org_id, proposal_id, from_statuses=[ProposalStatus.executing], to_status=ProposalStatus.executed,
        extra_values={"executed_at": utcnow(), "execution_result": result},
    )
    assert executed is not None  # we hold "executing" exclusively; no other path can steal it
    await write_audit_event(
        db, org_id=org_id, actor_type=AuditActorType.system, actor_id=approving_user_id, action="tool_proposal.executed",
        entity_type="tool_proposal", entity_id=proposal_id, after=result,
    )
    await db.commit()
    return executed
