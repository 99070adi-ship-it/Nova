"""Store Manager — NOVA's high-level operator (ARCHITECTURE.md "Store Manager"). get_store_health
builds StoreHealthFinding objects directly from analytics_repo/product_repo/storefront_service —
real queried evidence, never invented — and also delegates to sales/inventory/customer agents via
run_specialized_agent for a human-readable narrative view (run_agent's tool_call_log only records
tool calls, not their result content, so structured findings come from direct data access rather
than being parsed back out of an agent's free text). create_action_plan turns findings into real,
already-existing tool capabilities: no fabricated actions for findings NOVA can't actually act on
(e.g. low stock surfaces as a finding only — there is no "reorder stock" tool)."""

import json
import uuid
from typing import Literal

from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.json_output import parse_model_json
from app.ai.factory import build_llm_provider
from app.ai.reliability import guard_agent_run, safe_provider_step
from app.db.models import AgentActionPlan, AgentRunStatus
from app.repositories import ai_repo, analytics_repo, product_repo, proposal_repo, store_creation_repo
from app.services import proposal_service, storefront_service
from app.services.agent_service import run_specialized_agent
from app.services.product_agent_service import PRODUCT_CONTENT_SYSTEM_PROMPT


class StoreHealthFinding(BaseModel):
    category: Literal["sales", "inventory", "products", "customers", "storefront", "marketing", "operations"]
    metric: str
    status: Literal["good", "watch", "at_risk"]
    finding: str
    severity: Literal["low", "medium", "high"]
    evidence: dict
    suggested_action: str | None = None


class StoreHealthReport(BaseModel):
    findings: list[StoreHealthFinding]
    narrative: dict[str, str]  # agent_key -> its own delegated final_text, for a readable view
    trace: dict[str, list[dict]] = {}  # agent_key -> its own tool_call_log — the operational trace


async def _brand_context(db: AsyncSession, org_id: uuid.UUID) -> dict:
    brand = await store_creation_repo.get_brand_profile(db, org_id)
    if brand is None:
        return {}
    return {"name": brand.name, "vibe_text": brand.vibe_text, "tone": brand.tone, "target_customer": brand.target_customer}


