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
