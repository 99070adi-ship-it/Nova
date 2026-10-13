"""Server-verified preview event, validated/idempotent publish, and the seeded VELORA baseline
(draft/live separation, same public API, onboarding semantics, tenant isolation)."""

import uuid

from sqlalchemy import select, update

from app.db.models import StoreSection, StorefrontVersion, StorefrontVersionStatus
from app.db.session import AsyncSessionLocal


async def _headers(client, email, password):
    res = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def _owner_headers(client, seeded_owner):
    return await _headers(client, seeded_owner["email"], seeded_owner["password"])


async def _progress(client, headers):
    body = (await client.get("/api/v1/onboarding/progress", headers=headers)).json()
    return {s["key"]: s["status"] for s in body["steps"]}, body


async def _demo(client):
    """A brand-new isolated demo workspace through the real public entry point."""
    res = await client.post("/api/v1/auth/demo-login")
    assert res.status_code == 200
    headers = {"Authorization": f"Bearer {res.json()['access_token']}"}
    me = (await client.get("/api/v1/auth/me", headers=headers)).json()
    return headers, me["org_slug"]


async def _onboard_up_to_generation(client, headers):
    await client.post("/api/v1/store-creation/start", headers=headers)
    await client.put("/api/v1/store-creation/brand-input", json={"name": "Aurora Goods", "description": "Calm goods."}, headers=headers)
    d = (await client.post("/api/v1/store-creation/product-drafts", json={"title": "Tote", "price": 99, "sku": "T-1"}, headers=headers)).json()
    await client.post(f"/api/v1/store-creation/product-drafts/{d['id']}/generate", headers=headers)
    await client.post(f"/api/v1/store-creation/product-drafts/{d['id']}/accept", headers=headers)
    await client.post("/api/v1/collections", json={"title": "New", "slug": "new"}, headers=headers)
    await client.post("/api/v1/store-creation/generate-storefront", headers=headers)
    return (await client.get("/api/v1/storefront/draft", headers=headers)).json()["id"]


# ---------------------------------------------------------------- preview event

async def test_preview_event_is_recorded_once_and_is_idempotent(client, seeded_owner):
    headers = await _owner_headers(client, seeded_owner)
    draft_id = await _onboard_up_to_generation(client, headers)
    statuses, _ = await _progress(client, headers)
    assert statuses["preview"] == "available"  # generated + even fetched via GET is not "loaded"
    assert (await client.get(f"/api/v1/public/preview/{draft_id}")).status_code == 200
    statuses, _ = await _progress(client, headers)
    assert statuses["preview"] == "available", "merely serving the preview JSON must not complete the step"

    assert (await client.post(f"/api/v1/public/preview/{draft_id}/loaded")).status_code == 204
    async with AsyncSessionLocal() as db:
        first = (await db.execute(select(StorefrontVersion.preview_loaded_at).where(StorefrontVersion.id == uuid.UUID(draft_id)))).scalar_one()
    assert first is not None

    assert (await client.post(f"/api/v1/public/preview/{draft_id}/loaded")).status_code == 204
    async with AsyncSessionLocal() as db:
        second = (await db.execute(select(StorefrontVersion.preview_loaded_at).where(StorefrontVersion.id == uuid.UUID(draft_id)))).scalar_one()
    assert second == first, "first successful load wins; repeats never move the timestamp"
    statuses, _ = await _progress(client, headers)
    assert statuses["preview"] == "completed"


async def test_preview_event_for_unknown_version_is_404(client):
    assert (await client.post(f"/api/v1/public/preview/{uuid.uuid4()}/loaded")).status_code == 404


async def test_preview_of_the_live_version_is_never_recorded(client, seeded_owner):
    headers = await _owner_headers(client, seeded_owner)
    await _onboard_up_to_generation(client, headers)
    live_id = (await client.post("/api/v1/storefront/publish", headers=headers)).json()["id"]
    assert (await client.post(f"/api/v1/public/preview/{live_id}/loaded")).status_code == 204
    async with AsyncSessionLocal() as db:
        v = (await db.execute(select(StorefrontVersion).where(StorefrontVersion.id == uuid.UUID(live_id)))).scalar_one()
    assert v.preview_loaded_at is None


