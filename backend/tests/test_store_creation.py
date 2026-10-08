async def _auth_headers(client, seeded_owner):
    res = await client.post("/api/v1/auth/login", json={"email": seeded_owner["email"], "password": seeded_owner["password"]})
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def test_create_my_store_full_flow(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)

    start_res = await client.post("/api/v1/store-creation/start", headers=headers)
    assert start_res.status_code == 200
    assert start_res.json()["status"] == "brand_input"

    # Calling start again returns the SAME session, not a new one.
    start_again = await client.post("/api/v1/store-creation/start", headers=headers)
    assert start_again.json()["id"] == start_res.json()["id"]

    brand_res = await client.put(
        "/api/v1/store-creation/brand-input",
        json={"name": "Test Brand", "sells_what": "candles", "vibe_text": "cozy"},
        headers=headers,
    )
    assert brand_res.status_code == 200
    assert brand_res.json()["status"] == "product_input"

    complete_draft = await client.post(
        "/api/v1/store-creation/product-drafts",
        json={"title": "Vanilla Candle", "price": 24, "sku": "CAN-001"},
        headers=headers,
    )
    assert complete_draft.status_code == 201
    assert complete_draft.json()["field_status"]["title"] == "known"
    assert complete_draft.json()["field_status"]["description"] == "requires_confirmation"

    incomplete_draft = await client.post(
        "/api/v1/store-creation/product-drafts", json={"title": "Mystery Candle"}, headers=headers
    )
    assert incomplete_draft.status_code == 201

    list_res = await client.get("/api/v1/store-creation/product-drafts", headers=headers)
    assert len(list_res.json()) == 2

    accept_res = await client.post(
        f"/api/v1/store-creation/product-drafts/{complete_draft.json()['id']}/accept", headers=headers
    )
    assert accept_res.status_code == 200
    assert accept_res.json()["status"] == "accepted"
    assert accept_res.json()["accepted_product_id"] is not None

    # A second accept on the same draft must fail — it's not "proposed" anymore.
    reaccept_res = await client.post(
        f"/api/v1/store-creation/product-drafts/{complete_draft.json()['id']}/accept", headers=headers
    )
    assert reaccept_res.status_code == 409

    reject_res = await client.post(
        f"/api/v1/store-creation/product-drafts/{incomplete_draft.json()['id']}/reject", headers=headers
    )
    assert reject_res.status_code == 200
    assert reject_res.json()["status"] == "rejected"

    # The accepted product actually exists and has inventory.
    products_res = await client.get("/api/v1/products", headers=headers)
    assert any(p["title"] == "Vanilla Candle" for p in products_res.json())


async def test_accept_draft_missing_required_fields_fails(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    await client.post("/api/v1/store-creation/start", headers=headers)
    draft = await client.post(
        "/api/v1/store-creation/product-drafts", json={"title": "No Price Item"}, headers=headers
    )
    accept_res = await client.post(f"/api/v1/store-creation/product-drafts/{draft.json()['id']}/accept", headers=headers)
    assert accept_res.status_code == 422


async def test_update_draft_fills_requires_confirmation_fields_then_accept_succeeds(client, seeded_owner):
    # The exact stuck-draft scenario above (price/sku are never AI-generated, so a photo-only
    # draft stays requires_confirmation forever without this edit path) must be recoverable.
    headers = await _auth_headers(client, seeded_owner)
    await client.post("/api/v1/store-creation/start", headers=headers)
    draft = await client.post(
        "/api/v1/store-creation/product-drafts", json={"title": "No Price Item"}, headers=headers
    )
    draft_id = draft.json()["id"]
    assert draft.json()["field_status"]["price"] == "requires_confirmation"
    assert draft.json()["field_status"]["sku"] == "requires_confirmation"

    update_res = await client.patch(
        f"/api/v1/store-creation/product-drafts/{draft_id}", json={"price": 24, "sku": "NPI-001"}, headers=headers
    )
    assert update_res.status_code == 200
    assert update_res.json()["fields"]["price"] == 24
    assert update_res.json()["fields"]["sku"] == "NPI-001"
    assert update_res.json()["field_status"]["price"] == "known"
    assert update_res.json()["field_status"]["sku"] == "known"
    # Untouched fields are left exactly as they were.
    assert update_res.json()["field_status"]["description"] == "requires_confirmation"

    accept_res = await client.post(f"/api/v1/store-creation/product-drafts/{draft_id}/accept", headers=headers)
    assert accept_res.status_code == 200
    assert accept_res.json()["status"] == "accepted"


async def test_update_draft_can_override_a_suggested_field(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    await client.post("/api/v1/store-creation/start", headers=headers)
    await client.put("/api/v1/store-creation/brand-input", json={"name": "Test Co"}, headers=headers)
    draft = await client.post(
        "/api/v1/store-creation/product-drafts", json={"title": "Widget", "price": 10, "sku": "W-1"}, headers=headers
    )
    draft_id = draft.json()["id"]
    await client.post(f"/api/v1/store-creation/product-drafts/{draft_id}/generate", headers=headers)

    update_res = await client.patch(
        f"/api/v1/store-creation/product-drafts/{draft_id}", json={"description": "Hand-picked wording."}, headers=headers
    )
    assert update_res.status_code == 200
    assert update_res.json()["fields"]["description"] == "Hand-picked wording."
    assert update_res.json()["field_status"]["description"] == "known"


async def test_update_finalized_draft_is_rejected(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    await client.post("/api/v1/store-creation/start", headers=headers)
    draft = await client.post(
        "/api/v1/store-creation/product-drafts", json={"title": "Widget", "price": 10, "sku": "W-1"}, headers=headers
    )
    draft_id = draft.json()["id"]
    await client.post(f"/api/v1/store-creation/product-drafts/{draft_id}/accept", headers=headers)

    update_res = await client.patch(
        f"/api/v1/store-creation/product-drafts/{draft_id}", json={"price": 99}, headers=headers
    )
    assert update_res.status_code == 409


async def test_use_sample_products_creates_fully_specified_drafts_ready_to_accept(client, seeded_owner):
    # The onboarding shortcut (Guide step 2's "Use VELORA Sample Products") — every field must be
    # `known` already, so the merchant can accept immediately without hunting down missing data.
    headers = await _auth_headers(client, seeded_owner)
    await client.post("/api/v1/store-creation/start", headers=headers)

    res = await client.post("/api/v1/store-creation/product-drafts/use-sample-products", headers=headers)
    assert res.status_code == 201
    drafts = res.json()
    assert len(drafts) == 5
    for draft in drafts:
        assert draft["fields"]["title"] and draft["fields"]["price"] and draft["fields"]["sku"]
        for field in ("title", "price", "sku", "category", "description", "tags"):
            assert draft["field_status"][field] == "known"

    accept_res = await client.post(f"/api/v1/store-creation/product-drafts/{drafts[0]['id']}/accept", headers=headers)
    assert accept_res.status_code == 200
    assert accept_res.json()["status"] == "accepted"
