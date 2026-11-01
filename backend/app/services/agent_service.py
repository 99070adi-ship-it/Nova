"""Ties the bounded agent loop (app/ai/agent_loop.py) to real persistence and real tool
execution. Read tools execute inline against the repositories; every mutating tool call creates a
ToolProposal instead of running directly, regardless of which agent requested it
(ARCHITECTURE.md "Tool system")."""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.agent_loop import run_agent
from app.ai.agents import AGENT_REGISTRY, DELEGATABLE_AGENT_KEYS
from app.ai.factory import build_llm_provider
from app.ai.intent import Intent, Routed, classify
from app.ai.product_help import articles_as_context, find_article
from app.ai.provider import AssistantMessage, LLMProvider, ToolCallRequest, ToolResultMessage
from app.ai.reliability import guard_agent_run
from app.config import get_settings
from app.db.models import AgentRunStatus, AIConversation
from app.errors import NotFoundError, ValidationDomainError
from app.repositories import ai_repo, analytics_repo, order_repo, product_repo, store_creation_repo
from app.services import onboarding_service, proposal_service, session_context_service, storefront_agent_service

settings = get_settings()


async def get_or_create_conversation(db: AsyncSession, org_id: uuid.UUID, *, agent_key: str, raw_context: dict, user_id: uuid.UUID) -> AIConversation:
    if agent_key not in AGENT_REGISTRY:
        raise ValidationDomainError(f"Unknown agent '{agent_key}'")

    # Scoped AI context is server-validated, never trusted as-is (ARCHITECTURE.md "Scoped AI
    # context on conversations") — re-fetch each referenced entity in-tenant and drop anything
    # that doesn't resolve, rather than storing whatever the client claims.
    validated_context: dict = {}
    if "product_id" in raw_context:
        try:
            product_id = uuid.UUID(str(raw_context["product_id"]))
        except ValueError:
            product_id = None
        if product_id is not None:
            product = await product_repo.get_product(db, org_id, product_id)
            if product is not None:
                validated_context["product_id"] = str(product.id)

    conversation = await ai_repo.create_conversation(db, org_id, agent_key=agent_key, context=validated_context, created_by_user_id=user_id)
    await db.commit()
    return conversation


async def get_conversation_or_404(db: AsyncSession, org_id: uuid.UUID, conversation_id: uuid.UUID) -> AIConversation:
    conversation = await ai_repo.get_conversation(db, org_id, conversation_id)
    if conversation is None:
        raise NotFoundError("Conversation not found")
    return conversation


async def run_specialized_agent(db: AsyncSession, org_id: uuid.UUID, *, agent_key: str, instruction: str, provider: LLMProvider) -> dict:
    """Runs exactly one specialized agent's own bounded loop (ARCHITECTURE.md "Store Manager") —
    used both by delegate_to_agent (conversational delegation) and by the Store Health / Action
    Plan flows below. The delegated-to agent's own tool_names never include delegate_to_agent
    itself, so recursion is capped at one level structurally, not by convention."""

    spec = AGENT_REGISTRY[agent_key]
    run = await ai_repo.create_agent_run(db, org_id, agent_key=spec.key, trigger="delegated")
    async with guard_agent_run(db, run):
        result = await run_agent(
            provider, system_prompt=spec.system_prompt, context={}, messages=[instruction],
            tool_names=spec.tool_names, read_only_executor=_make_read_only_executor(db, org_id),
            mutating_executor=_make_mutating_executor(db, org_id, run.id), max_round_trips=settings.tool_loop_max_round_trips,
        )
        final_text = result.final.text if result.final is not None else "No final answer within the step limit."
        await ai_repo.complete_agent_run(
            db, run, status=AgentRunStatus.completed, prompt_tokens=result.prompt_tokens,
            completion_tokens=result.completion_tokens, hit_loop_cap=result.hit_loop_cap,
            result_json={"instruction": instruction, "tool_call_log": result.tool_call_log},
        )
    return {"agent_key": agent_key, "run_id": str(run.id), "final_text": final_text, "tool_call_log": result.tool_call_log}