async def test_preview_of_a_draft_with_nothing_to_render_is_not_recorded(client, seeded_owner):
    headers = await _owner_headers(client, seeded_owner)
    draft = (await client.get("/api/v1/storefront/draft", headers=headers)).json()
    for section in draft["pages"][0]["sections"]:
        await client.delete(f"/api/v1/storefront/sections/{section['id']}", headers=headers)
    assert (await client.post(f"/api/v1/public/preview/{draft['id']}/loaded")).status_code == 204
    async with AsyncSessionLocal() as db:
        v = (await db.execute(select(StorefrontVersion).where(StorefrontVersion.id == uuid.UUID(draft["id"])))).scalar_one()
    assert v.preview_loaded_at is None


async def test_a_previewed_default_draft_does_not_complete_preview_and_regeneration_resets_it(client, seeded_owner):
    headers = await _owner_headers(client, seeded_owner)
    # Opening Store Builder (GET /storefront/draft) auto-creates a blank default draft…
    default_id = (await client.get("/api/v1/storefront/draft", headers=headers)).json()["id"]
    await client.post(f"/api/v1/public/preview/{default_id}/loaded")
    statuses, _ = await _progress(client, headers)
    # …which must not complete storefront or preview: neither was done by NOVA's generation step.
    assert statuses["storefront"] != "completed" and statuses["preview"] != "completed"

    draft_id = await _onboard_up_to_generation(client, headers)
    assert draft_id != default_id
    statuses, _ = await _progress(client, headers)
    assert statuses["storefront"] == "completed" and statuses["preview"] == "available"


# ---------------------------------------------------------------- publish

async def test_publish_rejects_a_draft_with_an_empty_home_page(client, seeded_owner):
    headers = await _owner_headers(client, seeded_owner)
    draft = (await client.get("/api/v1/storefront/draft", headers=headers)).json()
    for section in draft["pages"][0]["sections"]:
        await client.delete(f"/api/v1/storefront/sections/{section['id']}", headers=headers)
    res = await client.post("/api/v1/storefront/publish", headers=headers)
    assert res.status_code == 422
    assert (await client.get("/api/v1/storefront/live", headers=headers)).status_code == 404


async def test_publish_is_idempotent_until_the_draft_changes(client, seeded_owner):
    headers = await _owner_headers(client, seeded_owner)
    await client.get("/api/v1/storefront/draft", headers=headers)
    first = (await client.post("/api/v1/storefront/publish", headers=headers)).json()
    again = (await client.post("/api/v1/storefront/publish", headers=headers)).json()
    assert again["id"] == first["id"]
    await client.patch("/api/v1/storefront/theme", json={"primary_color": "#112233"}, headers=headers)
    changed = (await client.post("/api/v1/storefront/publish", headers=headers)).json()
    assert changed["id"] != first["id"]


# ---------------------------------------------------------------- seeded baseline

async def test_new_demo_workspace_has_a_live_baseline_served_by_the_real_public_api(client):
    headers, slug = await _demo(client)
    res = await client.get(f"/api/v1/public/stores/{slug}/storefront")
    assert res.status_code == 200
    body = res.json()
    types = [s["type"] for s in body["pages"][0]["sections"]]
    assert types == ["hero", "product_grid", "brand_story"]
    assert body["pages"][0]["sections"][0]["configuration"]["headline"] == "Quiet leather, made to last."
    assert body["theme"]["primary_color"] == "#2A1D15"
    products = (await client.get(f"/api/v1/public/stores/{slug}/products")).json()
    assert len(products) == 26


async def test_baseline_does_not_complete_any_onboarding_step(client):
    headers, _ = await _demo(client)
    statuses, body = await _progress(client, headers)
    assert body["current_step"] == "brand"
    assert statuses["publish"] == "locked", "a live baseline must not count as the owner publishing"
    assert statuses["storefront"] == "locked" and statuses["preview"] == "locked"
    assert statuses["collections"] == "completed"  # genuinely satisfied by the seeded catalog
    assert body["total_steps"] == 10


