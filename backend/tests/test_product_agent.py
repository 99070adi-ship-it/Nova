async def _auth_headers(client, seeded_owner):
    res = await client.post("/api/v1/auth/login", json={"email": seeded_owner["email"], "password": seeded_owner["password"]})
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def test_generate_content_never_overwrites_known_fields(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    await client.post("/api/v1/store-creation/start", headers=headers)
    await client.put(
        "/api/v1/store-creation/brand-input",
        json={"name": "Test Brand", "vibe_text": "bold and modern", "target_customer": "everyone"},
        headers=headers,
    )

    draft_res = await client.post(
        "/api/v1/store-creation/product-drafts",
        json={"title": "Widget", "price": 10, "sku": "W-1", "description": "A hand-written description"},
        headers=headers,
    )
    draft_id = draft_res.json()["id"]
    assert draft_res.json()["field_status"]["description"] == "known"

    generate_res = await client.post(f"/api/v1/store-creation/product-drafts/{draft_id}/generate", headers=headers)
    assert generate_res.status_code == 200
    body = generate_res.json()
    assert body["status"] == "generated"
    # The owner's hand-written description must survive untouched.
    assert body["fields"]["description"] == "A hand-written description"
    assert body["field_status"]["description"] == "known"
    # Fields the owner never provided get filled in as "suggested".
    assert body["field_status"]["category"] == "suggested"
    assert body["field_status"]["seo_title"] == "suggested"
    assert body["fields"]["seo_title"]


async def test_generate_content_requires_valid_draft_state(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    await client.post("/api/v1/store-creation/start", headers=headers)
    draft_res = await client.post("/api/v1/store-creation/product-drafts", json={"title": "X"}, headers=headers)
    draft_id = draft_res.json()["id"]

    await client.post(f"/api/v1/store-creation/product-drafts/{draft_id}/reject", headers=headers)

    res = await client.post(f"/api/v1/store-creation/product-drafts/{draft_id}/generate", headers=headers)
    assert res.status_code == 409


async def test_accept_creates_canonical_image_and_lifestyle_generation_works(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    await client.post("/api/v1/store-creation/start", headers=headers)
    await client.put("/api/v1/store-creation/brand-input", json={"name": "Test Brand"}, headers=headers)

    draft_res = await client.post(
        "/api/v1/store-creation/product-drafts",
        json={"title": "Bag", "price": 50, "sku": "BAG-1", "source_image_refs": ["https://example.com/bag.jpg"]},
        headers=headers,
    )
    draft_id = draft_res.json()["id"]
    accept_res = await client.post(f"/api/v1/store-creation/product-drafts/{draft_id}/accept", headers=headers)
    product_id = accept_res.json()["accepted_product_id"]

    images_res = await client.get(f"/api/v1/products/{product_id}/images", headers=headers)
    assert len(images_res.json()) == 1
    canonical = images_res.json()[0]
    assert canonical["role"] == "canonical"
    assert canonical["url"] == "https://example.com/bag.jpg"

    generate_res = await client.post(
        f"/api/v1/products/{product_id}/images/generate", json={"environment": "studio", "mood": "minimal"}, headers=headers
    )
    assert generate_res.status_code == 201
    generated = generate_res.json()
    assert generated["role"] == "generated"
    assert generated["is_ai_generated"] is True
    assert generated["source_image_id"] == canonical["id"]


async def test_lifestyle_generation_requires_canonical_image(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    create_res = await client.post(
        "/api/v1/products", json={"title": "No Photo Item", "slug": "no-photo-item", "variants": [{"sku": "NP-1", "price": 5}]},
        headers=headers,
    )
    product_id = create_res.json()["id"]

    res = await client.post(f"/api/v1/products/{product_id}/images/generate", json={}, headers=headers)
    assert res.status_code == 422
