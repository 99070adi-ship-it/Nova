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
    assert draft["generated_by"] == "ai"
    section_types = [s["type"] for s in draft["pages"][0]["sections"]]
    assert section_types == ["hero", "brand_story", "product_grid"]
    assert draft["pages"][0]["sections"][0]["configuration"]["headline"] == "Test Co"
    assert draft["pages"][0]["sections"][1]["configuration"]["body"] == "We make things."


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
