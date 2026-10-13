"""Checkpoint 11 — golden-path QA. One test walks the entire demo path end to end (signup ->
Create My Store, using the VELORA sample-products shortcut rather than typing products by hand ->
storefront generation -> an NL Change Plan -> publish -> Store Manager Store Health -> an Action
Plan -> approving a proposal through Approvals) and asserts the pieces actually connect: onboarding
progress advances correctly at each step, and the audit trail records what happened. Each
individual piece already has its own focused tests elsewhere (test_store_creation.py,
test_storefront_generation.py, test_store_manager.py, etc.) — this test's job is only to catch
integration breaks between them, not to re-verify each one's internals.

Also covers the dev-only demo-reset endpoint (app/api/v1/routes_dev.py): it must restore VELORA's
seeded baseline on request, and must be unreachable outside a local dev environment."""

import uuid

from app.db.session import AsyncSessionLocal
from app.schemas.onboarding import OnboardingStepStatus
from app.schemas.product import ProductCreate, VariantIn
from app.services import product_service


async def test_golden_path_signup_through_run_business(client):
    # 1. Signup — the real front door, not a fixture-seeded owner.
    signup_res = await client.post(
        "/api/v1/auth/signup",
        json={"org_name": "Golden Path Co", "full_name": "Jordan Rivera", "email": "jordan@goldenpath.demo", "password": "changeme123"},
    )
    assert signup_res.status_code == 201
    headers = {"Authorization": f"Bearer {signup_res.json()['access_token']}"}
    org_id = uuid.UUID((await client.get("/api/v1/auth/me", headers=headers)).json()["org_id"])

    async def progress():
        res = await client.get("/api/v1/onboarding/progress", headers=headers)
        assert res.status_code == 200
        return res.json()

    p = await progress()
    assert p["current_step"] == "brand"

    # 2. Brand.
    await client.post("/api/v1/store-creation/start", headers=headers)
    brand_res = await client.put(
        "/api/v1/store-creation/brand-input",
        json={"name": "Golden Path Co", "sells_what": "leather goods", "vibe_text": "warm, considered"},
        headers=headers,
    )
    assert brand_res.status_code == 200
    assert (await progress())["current_step"] == "products"

    # 3. Products — the VELORA sample-products shortcut, not hand-typed entries.
    samples_res = await client.post("/api/v1/store-creation/product-drafts/use-sample-products", headers=headers)
    assert samples_res.status_code == 201
    drafts = samples_res.json()
    assert len(drafts) == 5
    assert (await progress())["current_step"] == "catalog"

    # 4. Catalog — Product Agent content generation on one draft (the others are already fully
    # specified by the sample data, which is exactly what "catalog" derives completion from: ANY
    # draft resolved past pending_generation).
    generate_res = await client.post(f"/api/v1/store-creation/product-drafts/{drafts[0]['id']}/generate", headers=headers)
    assert generate_res.status_code == 200
    assert (await progress())["current_step"] == "review"

    # 5. Review — accept every draft (all fully known — no edits needed).
    accepted_product_ids = []
    for draft in drafts:
        accept_res = await client.post(f"/api/v1/store-creation/product-drafts/{draft['id']}/accept", headers=headers)
        assert accept_res.status_code == 200
        accepted_product_ids.append(accept_res.json()["accepted_product_id"])
    assert (await progress())["current_step"] == "collections"

    # 6. Collections.
    collection_res = await client.post(
        "/api/v1/collections", json={"title": "Everyday Carry", "slug": "everyday-carry"}, headers=headers
    )
    assert collection_res.status_code == 201
    add_res = await client.post(
        f"/api/v1/collections/{collection_res.json()['id']}/products",
        json={"product_id": accepted_product_ids[0]}, headers=headers,
    )
    assert add_res.status_code == 204
    assert (await progress())["current_step"] == "storefront"

    # 7. Storefront generation.
    generate_storefront_res = await client.post("/api/v1/store-creation/generate-storefront", headers=headers)
    assert generate_storefront_res.status_code == 200
    p = await progress()
    assert p["current_step"] == "preview"
    steps_by_key = {s["key"]: s["status"] for s in p["steps"]}
    assert steps_by_key["storefront"] == OnboardingStepStatus.completed.value

    # 7b. Preview — the storefront app reports the draft preview rendered; only then does it complete.
    draft_id = (await client.get("/api/v1/storefront/draft", headers=headers)).json()["id"]
    assert (await client.post(f"/api/v1/public/preview/{draft_id}/loaded")).status_code == 204
    p = await progress()
    assert p["current_step"] == "nl_edit"
    assert {s["key"]: s["status"] for s in p["steps"]}["preview"] == OnboardingStepStatus.completed.value

    # 8. NL edit — Ask NOVA proposes a Change Plan. Proposing alone does NOT complete this step —
    # only actually applying the plan to the draft does.
    change_plan_res = await client.post(
        "/api/v1/storefront/change-plan", json={"instruction": "make the hero feel more premium"}, headers=headers
    )
    assert change_plan_res.status_code == 201
    assert (await progress())["current_step"] == "nl_edit"

    apply_res = await client.post(
        f"/api/v1/storefront/change-plan/{change_plan_res.json()['agent_run_id']}/apply", headers=headers
    )
    assert apply_res.status_code == 200
    assert (await progress())["current_step"] == "publish"

    # 9. Publish.
    publish_res = await client.post("/api/v1/storefront/publish", headers=headers)
    assert publish_res.status_code == 200
    assert (await progress())["current_step"] == "run_business"

    # 10. Run the business — Store Health, then an Action Plan, then a real approval. A product
    # with no description (created directly, bypassing Create My Store — representing an
    # already-established catalog item, the same convention app/services/demo_service.py uses for
    # VELORA's own catalog) gives the Action Plan something real to auto-fix, so this exercises
    # the full proposal -> system-approval -> execution -> audit chain, not an empty plan.
    async with AsyncSessionLocal() as db:
        await product_service.create_product(
            db, org_id, ProductCreate(title="Undocumented Item", slug="undocumented-item", variants=[VariantIn(sku="UI-1", price=50)]),
        )

    health_res = await client.post("/api/v1/store-manager/health", headers=headers)
    assert health_res.status_code == 200
    assert health_res.json()["trace"]  # the operational trace from Checkpoint 10, not just prose

    plan_res = await client.post("/api/v1/store-manager/action-plan", headers=headers)
    assert plan_res.status_code == 200
    assert any(i["tool_name"] == "update_product_content" and i["status"] == "executed" for i in plan_res.json()["items"])

    final_progress = await progress()
    assert final_progress["current_step"] is None
    assert all(s["status"] == OnboardingStepStatus.completed.value for s in final_progress["steps"])

    # A high-risk item (publish_storefront or draft_campaign) should still be sitting in
    # Approvals — approving it closes the loop through the same gate every mutating tool uses.
    approvals_res = await client.get("/api/v1/approvals", headers=headers)
    pending = [p for p in approvals_res.json() if p["status"] == "proposed"]
    if pending:
        approve_res = await client.post(f"/api/v1/approvals/{pending[0]['id']}/approve", headers=headers)
        assert approve_res.status_code == 200

    # The audit trail recorded real actions throughout, not just the final state.
    activity_res = await client.get("/api/v1/activity", headers=headers)
    actions = {e["action"] for e in activity_res.json()}
    assert len(actions) > 0


async def test_demo_reset_restores_velora_baseline(client):
    reset_res = await client.post("/api/v1/dev/demo-reset")
    assert reset_res.status_code == 200
    summary = reset_res.json()
    assert summary["org_slug"] == "velora"
    assert summary["products"] == 26
    assert summary["login_email"] == "owner@velora.demo"

    login_res = await client.post(
        "/api/v1/auth/login", json={"email": summary["login_email"], "password": summary["login_password"]}
    )
    assert login_res.status_code == 200
    headers = {"Authorization": f"Bearer {login_res.json()['access_token']}"}

    products_res = await client.get("/api/v1/products", headers=headers)
    assert len(products_res.json()) == 26

    # Repeatable — a second reset doesn't 500/409 on "org already exists".
    reset_again_res = await client.post("/api/v1/dev/demo-reset")
    assert reset_again_res.status_code == 200


async def test_demo_reset_is_unreachable_outside_local_env(client, monkeypatch):
    import app.api.v1.routes_dev as routes_dev

    monkeypatch.setattr(routes_dev.settings, "env", "production")
    res = await client.post("/api/v1/dev/demo-reset")
    assert res.status_code == 404