async def get_store_health(db: AsyncSession, org_id: uuid.UUID) -> dict:
    run = await ai_repo.create_agent_run(db, org_id, agent_key="store_manager", trigger="store_health")

    findings: list[StoreHealthFinding] = []

    sales = await analytics_repo.get_sales_summary(db, org_id, days=30)
    if sales["orders"] == 0:
        findings.append(StoreHealthFinding(
            category="sales", metric="orders_30d", status="watch", severity="medium",
            finding="No orders in the last 30 days.",
            evidence={"revenue": sales["revenue"], "orders": sales["orders"]},
        ))
    else:
        findings.append(StoreHealthFinding(
            category="sales", metric="revenue_30d", status="good", severity="low",
            finding=f"${sales['revenue']:.2f} in revenue from {sales['orders']} orders over the last 30 days.",
            evidence={"revenue": sales["revenue"], "orders": sales["orders"], "top_products": sales["top_products"]},
        ))

    low_stock = await analytics_repo.get_low_stock_products(db, org_id)
    if low_stock:
        findings.append(StoreHealthFinding(
            category="inventory", metric="low_stock_count", status="at_risk",
            severity="high" if len(low_stock) >= 3 else "medium",
            finding=f"{len(low_stock)} product(s) at or below their low-stock threshold.",
            evidence={"low_stock_products": low_stock},
            suggested_action="Reorder stock for the affected SKUs.",
        ))

    missing_desc = await product_repo.list_products_missing_description(db, org_id)
    if missing_desc:
        findings.append(StoreHealthFinding(
            category="products", metric="missing_description_count", status="watch", severity="medium",
            finding=f"{len(missing_desc)} product(s) are missing a description.",
            evidence={"products": [{"id": str(p.id), "title": p.title} for p in missing_desc]},
            suggested_action="Generate descriptions for these products.",
        ))

    customers = await analytics_repo.get_customer_activity(db, org_id, inactive_days=30)
    inactive = [c for c in customers if c["inactive"]]
    if customers and inactive:
        findings.append(StoreHealthFinding(
            category="customers", metric="inactive_customer_count", status="watch",
            severity="high" if len(inactive) == len(customers) else "medium",
            finding=f"{len(inactive)} of {len(customers)} customers have not ordered in 30+ days.",
            evidence={"inactive_count": len(inactive), "total_customers": len(customers)},
            suggested_action="Draft a win-back campaign targeting inactive customers.",
        ))

    diff = await storefront_service.diff_draft_against_live(db, org_id)
    if diff != ["No changes since last publish"]:
        findings.append(StoreHealthFinding(
            category="storefront", metric="unpublished_changes", status="watch", severity="low",
            finding=f"The storefront draft has {len(diff)} unpublished change(s).",
            evidence={"changes": diff},
            suggested_action="Review and publish the storefront draft.",
        ))

    provider = build_llm_provider()
    narrative: dict[str, str] = {}
    trace: dict[str, list[dict]] = {}
    async with guard_agent_run(db, run):
        # Each delegated call already guards + fails its own run on a provider error and
        # re-raises; that propagates here so this outer Store Manager run is marked failed too,
        # rather than silently returning a report with some agents' narrative missing.
        for agent_key, instruction in (
            ("sales_agent", "Summarize our sales performance over the last 30 days."),
            ("inventory_agent", "Summarize our current inventory risk."),
            ("customer_agent", "Summarize customer activity and churn risk."),
        ):
            result = await run_specialized_agent(db, org_id, agent_key=agent_key, instruction=instruction, provider=provider)
            narrative[agent_key] = result["final_text"]
            trace[agent_key] = result["tool_call_log"]

        report = StoreHealthReport(findings=findings, narrative=narrative, trace=trace)
        await ai_repo.complete_agent_run(
            db, run, status=AgentRunStatus.completed, prompt_tokens=0, completion_tokens=0, hit_loop_cap=False,
            result_json=report.model_dump(),
        )
    await db.commit()
    return {"run_id": str(run.id), "generated_at": run.created_at, **report.model_dump()}


async def get_latest_store_health(db: AsyncSession, org_id: uuid.UUID) -> dict | None:
    """Read-only — the Overview "needs attention" feed reads whatever Store Health last found
    instead of triggering a fresh multi-agent run (4 LLM calls) on every page load; `get_store_health`
    above remains the explicit "how is my store doing?" action for a real refresh."""

    run = await ai_repo.get_latest_completed_agent_run(db, org_id, agent_key="store_manager", trigger="store_health")
    if run is None:
        return None
    return {"run_id": str(run.id), "generated_at": run.created_at, **run.result_json}


async def _generate_missing_description(provider, product, brand_context: dict) -> str | None:
    context = {"known_fields": {"title": product.title, "category": product.category}, "brand": brand_context}
    step = await safe_provider_step(
        provider, system_prompt=PRODUCT_CONTENT_SYSTEM_PROMPT, context=context, messages=[],
        tool_results=[], available_tools=[],
    )
    if step.final is None:
        return None
    try:
        parsed = parse_model_json(step.final.text)
    except json.JSONDecodeError:
        return None
    return parsed.get("description") if isinstance(parsed, dict) else None


