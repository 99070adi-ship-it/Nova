"""Store Builder and the customer-facing storefront as one product: edits stay in a draft, the preview shows exactly
that draft, publishing is what changes the public store (including its theme), a failed generation never disturbs
what is live, and one store's public routes never expose another's data."""


from tests.test_preview_publish_baseline import _demo


async def test_edit_preview_publish_flow_with_theme_tokens(client):
    headers, slug = await _demo(client)
    public = f"/api/v1/public/stores/{slug}/storefront"
    live_before = (await client.get(public)).json()
    assert live_before["theme"]["primary_color"] == "#2A1D15" and live_before["org_slug"] == slug

    # 1-2. An authorized edit changes only the DRAFT.
    draft = (await client.get("/api/v1/storefront/draft", headers=headers)).json()
    await client.patch("/api/v1/storefront/theme", json={"primary_color": "#123456", "background_color": "#FFFFFF"}, headers=headers)
    hero = next(s for s in draft["pages"][0]["sections"] if s["type"] == "hero")
    await client.patch(f"/api/v1/storefront/sections/{hero['id']}", json={"configuration": {**hero["configuration"], "headline": "A new headline"}}, headers=headers)
    live_during = (await client.get(public)).json()
    assert live_during == live_before  # customers still see exactly what was live

    # 3-4. The preview shows that exact draft: a different version id than live, same store, edited content and tokens.
    draft_after = (await client.get("/api/v1/storefront/draft", headers=headers)).json()
    preview = (await client.get(f"/api/v1/public/preview/{draft_after['id']}")).json()
    assert preview["org_slug"] == slug and preview["theme"]["primary_color"] == "#123456"
    assert next(s for s in preview["pages"][0]["sections"] if s["type"] == "hero")["configuration"]["headline"] == "A new headline"

    # 5-6. Publishing (the authorized workflow) is what updates the public store, tokens included.
    assert (await client.post("/api/v1/storefront/publish", headers=headers)).status_code == 200
    live_after = (await client.get(public)).json()
    assert live_after["theme"]["primary_color"] == "#123456"
    assert next(s for s in live_after["pages"][0]["sections"] if s["type"] == "hero")["configuration"]["headline"] == "A new headline"


async def test_publishing_requires_authorization(client):
    _, slug = await _demo(client)
    assert (await client.post("/api/v1/storefront/publish")).status_code == 401
    assert (await client.patch("/api/v1/storefront/theme", json={"primary_color": "#000000"})).status_code == 401


async def test_a_failed_generation_leaves_the_live_storefront_untouched(client, monkeypatch):
    from tests.test_ai_reliability import _ExplodingProvider

    import app.services.storefront_generation_service as generation

    headers, slug = await _demo(client)
    public = f"/api/v1/public/stores/{slug}/storefront"
    live_before = (await client.get(public)).json()
    await client.post("/api/v1/store-creation/start", headers=headers)
    await client.put("/api/v1/store-creation/brand-input", json={"name": "Velora"}, headers=headers)
    monkeypatch.setattr(generation, "build_llm_provider", lambda *_a: _ExplodingProvider())
    res = await client.post("/api/v1/store-creation/generate-storefront", headers=headers)
    assert res.status_code == 503
    assert (await client.get(public)).json() == live_before  # existing live content stays available
    assert (await client.get(f"/api/v1/public/stores/{slug}/products")).status_code == 200


async def test_public_routes_never_cross_stores(client):
    from httpx import ASGITransport, AsyncClient

    from app.main import app

    headers_a, slug_a = await _demo(client)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as second_visitor:  # a different browser
        headers_b, slug_b = await _demo(second_visitor)
    assert slug_a != slug_b
    a = (await client.get(f"/api/v1/public/stores/{slug_a}/products")).json()
    b = (await client.get(f"/api/v1/public/stores/{slug_b}/products")).json()
    assert {p["id"] for p in a}.isdisjoint({p["id"] for p in b})
    # A product slug from store A resolves in store A, and the same slug in B returns B's own product, never A's.
    one = (await client.get(f"/api/v1/public/stores/{slug_a}/products/{a[0]['slug']}")).json()
    two = (await client.get(f"/api/v1/public/stores/{slug_b}/products/{a[0]['slug']}")).json()
    assert one["id"] == a[0]["id"] and two["id"] != one["id"]
    col_a = (await client.get(f"/api/v1/public/stores/{slug_a}/collections")).json()
    assert (await client.get(f"/api/v1/public/stores/{slug_b}/collections/{col_a[0]['id']}")).status_code == 404
    assert (await client.get("/api/v1/public/stores/velora")).status_code in (200, 404)  # no special-cased slug


