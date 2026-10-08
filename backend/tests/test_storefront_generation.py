async def _auth_headers(client, seeded_owner):
    res = await client.post("/api/v1/auth/login", json={"email": seeded_owner["email"], "password": seeded_owner["password"]})
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def test_generate_requires_brand_profile(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    await client.post("/api/v1/store-creation/start", headers=headers)
    res = await client.post("/api/v1/store-creation/generate-storefront", headers=headers)
    assert res.status_code == 422


async def test_generate_builds_brand_informed_draft_and_advances_session(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    await client.post("/api/v1/store-creation/start", headers=headers)
    await client.put(
        "/api/v1/store-creation/brand-input",
        json={"name": "Test Co", "description": "We make things.", "vibe_text": "warm and playful"},
        headers=headers,
    )

    res = await client.post("/api/v1/store-creation/generate-storefront", headers=headers)
    assert res.status_code == 200
    assert res.json()["status"] == "ready_for_review"

    draft_res = await client.get("/api/v1/storefront/draft", headers=headers)
    draft = draft_res.json()
    # Real AI path (through the FakeLLMProvider, deterministic — see test below for the OpenAI-
    # compatible provider's own coverage) actually ran: generated_by=ai now genuinely reflects a
    # completed AIAgentRun, not a bare template bypassing the provider entirely.
    assert draft["generated_by"] == "ai"
    section_types = [s["type"] for s in draft["pages"][0]["sections"]]
    assert section_types == ["hero", "brand_story", "product_grid"]
    assert draft["pages"][0]["sections"][0]["configuration"]["headline"] == "Test Co"
    assert draft["pages"][0]["sections"][1]["configuration"]["body"] == "We make things."


async def test_generate_grounds_product_grid_in_a_real_known_collection(client, seeded_owner):
    # "generate the storefront structure/content from the actual brand/product/collection
    # context" — not just brand text. The FakeLLMProvider reads real collections from context.
    headers = await _auth_headers(client, seeded_owner)
    await client.post("/api/v1/store-creation/start", headers=headers)
    await client.put("/api/v1/store-creation/brand-input", json={"name": "Test Co"}, headers=headers)
    collection_res = await client.post(
        "/api/v1/collections", json={"title": "New Arrivals", "slug": "new-arrivals"}, headers=headers
    )
    collection_id = collection_res.json()["id"]

    await client.post("/api/v1/store-creation/generate-storefront", headers=headers)
    draft = (await client.get("/api/v1/storefront/draft", headers=headers)).json()
    product_grid = next(s for s in draft["pages"][0]["sections"] if s["type"] == "product_grid")
    assert product_grid["configuration"]["collection_id"] == collection_id


async def test_generate_provider_failure_creates_no_draft_and_fails_run_closed(client, seeded_owner, monkeypatch):
    from tests.test_ai_reliability import _ExplodingProvider, _assert_safe_error

    import app.services.storefront_generation_service as storefront_generation_service

    headers = await _auth_headers(client, seeded_owner)
    await client.post("/api/v1/store-creation/start", headers=headers)
    await client.put("/api/v1/store-creation/brand-input", json={"name": "Test Co"}, headers=headers)

    # No draft exists yet — confirms a failure never fabricates a misleadingly AI-labeled one.
    live_res_before = await client.get("/api/v1/storefront/live", headers=headers)
    assert live_res_before.status_code == 404
    draft_before = await client.get("/api/v1/storefront/draft", headers=headers)
    assert draft_before.json()["generated_by"] != "ai"  # the bare owner-default draft, not AI

    monkeypatch.setattr(storefront_generation_service, "build_llm_provider", lambda: _ExplodingProvider())
    res = await client.post("/api/v1/store-creation/generate-storefront", headers=headers)
    assert res.status_code == 503
    _assert_safe_error(res.json())

    # Still the untouched bare default — no new StorefrontVersion, no AI label, from the failure.
    draft_after = await client.get("/api/v1/storefront/draft", headers=headers)
    assert draft_after.json()["id"] == draft_before.json()["id"]
    assert draft_after.json()["generated_by"] != "ai"

    # Onboarding must not falsely advance past a failed generation.
    session_res = await client.get("/api/v1/store-creation/current", headers=headers)
    assert session_res.json()["status"] != "ready_for_review"

    from sqlalchemy import select

    from app.db.models import AgentRunStatus, AIAgentRun
    from app.db.session import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        runs = (
            await db.execute(
                select(AIAgentRun).where(AIAgentRun.org_id == seeded_owner["org_id"], AIAgentRun.agent_key == "storefront_generation")
            )
        ).scalars().all()
    assert len(runs) == 1
    assert runs[0].status == AgentRunStatus.failed


async def test_generate_malformed_structured_output_falls_back_safely(client, seeded_owner, monkeypatch):
    # A provider that responds successfully but with unparseable/invalid JSON is NOT a provider
    # failure — it must still produce a valid, safely-defaulted draft rather than crash or 500.
    from app.ai.fake_provider import FakeLLMProvider
    from app.ai.provider import ProviderFinal, ProviderStepResult

    import app.services.storefront_generation_service as storefront_generation_service

    headers = await _auth_headers(client, seeded_owner)
    await client.post("/api/v1/store-creation/start", headers=headers)
    await client.put("/api/v1/store-creation/brand-input", json={"name": "Malformed Co"}, headers=headers)

    broken_provider = FakeLLMProvider(script=[ProviderStepResult(final=ProviderFinal(text="not json at all"))])
    monkeypatch.setattr(storefront_generation_service, "build_llm_provider", lambda: broken_provider)

    res = await client.post("/api/v1/store-creation/generate-storefront", headers=headers)
    assert res.status_code == 200

    draft = (await client.get("/api/v1/storefront/draft", headers=headers)).json()
    assert draft["generated_by"] == "ai"
    section_types = [s["type"] for s in draft["pages"][0]["sections"]]
    assert section_types == ["hero", "product_grid"]  # fallback plan — no brand description supplied
    assert draft["pages"][0]["sections"][0]["configuration"]["headline"] == "Malformed Co"


async def test_generate_then_preview_and_publish_still_works(client, seeded_owner):
    # End-to-end: preserved preview flow (the draft's own id is the real preview) and publish.
    headers = await _auth_headers(client, seeded_owner)
    await client.post("/api/v1/store-creation/start", headers=headers)
    await client.put("/api/v1/store-creation/brand-input", json={"name": "Preview Co"}, headers=headers)
    await client.post("/api/v1/store-creation/generate-storefront", headers=headers)

    draft = (await client.get("/api/v1/storefront/draft", headers=headers)).json()
    assert draft["status"] == "draft"

    live_before = await client.get("/api/v1/storefront/live", headers=headers)
    assert live_before.status_code == 404  # nothing published yet — still a draft, as required

    publish_res = await client.post("/api/v1/storefront/publish", headers=headers)
    assert publish_res.status_code == 200
    live_after = await client.get("/api/v1/storefront/live", headers=headers)
    assert live_after.status_code == 200
    # A snapshot copy, not the same rows (fresh ids) — content matches.
    live_sections = [(s["type"], s["configuration"]) for s in live_after.json()["pages"][0]["sections"]]
    draft_sections = [(s["type"], s["configuration"]) for s in draft["pages"][0]["sections"]]
    assert live_sections == draft_sections


async def test_generate_then_preview_then_publish_then_public_live_fetch_all_resolve_by_the_real_org_slug(client, seeded_owner):
    # Regression for the browser-reported 404: generate -> open draft preview -> publish -> open
    # the live storefront must all resolve correctly, and "open the live storefront" specifically
    # means the PUBLIC, unauthenticated endpoint the separate customer-facing storefront SPA
    # actually calls (by org slug) — not just the authenticated admin /storefront/live endpoint,
    # which test_generate_then_preview_and_publish_still_works above already covers. The real bug
    # was never in this backend path (it was the admin app linking the storefront SPA to a
    # hardcoded default slug instead of the signed-in user's own real one) — this test pins down
    # that the backend side of the full flow has always been, and remains, correct by the real
    # slug a frontend would actually use.
    headers = await _auth_headers(client, seeded_owner)
    org_slug = seeded_owner["org_slug"]

    # /me's org_slug (what the admin frontend actually uses to build the live storefront link)
    # must be the visitor's own real slug.
    me_res = await client.get("/api/v1/auth/me", headers=headers)
    assert me_res.json()["org_slug"] == org_slug

    await client.post("/api/v1/store-creation/start", headers=headers)
    await client.put("/api/v1/store-creation/brand-input", json={"name": "Preview Co"}, headers=headers)
    generate_res = await client.post("/api/v1/store-creation/generate-storefront", headers=headers)
    assert generate_res.status_code == 200

    draft = (await client.get("/api/v1/storefront/draft", headers=headers)).json()

    # Open draft preview — publicly readable by the draft's own id, no slug needed.
    preview_res = await client.get(f"/api/v1/public/preview/{draft['id']}")
    assert preview_res.status_code == 200

    # Before publishing, the public live-by-slug endpoint has nothing to show yet.
    public_live_before = await client.get(f"/api/v1/public/stores/{org_slug}/storefront")
    assert public_live_before.status_code == 404

    publish_res = await client.post("/api/v1/storefront/publish", headers=headers)
    assert publish_res.status_code == 200

    # Open the live storefront — the real customer-facing path, by the real org slug.
    public_live_after = await client.get(f"/api/v1/public/stores/{org_slug}/storefront")
    assert public_live_after.status_code == 200
    section_types = [s["type"] for s in public_live_after.json()["pages"][0]["sections"]]
    assert "hero" in section_types

    # The published version genuinely renders what was generated, not a stale/different draft —
    # compared by (type, configuration), not raw dicts: publishing snapshots fresh rows (new ids)
    # and the public schema never exposes ids at all.
    public_sections = [(s["type"], s["configuration"]) for s in public_live_after.json()["pages"][0]["sections"]]
    draft_sections = [(s["type"], s["configuration"]) for s in draft["pages"][0]["sections"]]
    assert public_sections == draft_sections


async def test_change_plan_propose_then_apply(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    await client.post("/api/v1/store-creation/start", headers=headers)
    await client.put("/api/v1/store-creation/brand-input", json={"name": "Test Co"}, headers=headers)

    propose_res = await client.post("/api/v1/storefront/change-plan", json={"instruction": "add a story about us"}, headers=headers)
    assert propose_res.status_code == 201
    body = propose_res.json()
    assert body["applied"] is False
    assert body["plan"][0]["action"] == "add_section"
    assert body["plan"][0]["section_type"] == "brand_story"
    run_id = body["agent_run_id"]

    # Proposing must NOT have touched the draft yet.
    draft_before = await client.get("/api/v1/storefront/draft", headers=headers)
    before_types = [s["type"] for s in draft_before.json()["pages"][0]["sections"]]
    assert "brand_story" not in before_types

    apply_res = await client.post(f"/api/v1/storefront/change-plan/{run_id}/apply", headers=headers)
    assert apply_res.status_code == 200
    after_types = [s["type"] for s in apply_res.json()["pages"][0]["sections"]]
    assert "brand_story" in after_types

    # Re-applying the same plan must be rejected.
    reapply_res = await client.post(f"/api/v1/storefront/change-plan/{run_id}/apply", headers=headers)
    assert reapply_res.status_code == 409


async def test_change_plan_with_no_matching_keywords_is_a_no_op(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    await client.post("/api/v1/store-creation/start", headers=headers)
    await client.put("/api/v1/store-creation/brand-input", json={"name": "Test Co"}, headers=headers)

    propose_res = await client.post("/api/v1/storefront/change-plan", json={"instruction": "xyzzy plugh"}, headers=headers)
    assert propose_res.json()["plan"][0]["action"] == "none"
