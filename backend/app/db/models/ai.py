import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import ENUM as PGEnum
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPKMixin


class AuditActorType(str, enum.Enum):
    user = "user"
    ai = "ai"
    system = "system"


class AuditLog(Base, UUIDPKMixin, TimestampMixin):
    """Every AI (and human) action's operational trace — agent/actor -> tool -> action -> entity
    -> result, timestamped, no hidden chain-of-thought (ARCHITECTURE.md "Audit system")."""

    __tablename__ = "audit_logs"

    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), nullable=False, index=True)
    actor_type: Mapped[AuditActorType] = mapped_column(
        PGEnum(AuditActorType, name="audit_actor_type", values_callable=lambda e: [m.value for m in e]), nullable=False
    )
    actor_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    action: Mapped[str] = mapped_column(String(200), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(100), nullable=False)
    entity_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    before: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    after: Mapped[dict | None] = mapped_column(JSONB, nullable=True)


class ProposalStatus(str, enum.Enum):
    proposed = "proposed"
    approved = "approved"
    rejected = "rejected"
    executing = "executing"
    executed = "executed"
    execution_failed = "execution_failed"
    stale = "stale"
    expired = "expired"


class RiskClassification(str, enum.Enum):
    low = "low"
    high = "high"


class ToolProposal(Base, UUIDPKMixin, TimestampMixin):
    """Immutable propose -> approve/reject -> execute pipeline. A mutating tool call never
    executes directly, regardless of which agent requested it (ARCHITECTURE.md "Approval /
    proposal pipeline")."""

    __tablename__ = "tool_proposals"

    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), nullable=False, index=True)
    requesting_agent_run_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("ai_agent_runs.id"), nullable=True, index=True)
    requesting_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    tool_name: Mapped[str] = mapped_column(String(100), nullable=False)
    arguments: Mapped[dict] = mapped_column(JSONB, nullable=False)
    canonical_arguments: Mapped[dict] = mapped_column(JSONB, nullable=False)
    payload_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    risk_classification: Mapped[RiskClassification] = mapped_column(
        PGEnum(RiskClassification, name="risk_classification", values_callable=lambda e: [m.value for m in e]), nullable=False
    )
    status: Mapped[ProposalStatus] = mapped_column(
        PGEnum(ProposalStatus, name="proposal_status", values_callable=lambda e: [m.value for m in e]),
        nullable=False, default=ProposalStatus.proposed,
    )
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    executed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    execution_result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    failure_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class AIConversation(Base, UUIDPKMixin, TimestampMixin):
    """`context` is server-validated on write (ARCHITECTURE.md "Scoped AI context on
    conversations") — a hint for which read tools/system-prompt framing to use, never a trust
    boundary."""

    __tablename__ = "ai_conversations"

    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), nullable=False, index=True)
    agent_key: Mapped[str] = mapped_column(String(50), nullable=False)
    context: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)


class AIMessage(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "ai_messages"

    conversation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ai_conversations.id"), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(20), nullable=False)  # "user" | "assistant"
    content: Mapped[str] = mapped_column(Text, nullable=False)


class AgentRunStatus(str, enum.Enum):
    running = "running"
    completed = "completed"
    failed = "failed"


class AIAgentRun(Base, UUIDPKMixin, TimestampMixin):
    """`result_json` holds structured output for that run (e.g. a StoreHealthReport or a
    Storefront Change Plan in later phases)."""

    __tablename__ = "ai_agent_runs"

    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), nullable=False, index=True)
    agent_key: Mapped[str] = mapped_column(String(50), nullable=False)
    trigger: Mapped[str] = mapped_column(String(100), nullable=False)
    status: Mapped[AgentRunStatus] = mapped_column(
        PGEnum(AgentRunStatus, name="agent_run_status", values_callable=lambda e: [m.value for m in e]),
        nullable=False, default=AgentRunStatus.running,
    )
    prompt_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    hit_loop_cap: Mapped[bool] = mapped_column(nullable=False, default=False)
    result_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
