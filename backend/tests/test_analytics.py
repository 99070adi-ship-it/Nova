from app.db.session import AsyncSessionLocal
from app.schemas.customer import CustomerCreate
from app.schemas.order import OrderCreate, OrderItemIn
from app.schemas.product import ProductCreate, VariantIn
from app.services import customer_service, order_service, product_service


async def _auth_headers(client, seeded_owner):
    res = await client.post("/api/v1/auth/login", json={"email": seeded_owner["email"], "password": seeded_owner["password"]})
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def _seed_order(org_id):
    async with AsyncSessionLocal() as db:
        product = await product_service.create_product(
            db, org_id, ProductCreate(title="Analytics Item", slug="analytics-item", variants=[VariantIn(sku="AN-1", price=40)]),
        )
    async with AsyncSessionLocal() as db:
        customer = await customer_service.create_customer(db, org_id, CustomerCreate(email="a@b.com", name="A B"))
    async with AsyncSessionLocal() as db:
        order = await order_service.create_order(
            db, org_id, OrderCreate(customer_id=customer.id, items=[OrderItemIn(variant_id=product.variants[0].id, quantity=3)]),
        )
    return product, customer, order


async def test_order_creation_emits_purchase_event_and_recomputes_metrics(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    org_id = seeded_owner["org_id"]
    product, customer, order = await _seed_order(org_id)

    sales_res = await client.get("/api/v1/analytics/sales?days=30", headers=headers)
    assert sales_res.status_code == 200
    body = sales_res.json()
    assert body["revenue"] == 120.0
    assert body["orders"] == 1
    assert body["top_products"][0]["title"] == "Analytics Item"
    assert body["top_products"][0]["units"] == 3


async def test_low_stock_reflects_real_inventory(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    org_id = seeded_owner["org_id"]
    await _seed_order(org_id)

    res = await client.get("/api/v1/analytics/low-stock", headers=headers)
    assert res.status_code == 200
    assert any(row["sku"] == "AN-1" and row["on_hand"] == 0 for row in res.json())


async def test_customer_activity_marks_recent_buyer_as_active(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    org_id = seeded_owner["org_id"]
    await _seed_order(org_id)

    res = await client.get("/api/v1/analytics/customers?inactive_days=30", headers=headers)
    assert res.status_code == 200
    row = next(r for r in res.json() if r["email"] == "a@b.com")
    assert row["order_count"] == 1
    assert row["inactive"] is False


async def test_sales_agent_reports_real_numbers(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    org_id = seeded_owner["org_id"]
    await _seed_order(org_id)

    start_res = await client.post("/api/v1/ai/conversations", json={"agent_key": "sales_agent", "context": {}}, headers=headers)
    conversation_id = start_res.json()["id"]
    msg_res = await client.post(f"/api/v1/ai/conversations/{conversation_id}/messages", json={"text": "sales?"}, headers=headers)
    assert msg_res.status_code == 200
    log = msg_res.json()["tool_call_log"]
    assert log[0]["name"] == "get_sales_metrics"
    assert "120" in msg_res.json()["assistant_text"] or "revenue" in msg_res.json()["assistant_text"]


async def test_inventory_agent_only_has_inventory_tool(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    start_res = await client.post("/api/v1/ai/conversations", json={"agent_key": "inventory_agent", "context": {}}, headers=headers)
    conversation_id = start_res.json()["id"]
    msg_res = await client.post(f"/api/v1/ai/conversations/{conversation_id}/messages", json={"text": "stock?"}, headers=headers)
    assert msg_res.json()["tool_call_log"][0]["name"] == "get_low_stock_products"
