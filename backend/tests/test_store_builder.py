async def _auth_headers(client, seeded_owner):
    res = await client.post("/api/v1/auth/login", json={"email": seeded_owner["email"], "password": seeded_owner["password"]})
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def test_edit_section_and_theme_then_publish(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    draft = (await client.get("/api/v1/storefront/draft", headers=headers)).json()
    page_id = draft["pages"][0]["id"]
    hero_id = draft["pages"][0]["sections"][0]["id"]

    update_res = await client.patch(
        f"/api/v1/storefront/sections/{hero_id}", json={"configuration": {"headline": "New Headline"}}, headers=headers
    )
    assert update_res.status_code == 200
    updated_hero = update_res.json()["pages"][0]["sections"][0]
    assert updated_hero["configuration"]["headline"] == "New Headline"

    add_res = await client.post(
        "/api/v1/storefront/sections",
        json={"page_id": page_id, "type": "brand_story", "order": 2, "configuration": {"heading": "Story"}},
        headers=headers,
    )
    assert add_res.status_code == 201
    assert len(add_res.json()["pages"][0]["sections"]) == 3

    theme_res = await client.patch("/api/v1/storefront/theme", json={"primary_color": "#000000"}, headers=headers)
    assert theme_res.status_code == 200
    assert theme_res.json()["theme"]["primary_color"] == "#000000"

    diff_before = await client.get("/api/v1/storefront/diff", headers=headers)
    assert "No changes" not in diff_before.json()["changes"][0]

    publish_res = await client.post("/api/v1/storefront/publish", headers=headers)
    assert publish_res.status_code == 200
    assert len(publish_res.json()["pages"][0]["sections"]) == 3

    diff_after = await client.get("/api/v1/storefront/diff", headers=headers)
    assert diff_after.json()["changes"] == ["No changes since last publish"]

    new_section_id = [s["id"] for s in add_res.json()["pages"][0]["sections"] if s["type"] == "brand_story"][0]
    delete_res = await client.delete(f"/api/v1/storefront/sections/{new_section_id}", headers=headers)
    assert delete_res.status_code == 200
    assert len(delete_res.json()["pages"][0]["sections"]) == 2

    diff_after_delete = await client.get("/api/v1/storefront/diff", headers=headers)
    assert "brand_story" in diff_after_delete.json()["changes"][0]


async def test_cannot_edit_section_that_belongs_to_live_version(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    live = (await client.post("/api/v1/storefront/publish", headers=headers)).json()
    live_section_id = live["pages"][0]["sections"][0]["id"]

    # That section id belongs to the LIVE version, not the current draft — editing it must 404,
    # since edits are only ever allowed against the draft (ARCHITECTURE.md "Store Builder").
    res = await client.patch(f"/api/v1/storefront/sections/{live_section_id}", json={"order": 5}, headers=headers)
    assert res.status_code == 404
