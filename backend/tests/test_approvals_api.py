from app.db.session import AsyncSessionLocal
from app.schemas.product import ProductCreate, VariantIn
from app.services import product_service, proposal_service


async def _auth_headers(client, seeded_owner):
    res = await client.post("/api/v1/auth/login", json={"email": seeded_owner["email"], "password": seeded_owner["password"]})
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def test_approvals_list_approve_reject_over_http(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    org_id = seeded_owner["org_id"]

    async with AsyncSessionLocal() as db:
        product = await product_service.create_product(
            db, org_id, ProductCreate(title="Gadget", slug="gadget", variants=[VariantIn(sku="GADGET-1", price=19.99)]),
        )
        product_id = str(product.id)

    async with AsyncSessionLocal() as db:
        proposal_one = await proposal_service.create_proposal(
            db, org_id, tool_name="update_product_content", raw_arguments={"product_id": product_id, "title": "Gadget Pro"},
            requesting_agent_run_id=None, requesting_user_id=seeded_owner["user_id"],
        )
    async with AsyncSessionLocal() as db:
        proposal_two = await proposal_service.create_proposal(
            db, org_id, tool_name="update_product_content", raw_arguments={"product_id": product_id, "title": "Gadget Lite"},
            requesting_agent_run_id=None, requesting_user_id=seeded_owner["user_id"],
        )

    list_res = await client.get("/api/v1/approvals", headers=headers)
    assert list_res.status_code == 200
    ids = [p["id"] for p in list_res.json()]
    assert str(proposal_one.id) in ids
    assert str(proposal_two.id) in ids

    approve_res = await client.post(f"/api/v1/approvals/{proposal_one.id}/approve", headers=headers)
    assert approve_res.status_code == 200
    assert approve_res.json()["status"] == "executed"

    reject_res = await client.post(f"/api/v1/approvals/{proposal_two.id}/reject", json={"reason": "duplicate"}, headers=headers)
    assert reject_res.status_code == 200
    assert reject_res.json()["status"] == "rejected"

    pending_res = await client.get("/api/v1/approvals?status=proposed", headers=headers)
    assert pending_res.json() == []


async def test_activity_shows_proposal_lifecycle(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    org_id = seeded_owner["org_id"]

    async with AsyncSessionLocal() as db:
        product = await product_service.create_product(
            db, org_id, ProductCreate(title="Thing", slug="thing", variants=[VariantIn(sku="THING-1", price=5)]),
        )

    async with AsyncSessionLocal() as db:
        proposal = await proposal_service.create_proposal(
            db, org_id, tool_name="update_product_content", raw_arguments={"product_id": str(product.id), "title": "Renamed"},
            requesting_agent_run_id=None, requesting_user_id=seeded_owner["user_id"],
        )
    approve_res = await client.post(f"/api/v1/approvals/{proposal.id}/approve", headers=headers)
    assert approve_res.status_code == 200

    activity_res = await client.get("/api/v1/activity", headers=headers)
    actions = [a["action"] for a in activity_res.json()]
    assert "tool_proposal.created" in actions
    assert "tool_proposal.approved" in actions
    assert "tool_proposal.executed" in actions