async def test_baseline_stays_live_while_the_draft_is_edited_then_publish_replaces_it(client):
    headers, slug = await _demo(client)
    public = f"/api/v1/public/stores/{slug}/storefront"
    baseline = (await client.get(public)).json()

    # A draft starts as an editable copy of what's live — not a blank default.
    draft = (await client.get("/api/v1/storefront/draft", headers=headers)).json()
    assert draft["status"] == "draft"
    assert [s["type"] for s in draft["pages"][0]["sections"]] == ["hero", "product_grid", "brand_story"]
    hero = draft["pages"][0]["sections"][0]
    await client.patch(
        f"/api/v1/storefront/sections/{hero['id']}",
        json={"configuration": {**hero["configuration"], "headline": "Edited in the draft"}}, headers=headers,
    )
    assert (await client.get(public)).json() == baseline, "editing the draft must not touch what customers see"
    preview = (await client.get(f"/api/v1/public/preview/{draft['id']}")).json()
    assert preview["pages"][0]["sections"][0]["configuration"]["headline"] == "Edited in the draft"

    # Publishing a copied, non-generated draft still isn't the onboarding publish step (not generated).
    published = (await client.post("/api/v1/storefront/publish", headers=headers)).json()
    live = (await client.get(public)).json()
    assert live["pages"][0]["sections"][0]["configuration"]["headline"] == "Edited in the draft"
    assert published["status"] == "live"
    statuses, _ = await _progress(client, headers)
    assert statuses["publish"] != "completed"


async def test_demo_workspaces_are_isolated_from_each_other(client):
    headers_a, slug_a = await _demo(client)
    # httpx keeps the refresh cookie on the client, which would resume workspace A. Clear it.
    client.cookies.clear()
    res_b = await client.post("/api/v1/auth/demo-login")
    headers_b = {"Authorization": f"Bearer {res_b.json()['access_token']}"}
    slug_b = (await client.get("/api/v1/auth/me", headers=headers_b)).json()["org_slug"]
    assert slug_a != slug_b
    draft_a = (await client.get("/api/v1/storefront/draft", headers=headers_a)).json()
    hero = draft_a["pages"][0]["sections"][0]
    await client.patch(f"/api/v1/storefront/sections/{hero['id']}", json={"configuration": {"headline": "A only"}}, headers=headers_a)
    await client.post("/api/v1/storefront/publish", headers=headers_a)
    b_live = (await client.get(f"/api/v1/public/stores/{slug_b}/storefront")).json()
    assert b_live["pages"][0]["sections"][0]["configuration"]["headline"] == "Quiet leather, made to last."
    # B's token can't read A's draft id through the authenticated API either.
    assert (await client.get("/api/v1/storefront/draft", headers=headers_b)).json()["id"] != draft_a["id"]


async def test_full_demo_onboarding_publishes_the_generated_draft_over_the_baseline(client):
    headers, slug = await _demo(client)
    public = f"/api/v1/public/stores/{slug}/storefront"
    baseline = (await client.get(public)).json()

    await client.post("/api/v1/store-creation/start", headers=headers)
    await client.put("/api/v1/store-creation/brand-input", json={"name": "Velora", "description": "Quiet luxury leather goods."}, headers=headers)
    d = (await client.post("/api/v1/store-creation/product-drafts", json={"title": "Quilted Mini Crossbody", "price": 240, "sku": "QMC-1"}, headers=headers)).json()
    await client.post(f"/api/v1/store-creation/product-drafts/{d['id']}/generate", headers=headers)
    await client.post(f"/api/v1/store-creation/product-drafts/{d['id']}/accept", headers=headers)
    statuses, body = await _progress(client, headers)
    assert statuses["collections"] == "completed"
    assert body["current_step"] == "storefront"  # collections was already satisfied; the baseline is untouched
    assert (await client.get(public)).json() == baseline

    await client.post("/api/v1/store-creation/generate-storefront", headers=headers)
    draft_id = (await client.get("/api/v1/storefront/draft", headers=headers)).json()["id"]
    assert (await client.get(public)).json() == baseline, "generating a draft must not touch the live baseline"
    await client.post(f"/api/v1/public/preview/{draft_id}/loaded")
    plan = (await client.post("/api/v1/storefront/change-plan", json={"instruction": "make the hero feel more premium"}, headers=headers)).json()
    await client.post(f"/api/v1/storefront/change-plan/{plan['agent_run_id']}/apply", headers=headers)
    statuses, body = await _progress(client, headers)
    assert body["current_step"] == "publish", statuses

    assert (await client.post("/api/v1/storefront/publish", headers=headers)).status_code == 200
    statuses, body = await _progress(client, headers)
    assert statuses["publish"] == "completed" and body["current_step"] == "run_business"
    assert (await client.get(public)).json() != baseline