async def create_action_plan(db: AsyncSession, org_id: uuid.UUID) -> dict:
    """"Fix what you can" (ARCHITECTURE.md "AI Action Plans"): missing-description products are
    genuinely low-risk and auto-executed immediately via a system-approved ToolProposal;
    publishing the storefront and drafting a win-back campaign are high-risk and only ever
    proposed, awaiting a human's approval through the normal Approvals pipeline."""

    run = await ai_repo.create_agent_run(db, org_id, agent_key="store_manager", trigger="action_plan")
    provider = build_llm_provider()
    brand_context = await _brand_context(db, org_id)
    items: list[dict] = []

    async with guard_agent_run(db, run):
        # Each proposal below is already committed independently by proposal_service the moment
        # it's created/executed — if the provider fails partway through this loop, items already
        # processed stay durably recorded (ARCHITECTURE.md checkpoint 6: "leaves the system in a
        # recoverable state"); only the plan row itself and this run's own status are still
        # pending, and guard_agent_run's failure path settles those without inventing an
        # AgentActionPlan for work that was never finished.
        missing_desc = await product_repo.list_products_missing_description(db, org_id)
        for product in missing_desc:
            description = await _generate_missing_description(provider, product, brand_context)
            if not description:
                continue
            proposal = await proposal_service.create_proposal(
                db, org_id, tool_name="update_product_content", raw_arguments={"product_id": str(product.id), "description": description},
                requesting_agent_run_id=run.id, requesting_user_id=None,
            )
            executed = await proposal_service.approve_and_execute_proposal(db, org_id, proposal.id, approving_user_id=None)
            items.append({
                "tool_name": "update_product_content", "risk": "low", "auto_executable": True,
                "status": executed.status.value, "proposal_id": str(proposal.id),
                "description": f"Generated a description for '{product.title}'.",
            })

        diff = await storefront_service.diff_draft_against_live(db, org_id)
        if diff != ["No changes since last publish"]:
            proposal = await proposal_service.create_proposal(
                db, org_id, tool_name="publish_storefront", raw_arguments={},
                requesting_agent_run_id=run.id, requesting_user_id=None,
            )
            items.append({
                "tool_name": "publish_storefront", "risk": "high", "auto_executable": False,
                "status": proposal.status.value, "proposal_id": str(proposal.id),
                "description": "Publish the storefront draft's unpublished changes.",
            })

        customers = await analytics_repo.get_customer_activity(db, org_id, inactive_days=30)
        inactive = [c for c in customers if c["inactive"]]
        if inactive:
            proposal = await proposal_service.create_proposal(
                db, org_id, tool_name="draft_campaign",
                raw_arguments={
                    "goal": "Win back inactive customers",
                    "target_segment": f"{len(inactive)} customers inactive 30+ days",
                    "campaign_copy": f"We miss you! Come back to {brand_context.get('name', 'our store')} for something new.",
                },
                requesting_agent_run_id=run.id, requesting_user_id=None,
            )
            items.append({
                "tool_name": "draft_campaign", "risk": "high", "auto_executable": False,
                "status": proposal.status.value, "proposal_id": str(proposal.id),
                "description": f"Draft a win-back campaign for {len(inactive)} inactive customers.",
            })

        plan = AgentActionPlan(org_id=org_id, agent_run_id=run.id, created_by="store_manager", items=items)
        db.add(plan)
        await db.flush()
        await ai_repo.complete_agent_run(
            db, run, status=AgentRunStatus.completed, prompt_tokens=0, completion_tokens=0, hit_loop_cap=False, result_json={"items": items},
        )
    await db.commit()
    return {"id": str(plan.id), "run_id": str(run.id), "generated_at": plan.created_at, "items": items}


async def get_latest_action_plan(db: AsyncSession, org_id: uuid.UUID) -> dict | None:
    """Review, not just the one-time creation response (ARCHITECTURE.md "Store Manager
    orchestration UI" — "AgentActionPlan review"). Each item's `status` is refreshed from its
    underlying ToolProposal rather than trusting the snapshot recorded at plan-creation time:
    an auto-executed item's status can never change again, but a proposal still `proposed` at
    creation may since have been approved or rejected through Approvals, and a stale "awaiting
    approval" here would misrepresent that."""

    plan = await ai_repo.get_latest_action_plan(db, org_id)
    if plan is None:
        return None

    items = []
    for item in plan.items:
        proposal = await proposal_repo.get_proposal(db, org_id, uuid.UUID(item["proposal_id"]))
        items.append({**item, "status": proposal.status.value if proposal else item["status"]})
    return {"id": str(plan.id), "run_id": str(plan.agent_run_id), "generated_at": plan.created_at, "items": items}
