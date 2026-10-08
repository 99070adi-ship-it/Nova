from app.db.session import AsyncSessionLocal
from app.schemas.product import ProductCreate, VariantIn
from app.services import product_service


async def _auth_headers(client, seeded_owner):
    res = await client.post("/api/v1/auth/login", json={"email": seeded_owner["email"], "password": seeded_owner["password"]})
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def _seed_product_missing_description(org_id, *, title: str, sku: str):
    async with AsyncSessionLocal() as db:
        return await product_service.create_product(
            db, org_id, ProductCreate(title=title, slug=sku.lower(), variants=[VariantIn(sku=sku, price=40)]),
        )


async def test_store_health_flags_missing_description(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    org_id = seeded_owner["org_id"]
    await _seed_product_missing_description(org_id, title="Health Bag", sku="HB-1")

    res = await client.post("/api/v1/store-manager/health", headers=headers)
    assert res.status_code == 200
    body = res.json()
    categories = {f["category"] for f in body["findings"]}
    assert "products" in categories
    products_finding = next(f for f in body["findings"] if f["category"] == "products")
    assert products_finding["metric"] == "missing_description_count"
    assert "Health Bag" in str(products_finding["evidence"])
    # Narrative commentary from real delegated agent runs, not invented.
    assert set(body["narrative"].keys()) == {"sales_agent", "inventory_agent", "customer_agent"}


async def test_store_health_reports_good_sales_when_orders_exist(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    res = await client.post("/api/v1/store-manager/health", headers=headers)
    assert res.status_code == 200
    sales_finding = next(f for f in res.json()["findings"] if f["category"] == "sales")
    assert sales_finding["status"] == "watch"
    assert sales_finding["finding"] == "No orders in the last 30 days."


async def test_latest_store_health_is_null_before_any_run(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    res = await client.get("/api/v1/store-manager/health/latest", headers=headers)
    assert res.status_code == 200
    assert res.json() is None


async def test_latest_store_health_reads_back_the_last_run_without_triggering_a_new_one(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    org_id = seeded_owner["org_id"]
    await _seed_product_missing_description(org_id, title="Latest Bag", sku="LB-1")

    run_res = await client.post("/api/v1/store-manager/health", headers=headers)
    run_id = run_res.json()["run_id"]

    latest_res = await client.get("/api/v1/store-manager/health/latest", headers=headers)
    assert latest_res.status_code == 200
    body = latest_res.json()
    assert body["run_id"] == run_id
    assert body["findings"] == run_res.json()["findings"]
    assert body["generated_at"]

    # Reading it again is a pure read — no new AIAgentRun (and no new LLM calls) is created.
    from sqlalchemy import select

    from app.db.models import AIAgentRun
    from app.db.session import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        runs = (
            await db.execute(select(AIAgentRun).where(AIAgentRun.org_id == org_id, AIAgentRun.agent_key == "store_manager"))
        ).scalars().all()
    store_health_runs = [r for r in runs if r.trigger == "store_health"]
    assert len(store_health_runs) == 1

    await client.get("/api/v1/store-manager/health/latest", headers=headers)
    async with AsyncSessionLocal() as db:
        runs_after = (
            await db.execute(select(AIAgentRun).where(AIAgentRun.org_id == org_id, AIAgentRun.agent_key == "store_manager"))
        ).scalars().all()
    assert len([r for r in runs_after if r.trigger == "store_health"]) == 1


async def test_store_health_includes_operational_trace_for_delegated_agents(client, seeded_owner):
    # ARCHITECTURE.md "Store Manager orchestration UI" — the point of delegation is visible, not
    # just each sub-agent's prose summary: which tool(s) Sales/Inventory/Customer actually called.
    headers = await _auth_headers(client, seeded_owner)
    res = await client.post("/api/v1/store-manager/health", headers=headers)
    body = res.json()
    assert set(body["trace"].keys()) == {"sales_agent", "inventory_agent", "customer_agent"}
    for calls in body["trace"].values():
        assert len(calls) >= 1
        assert all("name" in c for c in calls)


async def test_latest_action_plan_is_null_before_any_plan(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    res = await client.get("/api/v1/store-manager/action-plan/latest", headers=headers)
    assert res.status_code == 200
    assert res.json() is None


async def test_latest_action_plan_reflects_live_approval_status_not_a_stale_snapshot(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)

    create_res = await client.post("/api/v1/store-manager/action-plan", headers=headers)
    items = create_res.json()["items"]
    publish_item = next(i for i in items if i["tool_name"] == "publish_storefront")
    assert publish_item["status"] == "proposed"

    latest_before = await client.get("/api/v1/store-manager/action-plan/latest", headers=headers)
    assert latest_before.json()["generated_at"]
    before_item = next(i for i in latest_before.json()["items"] if i["tool_name"] == "publish_storefront")
    assert before_item["status"] == "proposed"

    # Approved independently through the normal Approvals flow, not through the action plan itself.
    await client.post(f"/api/v1/approvals/{publish_item['proposal_id']}/approve", headers=headers)

    latest_after = await client.get("/api/v1/store-manager/action-plan/latest", headers=headers)
    after_item = next(i for i in latest_after.json()["items"] if i["tool_name"] == "publish_storefront")
    assert after_item["status"] == "executed"


async def test_action_plan_auto_fixes_missing_description(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    org_id = seeded_owner["org_id"]
    product = await _seed_product_missing_description(org_id, title="Plan Bag", sku="PB-1")
    assert product.description is None

    res = await client.post("/api/v1/store-manager/action-plan", headers=headers)
    assert res.status_code == 200
    body = res.json()
    fix_item = next(i for i in body["items"] if i["tool_name"] == "update_product_content")
    assert fix_item["auto_executable"] is True
    assert fix_item["status"] == "executed"

    product_res = await client.get(f"/api/v1/products/{product.id}", headers=headers)
    assert product_res.json()["description"]

    # Executed automatically without a human click — audited as a system actor, not a user.
    activity_res = await client.get("/api/v1/activity", headers=headers)
    approved_events = [e for e in activity_res.json() if e["action"] == "tool_proposal.approved"]
    assert any(e["actor_type"] == "system" for e in approved_events)