async def test_the_demo_catalog_is_coherent_and_reconciles(client):
    headers, slug = await _demo(client)
    products = (await client.get(f"/api/v1/public/stores/{slug}/products")).json()
    assert len(products) == 26
    skus = [v["sku"] for p in products for v in p["variants"]]
    assert len(skus) == len(set(skus))  # unique SKUs
    for p in products:
        assert p["description"] and len(p["description"]) > 60 and p["seo_title"].endswith("| Velora")
        assert p["images"] and p["images"][0]["url"].endswith(".svg") and p["images"][0]["alt_text"]
        assert all(v["attributes"]["color"] and v["price"] > 0 for v in p["variants"])
        assert len({v["price"] for v in p["variants"]}) == 1  # colorways of one product share one price
    assert len({p["description"] for p in products}) == len(products)  # no copy-pasted descriptions
    # Every image file the catalog points at really exists.
    for p in products[:3]:
        assert (await client.get(p["images"][0]["url"].replace("http://test", ""))).status_code == 200
    # Admin catalog, inventory and the storefront agree.
    low = {i["title"]: i["on_hand"] for i in (await client.get("/api/v1/analytics/low-stock", headers=headers)).json()}
    assert low == {"Structured Tote": 2, "City Crossbody": 2, "Bifold Wallet": 2}
    by_title = {p["title"]: p for p in products}
    assert all(by_title[t]["variants"][0]["available"] == n and by_title[t]["variants"][0]["low_stock"] for t, n in low.items())
    sales = (await client.get("/api/v1/analytics/sales?days=365", headers=headers)).json()
    orders = (await client.get("/api/v1/orders", headers=headers)).json()
    assert sales["orders"] == len(orders) and abs(sales["revenue"] - sum(o["total"] for o in orders)) < 0.01  # analytics reconcile with orders
    for o in orders:
        assert abs(o["total"] - sum(i["quantity"] * i["unit_price"] for i in o["items"])) < 0.01
    cols = (await client.get(f"/api/v1/public/stores/{slug}/collections")).json()
    assert len(cols) == 5 and sum(len(c["product_ids"]) for c in cols) == 26  # every product in exactly one collection
    assert all(c["description"] for c in cols)


async def test_the_stock_ledger_reconciles_with_inventory_and_sales(client):
    from sqlalchemy import func, select

    from app.db.models import Inventory, InventoryMovement, Order, OrderItem, Organization, ProductVariant
    from app.db.session import AsyncSessionLocal

    _, slug = await _demo(client)
    async with AsyncSessionLocal() as db:
        org = (await db.execute(select(Organization).where(Organization.slug == slug))).scalar_one()
        rows = (await db.execute(
            select(Inventory).join(ProductVariant, ProductVariant.id == Inventory.variant_id).where(ProductVariant.org_id == org.id)
        )).scalars().all()
        assert len(rows) == 60  # every variant of every product has stock tracked
        for row in rows:
            ledger = (await db.execute(select(func.sum(InventoryMovement.delta)).where(InventoryMovement.inventory_id == row.id))).scalar_one()
            assert ledger == row.on_hand  # on-hand is exactly the sum of its movements
        sold = (await db.execute(
            select(func.coalesce(func.sum(OrderItem.quantity), 0)).join(Order, Order.id == OrderItem.order_id).where(Order.org_id == org.id)
        )).scalar_one()
        taken_out = (await db.execute(
            select(func.coalesce(-func.sum(InventoryMovement.delta), 0))
            .join(Inventory, Inventory.id == InventoryMovement.inventory_id)
            .join(ProductVariant, ProductVariant.id == Inventory.variant_id)
            .where(ProductVariant.org_id == org.id, InventoryMovement.reason == "Sales to date")
        )).scalar_one()
        assert sold > 0 and taken_out == sold  # units sold in the order history = units the ledger says left the shelf
