import uuid

from app.ai.agents import DELEGATABLE_AGENT_KEYS


async def _auth_headers(client, seeded_owner):
    res = await client.post("/api/v1/auth/login", json={"email": seeded_owner["email"], "password": seeded_owner["password"]})
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def _status_by_key(progress: dict) -> dict:
    return {s["key"]: s["status"] for s in progress["steps"]}


async def _get_progress(client, headers):
    res = await client.get("/api/v1/onboarding/progress", headers=headers)
    return _status_by_key(res.json()), res.json()["current_step"]


async def _advance_to_nl_edit_step(client, headers) -> None:
    """Shared setup for the nl_edit-apply-gating tests below — walks through every prior step
    (already individually verified by test_progress_advances_step_by_step_through_the_real_flow
    above) without re-asserting each one, just to reach "nl_edit available" quickly."""
    await client.post("/api/v1/store-creation/start", headers=headers)
    await client.put("/api/v1/store-creation/brand-input", json={"name": "Aurora Goods"}, headers=headers)
    draft_res = await client.post(
        "/api/v1/store-creation/product-drafts",
        json={"title": "Aurora Tote", "price": 128, "sku": "AUR-TOTE-1"},
        headers=headers,
    )
    draft_id = draft_res.json()["id"]
    await client.post(f"/api/v1/store-creation/product-drafts/{draft_id}/generate", headers=headers)
    await client.post(f"/api/v1/store-creation/product-drafts/{draft_id}/accept", headers=headers)
    await client.post("/api/v1/collections", json={"title": "New Arrivals", "slug": "new-arrivals"}, headers=headers)
    await client.post("/api/v1/store-creation/generate-storefront", headers=headers)
    await _load_draft_preview(client, headers)


async def _load_draft_preview(client, headers) -> str:
    """What the storefront app does once the draft preview has rendered: tell the server."""
    draft_id = (await client.get("/api/v1/storefront/draft", headers=headers)).json()["id"]
    res = await client.post(f"/api/v1/public/preview/{draft_id}/loaded")
    assert res.status_code == 204
    return draft_id


