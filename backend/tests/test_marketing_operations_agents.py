from app.db.session import AsyncSessionLocal
from app.schemas.customer import CustomerCreate
from app.schemas.order import OrderCreate, OrderItemIn
from app.schemas.product import ProductCreate, VariantIn
from app.services import customer_service, order_service, product_service, proposal_service


async def _auth_headers(client, seeded_owner):
    res = await client.post("/api/v1/auth/login", json={"email": seeded_owner["email"], "password": seeded_owner["password"]})
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def test_draft_campaign_proposal_lifecycle(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    org_id = seeded_owner["org_id"]

    async with AsyncSessionLocal() as db:
        proposal = await proposal_service.create_proposal(
            db, org_id, tool_name="draft_campaign",
            raw_arguments={"goal": "Clear winter stock", "target_segment": "Past buyers", "campaign_copy": "20% off select items"},
            requesting_agent_run_id=None, requesting_user_id=seeded_owner["user_id"],
        )
        assert proposal.risk_classification == "high"

    approve_res = await client.post(f"/api/v1/approvals/{proposal.id}/approve", headers=headers)
    assert approve_res.status_code == 200
    result = approve_res.json()["execution_result"]
    assert result["status"] == "drafted_not_sent"
    assert result["campaign_copy"] == "20% off select items"


async def test_cancel_order_proposal_lifecycle(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    org_id = seeded_owner["org_id"]

    async with AsyncSessionLocal() as db:
        product = await product_service.create_product(
            db, org_id, ProductCreate(title="Cancel Test", slug="cancel-test", variants=[VariantIn(sku="CANC-1", price=15)]),
        )
    async with AsyncSessionLocal() as db:
        customer = await customer_service.create_customer(db, org_id, CustomerCreate(email="c@d.com", name="C D"))
    async with AsyncSessionLocal() as db:
        order = await order_service.create_order(
            db, org_id, OrderCreate(customer_id=customer.id, items=[OrderItemIn(variant_id=product.variants[0].id, quantity=1)]),
        )
    assert order.status.value == "pending"

    async with AsyncSessionLocal() as db:
        proposal = await proposal_service.create_proposal(
            db, org_id, tool_name="cancel_order", raw_arguments={"order_id": str(order.id), "reason": "Customer requested"},
            requesting_agent_run_id=None, requesting_user_id=seeded_owner["user_id"],
        )

    approve_res = await client.post(f"/api/v1/approvals/{proposal.id}/approve", headers=headers)
    assert approve_res.status_code == 200
    assert approve_res.json()["execution_result"]["status"] == "cancelled"

    order_res = await client.get(f"/api/v1/orders/{order.id}", headers=headers)
    assert order_res.json()["status"] == "cancelled"


async def test_marketing_agent_conversation_calls_a_real_tool(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    start_res = await client.post("/api/v1/ai/conversations", json={"agent_key": "marketing_agent", "context": {}}, headers=headers)
    conversation_id = start_res.json()["id"]
    msg_res = await client.post(
        f"/api/v1/ai/conversations/{conversation_id}/messages", json={"text": "opportunities?"}, headers=headers
    )
    assert msg_res.status_code == 200
    tool_name = msg_res.json()["tool_call_log"][0]["name"]
    assert tool_name in ("get_sales_metrics", "get_low_stock_products", "get_customer_activity")


async def test_operations_agent_conversation_calls_order_lookup(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    start_res = await client.post("/api/v1/ai/conversations", json={"agent_key": "operations_agent", "context": {}}, headers=headers)
    conversation_id = start_res.json()["id"]
    msg_res = await client.post(
        f"/api/v1/ai/conversations/{conversation_id}/messages", json={"text": "any orders?"}, headers=headers
    )
    assert msg_res.json()["tool_call_log"][0]["name"] == "get_order_details"