def _make_read_only_executor(db: AsyncSession, org_id: uuid.UUID):
    async def _execute(call: ToolCallRequest) -> ToolResultMessage:
        if call.name == "get_brand_profile":
            brand = await store_creation_repo.get_brand_profile(db, org_id)
            if brand is None:
                content = {"error": "no_brand_profile"}
            else:
                fields = call.arguments.get("fields")
                full = {
                    "name": brand.name, "description": brand.description, "sells_what": brand.sells_what,
                    "target_customer": brand.target_customer, "positioning": brand.positioning,
                    "vibe_text": brand.vibe_text, "tone": brand.tone,
                }
                content = {k: v for k, v in full.items() if not fields or k in fields}
        elif call.name == "get_store_summary":
            content = await ai_repo.get_store_summary(db, org_id)
        elif call.name == "get_sales_metrics":
            days = call.arguments.get("days") or 30
            content = await analytics_repo.get_sales_summary(db, org_id, days=days)
        elif call.name == "get_low_stock_products":
            content = {"low_stock_products": await analytics_repo.get_low_stock_products(db, org_id)}
        elif call.name == "get_customer_activity":
            inactive_days = call.arguments.get("inactive_days") or 30
            content = {"customers": await analytics_repo.get_customer_activity(db, org_id, inactive_days=inactive_days)}
        elif call.name == "get_order_details":
            order_id = call.arguments.get("order_id")
            order = await order_repo.get_order(db, org_id, uuid.UUID(order_id)) if order_id else None
            content = (
                {"error": "not_found"} if order is None else
                {"id": str(order.id), "status": order.status.value, "payment_status": order.payment_status.value, "total": float(order.total), "items": len(order.items)}
            )
        elif call.name == "get_onboarding_progress":
            steps, current_step = await onboarding_service.get_step_statuses(db, org_id)
            content = {
                "current_step": current_step.value if current_step else None,
                "steps": [{"key": s.key.value, "title": s.title, "status": s.status.value} for s in steps],
            }
        elif call.name == "delegate_to_agent":
            target_key = call.arguments.get("agent_key")
            instruction = call.arguments.get("instruction", "")
            if target_key not in DELEGATABLE_AGENT_KEYS:
                content = {"error": "not_delegatable", "agent_key": target_key}
            else:
                content = await run_specialized_agent(db, org_id, agent_key=target_key, instruction=instruction, provider=build_llm_provider())
        else:
            content = {"error": "unknown_read_tool"}
        return ToolResultMessage(tool_call_id=call.id, name=call.name, content=content)

    return _execute


def _make_mutating_executor(db: AsyncSession, org_id: uuid.UUID, agent_run_id: uuid.UUID):
    async def _execute(call: ToolCallRequest) -> ToolResultMessage:
        try:
            proposal = await proposal_service.create_proposal(
                db, org_id, tool_name=call.name, raw_arguments=call.arguments,
                requesting_agent_run_id=agent_run_id, requesting_user_id=None,
            )
            content = {"proposal_id": str(proposal.id), "status": "proposed", "note": "Awaiting human approval — not executed."}
        except Exception as exc:  # invalid args, unknown tool, etc. — reported back to the model, not raised
            content = {"error": str(exc)}
        return ToolResultMessage(tool_call_id=call.id, name=call.name, content=content)

    return _execute


# Admin screens the assistant may be told about (the first path segment of the admin route).
KNOWN_SCREENS = frozenset({
    "overview", "products", "inventory", "orders", "customers", "analytics", "approvals", "activity",
    "ai-workspace", "store-builder", "create-store", "marketing", "settings",
})


# Tools the persistent assistant may use on a turn, by what the message is actually about. Small talk, how-to
# questions, problems and unclear messages use NO tools: a greeting must never trigger a data lookup.
_READ_TOOLS = ["get_store_summary", "get_low_stock_products", "get_sales_metrics", "get_customer_activity", "get_brand_profile"]
_TOOLS_BY_INTENT: dict[Intent, list[str]] = {
    Intent.small_talk: [], Intent.product_help: [], Intent.troubleshooting: [], Intent.ambiguous: [],
    Intent.business_query: _READ_TOOLS,
    Intent.action_request: ["update_product_content", "publish_storefront"],
}


def _assistant_turn(user_text: str, rows: list, screen: str | None, base_context: dict, agent_tool_names: list[str], session: dict | None = None) -> tuple[Routed, dict, list[str]]:
    """Route one assistant message: classify it FIRST, then assemble context and the permitted tools from
    the result. The user's message and its intent lead; page context is only a hint and never a topic."""
    prior_user = [m.content for m in rows if m.role == "user"][:-1]
    routed = classify(user_text, prior_user)
    context = {**base_context, "intent": routed.intent.value}
    if routed.topic:
        context["topic"] = routed.topic
    if screen in KNOWN_SCREENS and routed.intent is not Intent.small_talk:
        context["screen"] = screen  # relevant to real questions; never sent with small talk
        if session:
            context["session"] = session  # what the merchant is doing right now (session_context_service)
    if routed.follow_up:
        context["follow_up"] = True
        previous = [m.content for m in rows if m.role == "assistant"]
        if previous:
            context["previous_reply"] = previous[-1]
    if routed.intent is Intent.product_help:
        reference = user_text
        if routed.follow_up:
            reference = next((u for u in reversed(prior_user) if find_article(u)), user_text)
        context["help_articles"] = articles_as_context(find_article(reference))  # evidence, not instructions
    tool_names = [t for t in _TOOLS_BY_INTENT[routed.intent] if t in agent_tool_names]
    return routed, context, tool_names