async def test_progress_starts_all_locked_except_brand(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    res = await client.get("/api/v1/onboarding/progress", headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert body["current_step"] == "brand"
    assert body["intro_video_seen"] is False
    statuses = _status_by_key(body)
    assert statuses["brand"] == "available"
    assert statuses["products"] == "locked"
    assert statuses["run_business"] == "locked"


async def test_intro_video_seen_is_one_shot_and_persists(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    res = await client.post("/api/v1/onboarding/intro-video-seen", headers=headers)
    assert res.status_code == 200
    assert res.json()["intro_video_seen"] is True

    # A fresh GET (simulating a page refresh) must still show it as seen.
    again = await client.get("/api/v1/onboarding/progress", headers=headers)
    assert again.json()["intro_video_seen"] is True


async def test_progress_advances_step_by_step_through_the_real_flow(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)

    async def progress():
        res = await client.get("/api/v1/onboarding/progress", headers=headers)
        return _status_by_key(res.json()), res.json()["current_step"]

    statuses, current = await progress()
    assert current == "brand"
    assert statuses["brand"] == "available"

    # Step 1 — brand.
    await client.post("/api/v1/store-creation/start", headers=headers)
    await client.put("/api/v1/store-creation/brand-input", json={"name": "Aurora Goods"}, headers=headers)
    statuses, current = await progress()
    assert statuses["brand"] == "completed"
    assert current == "products"

    # Step 2 — products.
    draft_res = await client.post(
        "/api/v1/store-creation/product-drafts",
        json={"title": "Aurora Tote", "price": 128, "sku": "AUR-TOTE-1"},
        headers=headers,
    )
    draft_id = draft_res.json()["id"]
    statuses, current = await progress()
    assert statuses["products"] == "completed"
    assert current == "catalog"

    # Step 3 — NOVA generates content.
    await client.post(f"/api/v1/store-creation/product-drafts/{draft_id}/generate", headers=headers)
    statuses, current = await progress()
    assert statuses["catalog"] == "completed"
    assert current == "review"

    # Step 4 — owner resolves the draft.
    await client.post(f"/api/v1/store-creation/product-drafts/{draft_id}/accept", headers=headers)
    statuses, current = await progress()
    assert statuses["review"] == "completed"
    assert current == "collections"

    # Step 5 — collections.
    await client.post(
        "/api/v1/collections", json={"title": "New Arrivals", "slug": "new-arrivals"}, headers=headers
    )
    statuses, current = await progress()
    assert statuses["collections"] == "completed"
    assert current == "storefront"

    # Step 6 — storefront draft generated. Preview is its own step: generating alone must not complete it.
    await client.post("/api/v1/store-creation/generate-storefront", headers=headers)
    statuses, current = await progress()
    assert statuses["storefront"] == "completed"
    assert statuses["preview"] == "available"
    assert current == "preview"

    # Step 7 — preview: only the recorded "preview loaded" event completes it.
    await _load_draft_preview(client, headers)
    statuses, current = await progress()
    assert statuses["preview"] == "completed"
    assert current == "nl_edit"

    # Step 8 — natural-language change plan: proposing alone must NOT complete this step.
    propose_res = await client.post(
        "/api/v1/storefront/change-plan", json={"instruction": "add a story about us"}, headers=headers
    )
    statuses, current = await progress()
    assert statuses["nl_edit"] == "available"
    assert current == "nl_edit"

    # Only actually applying the plan completes it.
    agent_run_id = propose_res.json()["agent_run_id"]
    await client.post(f"/api/v1/storefront/change-plan/{agent_run_id}/apply", headers=headers)
    statuses, current = await progress()
    assert statuses["nl_edit"] == "completed"
    assert current == "publish"

    # Step 9 — publish.
    await client.post("/api/v1/storefront/publish", headers=headers)
    statuses, current = await progress()
    assert statuses["publish"] == "completed"
    assert current == "run_business"

    # Step 10 — run the business: both a Store Manager health run AND an action plan are required.
    await client.post("/api/v1/store-manager/health", headers=headers)
    statuses, current = await progress()
    assert statuses["run_business"] == "available"
    assert current == "run_business"

    await client.post("/api/v1/store-manager/action-plan", headers=headers)
    statuses, current = await progress()
    assert statuses["run_business"] == "completed"
    assert current is None


async def test_nl_edit_proposing_alone_never_completes_the_step(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    await _advance_to_nl_edit_step(client, headers)

    await client.post(
        "/api/v1/storefront/change-plan", json={"instruction": "make the hero feel more premium"}, headers=headers
    )
    statuses, current = await _get_progress(client, headers)
    assert statuses["nl_edit"] == "available"
    assert current == "nl_edit"

    # Proposing a SECOND time (e.g. the owner revises their instruction) still doesn't complete
    # it — only an actual apply does.
    await client.post(
        "/api/v1/storefront/change-plan", json={"instruction": "try again, warmer tone"}, headers=headers
    )
    statuses, current = await _get_progress(client, headers)
    assert statuses["nl_edit"] == "available"
    assert current == "nl_edit"


async def test_nl_edit_a_failed_apply_leaves_the_step_incomplete(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    await _advance_to_nl_edit_step(client, headers)

    await client.post(
        "/api/v1/storefront/change-plan", json={"instruction": "make the hero feel more premium"}, headers=headers
    )
    statuses, _ = await _get_progress(client, headers)
    assert statuses["nl_edit"] == "available"

    # Applying a run that doesn't exist (or doesn't belong to this org) must fail, not silently
    # count as success.
    bogus_run_id = str(uuid.uuid4())
    fail_res = await client.post(f"/api/v1/storefront/change-plan/{bogus_run_id}/apply", headers=headers)
    assert fail_res.status_code >= 400

    statuses, current = await _get_progress(client, headers)
    assert statuses["nl_edit"] == "available"
    assert current == "nl_edit"


async def test_nl_edit_a_successful_apply_completes_the_step(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    await _advance_to_nl_edit_step(client, headers)

    propose_res = await client.post(
        "/api/v1/storefront/change-plan", json={"instruction": "make the hero feel more premium"}, headers=headers
    )
    agent_run_id = propose_res.json()["agent_run_id"]

    apply_res = await client.post(f"/api/v1/storefront/change-plan/{agent_run_id}/apply", headers=headers)
    assert apply_res.status_code == 200

    statuses, current = await _get_progress(client, headers)
    assert statuses["nl_edit"] == "completed"
    assert current == "publish"


async def test_nl_edit_refreshing_or_navigating_away_never_falsely_completes_the_step(client, seeded_owner):
    # Re-querying progress repeatedly (simulating a page refresh / navigating to another page and
    # back) must never advance the step on its own — only the real backend mutation does.
    headers = await _auth_headers(client, seeded_owner)
    await _advance_to_nl_edit_step(client, headers)

    await client.post(
        "/api/v1/storefront/change-plan", json={"instruction": "make the hero feel more premium"}, headers=headers
    )
    for _ in range(5):
        statuses, current = await _get_progress(client, headers)
        assert statuses["nl_edit"] == "available"
        assert current == "nl_edit"


async def test_nova_guide_is_a_real_agent_that_reads_real_progress(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)

    start_res = await client.post(
        "/api/v1/ai/conversations", json={"agent_key": "nova_guide", "context": {}}, headers=headers
    )
    assert start_res.status_code == 201
    conversation_id = start_res.json()["id"]

    msg_res = await client.post(
        f"/api/v1/ai/conversations/{conversation_id}/messages",
        json={"text": "What should I do next?"},
        headers=headers,
    )
    assert msg_res.status_code == 200
    body = msg_res.json()
    # A real tool round trip happened — not a hardcoded tooltip engine — and it never mutates.
    assert body["tool_call_log"][0]["name"] == "get_onboarding_progress"
    assert body["tool_call_log"][0]["is_mutating"] is False
    # Deterministic plain-English narration, not a raw dict repr of the tool result — a "Guide"
    # that echoes {'current_step': 'brand', 'steps': [...]} defeats the point of narrating.
    assert "current_step" not in body["assistant_text"]
    assert "Tell NOVA about your business" in body["assistant_text"]


async def test_the_demo_script_is_not_generated_by_the_backend(client, seeded_owner):
    # The Guide's lesson copy is authored in ONE place (admin/src/lib/novaScript.ts). The fake provider used
    # to carry a second, deterministic copy of the scripts keyed on prompt text; that conflicting duplicate
    # is gone, so a lesson-style prompt now just takes nova_guide's normal read-only tool path.
    headers = await _auth_headers(client, seeded_owner)
    start_res = await client.post("/api/v1/ai/conversations", json={"agent_key": "nova_guide", "context": {}}, headers=headers)
    res = await client.post(
        f"/api/v1/ai/conversations/{start_res.json()['id']}/messages",
        json={"text": "I'm about to demonstrate adding a product. Narrate what you're about to show me and why."},
        headers=headers,
    )
    assert res.status_code == 200
    assert res.json()["tool_call_log"][0]["name"] == "get_onboarding_progress"
    assert "Watch me first" not in res.json()["assistant_text"]


async def test_nova_guide_is_not_delegatable_by_store_manager(client, seeded_owner):
    # Store Manager may only delegate to specialists — never to the onboarding guide itself
    # (ARCHITECTURE.md "Onboarding — the NOVA Guide": it narrates, it doesn't get orchestrated).
    assert "nova_guide" not in DELEGATABLE_AGENT_KEYS
