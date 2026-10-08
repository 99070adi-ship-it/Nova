import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    AgentActionPlan,
    AgentRunStatus,
    AIAgentRun,
    AIConversation,
    AIMessage,
    AuditLog,
    Customer,
    Inventory,
    Order,
    Product,
    ProductVariant,
)


async def create_conversation(db: AsyncSession, org_id: uuid.UUID, *, agent_key: str, context: dict, created_by_user_id: uuid.UUID) -> AIConversation:
    conversation = AIConversation(org_id=org_id, agent_key=agent_key, context=context, created_by_user_id=created_by_user_id)
    db.add(conversation)
    await db.flush()
    return conversation


async def get_conversation(db: AsyncSession, org_id: uuid.UUID, conversation_id: uuid.UUID) -> AIConversation | None:
    result = await db.execute(select(AIConversation).where(AIConversation.id == conversation_id, AIConversation.org_id == org_id))
    return result.scalar_one_or_none()


async def list_messages(db: AsyncSession, conversation_id: uuid.UUID) -> list[AIMessage]:
    result = await db.execute(select(AIMessage).where(AIMessage.conversation_id == conversation_id).order_by(AIMessage.created_at.asc()))
    return list(result.scalars().all())


async def add_message(db: AsyncSession, conversation_id: uuid.UUID, *, role: str, content: str) -> AIMessage:
    message = AIMessage(conversation_id=conversation_id, role=role, content=content)
    db.add(message)
    await db.flush()
    return message


async def create_agent_run(db: AsyncSession, org_id: uuid.UUID, *, agent_key: str, trigger: str) -> AIAgentRun:
    run = AIAgentRun(org_id=org_id, agent_key=agent_key, trigger=trigger)
    db.add(run)
    await db.flush()
    return run


async def complete_agent_run(db: AsyncSession, run: AIAgentRun, *, status, prompt_tokens: int, completion_tokens: int, hit_loop_cap: bool, result_json: dict | None) -> AIAgentRun:
    run.status = status
    run.prompt_tokens = prompt_tokens
    run.completion_tokens = completion_tokens
    run.hit_loop_cap = hit_loop_cap
    run.result_json = result_json
    await db.flush()
    return run


async def get_agent_run(db: AsyncSession, org_id: uuid.UUID, run_id: uuid.UUID) -> AIAgentRun | None:
    result = await db.execute(select(AIAgentRun).where(AIAgentRun.id == run_id, AIAgentRun.org_id == org_id))
    return result.scalar_one_or_none()


async def get_latest_completed_agent_run(db: AsyncSession, org_id: uuid.UUID, *, agent_key: str, trigger: str) -> AIAgentRun | None:
    result = await db.execute(
        select(AIAgentRun)
        .where(
            AIAgentRun.org_id == org_id, AIAgentRun.agent_key == agent_key,
            AIAgentRun.trigger == trigger, AIAgentRun.status == AgentRunStatus.completed,
        )
        .order_by(AIAgentRun.created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def get_store_summary(db: AsyncSession, org_id: uuid.UUID) -> dict:
    products_count = (await db.execute(select(func.count()).select_from(Product).where(Product.org_id == org_id))).scalar_one()
    customers_count = (await db.execute(select(func.count()).select_from(Customer).where(Customer.org_id == org_id))).scalar_one()
    orders_count = (await db.execute(select(func.count()).select_from(Order).where(Order.org_id == org_id))).scalar_one()
    low_stock_count = (
        await db.execute(
            select(func.count())
            .select_from(Inventory)
            .join(ProductVariant, Inventory.variant_id == ProductVariant.id)
            .join(Product, ProductVariant.product_id == Product.id)
            .where(Product.org_id == org_id, Inventory.on_hand <= Inventory.low_stock_threshold)
        )
    ).scalar_one()
    return {"products": products_count, "customers": customers_count, "orders": orders_count, "low_stock_variants": low_stock_count}


async def list_recent_audit_logs(db: AsyncSession, org_id: uuid.UUID, *, limit: int = 100) -> list[AuditLog]:
    result = await db.execute(select(AuditLog).where(AuditLog.org_id == org_id).order_by(AuditLog.created_at.desc()).limit(limit))
    return list(result.scalars().all())


async def has_completed_agent_run(db: AsyncSession, org_id: uuid.UUID, *, agent_key: str, trigger: str | None = None) -> bool:
    """Onboarding progress derivation (ARCHITECTURE.md "Onboarding — the NOVA Guide") — a step is
    "done" when the real run happened, not a separately persisted flag."""

    stmt = select(func.count()).select_from(AIAgentRun).where(
        AIAgentRun.org_id == org_id, AIAgentRun.agent_key == agent_key, AIAgentRun.status == AgentRunStatus.completed
    )
    if trigger is not None:
        stmt = stmt.where(AIAgentRun.trigger == trigger)
    return (await db.execute(stmt)).scalar_one() > 0


async def has_applied_change_plan(db: AsyncSession, org_id: uuid.UUID) -> bool:
    """Onboarding's nl_edit step (ARCHITECTURE.md "Onboarding — the NOVA Guide") requires more
    than a proposed Change Plan — it must have actually been applied to the draft.
    `storefront_agent_service.apply_change_plan` sets `result_json["applied"] = True` on the same
    run row `propose_change_plan` completed (never a separate trigger), so unlike
    `has_completed_agent_run` above (existence/status only), this also inspects the persisted
    result — a completed run whose plan was merely proposed or rendered, never applied, must not
    count."""

    result = await db.execute(
        select(AIAgentRun.result_json).where(
            AIAgentRun.org_id == org_id,
            AIAgentRun.agent_key == "storefront_agent",
            AIAgentRun.trigger == "propose_change_plan",
            AIAgentRun.status == AgentRunStatus.completed,
        )
    )
    return any(row is not None and row.get("applied") is True for row in result.scalars().all())


async def has_action_plan(db: AsyncSession, org_id: uuid.UUID) -> bool:
    count = (
        await db.execute(select(func.count()).select_from(AgentActionPlan).where(AgentActionPlan.org_id == org_id))
    ).scalar_one()
    return count > 0


async def get_latest_action_plan(db: AsyncSession, org_id: uuid.UUID) -> AgentActionPlan | None:
    result = await db.execute(
        select(AgentActionPlan).where(AgentActionPlan.org_id == org_id).order_by(AgentActionPlan.created_at.desc()).limit(1)
    )
    return result.scalar_one_or_none()