async def _propose_storefront_change(db: AsyncSession, org_id: uuid.UUID, instruction: str) -> tuple[str, dict]:
    """"Make my homepage more premium": enters the supported change-plan workflow. It creates a real plan via
    the Storefront Agent (which reads the draft and changes NOTHING) and reports it; applying stays a separate,
    owner-confirmed step in Store Builder."""
    run = await storefront_agent_service.propose_change_plan(db, org_id, instruction=instruction)
    plan = [i for i in (run.result_json or {}).get("plan", []) if i.get("action") not in (None, "none")]
    log = {"name": "propose_change_plan", "arguments": {"instruction": instruction, "agent_run_id": str(run.id)}, "is_mutating": False}
    if not plan:
        return (
            "I couldn't turn that into a concrete storefront change yet. Try something specific, like add a story about us section, "
            "or ask for a different look. Nothing has changed.", log,
        )
    steps = "; ".join(str(i.get("description") or i.get("action")) for i in plan[:4])
    return (
        f"Here's the plan: {steps}. Nothing has changed yet. To apply it, open Store Builder, enter the same request, "
        "press Propose, then Apply to draft. Customers see nothing until you publish.", log,
    )


async def post_message(
    db: AsyncSession, org_id: uuid.UUID, conversation_id: uuid.UUID, *, user_text: str, screen: str | None = None, focus: dict | None = None
) -> dict:
    conversation = await get_conversation_or_404(db, org_id, conversation_id)
    agent_spec = AGENT_REGISTRY[conversation.agent_key]

    await ai_repo.add_message(db, conversation_id, role="user", content=user_text)
    rows = list(await ai_repo.list_messages(db, conversation_id))
    # Roles are kept: prior assistant turns reach the provider as assistant turns, so follow-ups read the real history.
    # Only the most recent turns go to the model (bounded input); the routing above still sees the whole conversation.
    history = [AssistantMessage(m.content) if m.role == "assistant" else m.content for m in rows][-settings.ai_history_messages :]

    run_context = {**conversation.context, **({"screen": screen} if screen in KNOWN_SCREENS else {})}
    tool_names = agent_spec.tool_names
    routed: Routed | None = None
    if conversation.agent_key == "assistant":
        session = await session_context_service.build(db, org_id, focus=focus)
        routed, run_context, tool_names = _assistant_turn(user_text, rows, screen, conversation.context, agent_spec.tool_names, session)

    run = await ai_repo.create_agent_run(db, org_id, agent_key=agent_spec.key, trigger="conversation_message")

    provider = build_llm_provider("chat")
    async with guard_agent_run(db, run):
        # The user's own message is preserved even if the assistant's reply fails below — a
        # provider outage shouldn't erase what the user just said (ARCHITECTURE.md checkpoint 6:
        # "a failed provider call leaves the system in a recoverable state").
        if routed is not None and routed.intent is Intent.action_request and routed.topic == "storefront_change":
            final_text, log_entry = await _propose_storefront_change(db, org_id, user_text)
            await ai_repo.add_message(db, conversation_id, role="assistant", content=final_text)
            await ai_repo.complete_agent_run(
                db, run, status=AgentRunStatus.completed, prompt_tokens=0, completion_tokens=0, hit_loop_cap=False,
                result_json={"tool_call_log": [log_entry], "intent": routed.intent.value},
            )
            await db.commit()
            return {"assistant_text": final_text, "hit_loop_cap": False, "tool_call_log": [log_entry], "intent": routed.intent.value}

        result = await run_agent(
            provider, system_prompt=agent_spec.system_prompt, context=run_context, messages=history,
            tool_names=tool_names, read_only_executor=_make_read_only_executor(db, org_id),
            mutating_executor=_make_mutating_executor(db, org_id, run.id), max_round_trips=settings.tool_loop_max_round_trips,
        )

        final_text = result.final.text if result.final is not None else "I wasn't able to reach a final answer within my step limit."
        await ai_repo.add_message(db, conversation_id, role="assistant", content=final_text)
        await ai_repo.complete_agent_run(
            db, run, status=AgentRunStatus.completed, prompt_tokens=result.prompt_tokens,
            completion_tokens=result.completion_tokens, hit_loop_cap=result.hit_loop_cap,
            result_json={"tool_call_log": result.tool_call_log},
        )
    await db.commit()
    return {
        "assistant_text": final_text, "hit_loop_cap": result.hit_loop_cap, "tool_call_log": result.tool_call_log,
        "intent": routed.intent.value if routed is not None else None,
    }
