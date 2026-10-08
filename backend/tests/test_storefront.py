async def _auth_headers(client, seeded_owner):
    res = await client.post("/api/v1/auth/login", json={"email": seeded_owner["email"], "password": seeded_owner["password"]})
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def test_draft_is_auto_created_with_default_homepage(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    res = await client.get("/api/v1/storefront/draft", headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "draft"
    assert body["pages"][0]["slug"] == "home"
    section_types = [s["type"] for s in body["pages"][0]["sections"]]
    assert "hero" in section_types
    assert "product_grid" in section_types


async def test_publish_creates_live_snapshot(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    live_before = await client.get("/api/v1/storefront/live", headers=headers)
    assert live_before.status_code == 404

    publish_res = await client.post("/api/v1/storefront/publish", headers=headers)
    assert publish_res.status_code == 200
    assert publish_res.json()["status"] == "live"

    live_after = await client.get("/api/v1/storefront/live", headers=headers)
    assert live_after.status_code == 200


async def test_public_storefront_requires_valid_org_slug(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    await client.post("/api/v1/storefront/publish", headers=headers)

    ok_res = await client.get(f"/api/v1/public/stores/{seeded_owner['org_slug']}/storefront")
    assert ok_res.status_code == 200
    assert ok_res.json()["pages"][0]["slug"] == "home"

    missing_res = await client.get("/api/v1/public/stores/does-not-exist/storefront")
    assert missing_res.status_code == 404


async def test_draft_preview_is_publicly_readable_by_version_id_without_publishing(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    draft_res = await client.get("/api/v1/storefront/draft", headers=headers)
    draft_id = draft_res.json()["id"]

    # No publish happened — the live public endpoint has nothing to show.
    live_res = await client.get(f"/api/v1/public/stores/{seeded_owner['org_slug']}/storefront")
    assert live_res.status_code == 404

    preview_res = await client.get(f"/api/v1/public/preview/{draft_id}")
    assert preview_res.status_code == 200
    assert preview_res.json()["pages"][0]["slug"] == "home"
    section_types = [s["type"] for s in preview_res.json()["pages"][0]["sections"]]
    assert "hero" in section_types


async def test_preview_404s_for_unknown_version_id(client, seeded_owner):
    res = await client.get("/api/v1/public/preview/00000000-0000-0000-0000-000000000000")
    assert res.status_code == 404


async def test_public_products_only_shows_published(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    org_slug = seeded_owner["org_slug"]

    draft_res = await client.post(
        "/api/v1/products",
        json={"title": "Unpublished Item", "slug": "unpublished-item", "variants": [{"sku": "UNPUB-1", "price": 10}]},
        headers=headers,
    )
    published_res = await client.post(
        "/api/v1/products",
        json={"title": "Published Item", "slug": "published-item", "variants": [{"sku": "PUB-1", "price": 20}]},
        headers=headers,
    )
    await client.patch(f"/api/v1/products/{published_res.json()['id']}", json={"status": "published"}, headers=headers)

    public_res = await client.get(f"/api/v1/public/stores/{org_slug}/products")
    assert public_res.status_code == 200
    titles = [p["title"] for p in public_res.json()]
    assert "Published Item" in titles
    assert "Unpublished Item" not in titles

    detail_res = await client.get(f"/api/v1/public/stores/{org_slug}/products/published-item")
    assert detail_res.status_code == 200

    unpublished_detail_res = await client.get(f"/api/v1/public/stores/{org_slug}/products/unpublished-item")
    assert unpublished_detail_res.status_code == 404

    assert draft_res.status_code == 201  # sanity: the draft product really was created
