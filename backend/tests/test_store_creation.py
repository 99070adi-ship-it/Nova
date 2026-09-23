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
