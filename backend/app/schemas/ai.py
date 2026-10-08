import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.db.models import ProposalStatus, RiskClassification


class StartConversation(BaseModel):
    agent_key: str = "assistant"
    context: dict = {}


class ConversationOut(BaseModel):
    id: uuid.UUID
    agent_key: str
    context: dict
    created_at: datetime

    model_config = {"from_attributes": True}


class PostMessage(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


class PostMessageResult(BaseModel):
    assistant_text: str
    hit_loop_cap: bool
    tool_call_log: list[dict]


class MessageOut(BaseModel):
    id: uuid.UUID
    role: str
    content: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ProposalOut(BaseModel):
    id: uuid.UUID
    tool_name: str
    arguments: dict
    risk_classification: RiskClassification
    status: ProposalStatus
    rejection_reason: str | None
    execution_result: dict | None
    failure_reason: str | None
    expires_at: datetime
    created_at: datetime

    model_config = {"from_attributes": True}


class RejectProposal(BaseModel):
    reason: str | None = None


class StoreHealthFindingOut(BaseModel):
    category: str
    metric: str
    status: str
    finding: str
    severity: str
    evidence: dict
    suggested_action: str | None


class StoreHealthReportOut(BaseModel):
    run_id: uuid.UUID
    findings: list[StoreHealthFindingOut]
    narrative: dict[str, str]
    trace: dict[str, list[dict]] = {}
    generated_at: datetime | None = None


class ActionPlanItemOut(BaseModel):
    tool_name: str
    risk: str
    auto_executable: bool
    status: str
    proposal_id: uuid.UUID
    description: str


class ActionPlanOut(BaseModel):
    id: uuid.UUID
    run_id: uuid.UUID
    items: list[ActionPlanItemOut]
    generated_at: datetime | None = None


class AuditLogOut(BaseModel):
    id: uuid.UUID
    actor_type: str
    actor_id: uuid.UUID | None
    action: str
    entity_type: str
    entity_id: uuid.UUID
    before: dict | None
    after: dict | None
    created_at: datetime

    model_config = {"from_attributes": True}
