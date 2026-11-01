"""The customer-facing commerce API: product data with real stock and images, cart validation, the demo
checkout, and guest order lookup. Everything a shopper's browser sends is treated as an untrusted claim."""

import asyncio
import uuid

import pytest
from sqlalchemy import func, select

from app.config import get_settings
from app.db.models import AnalyticsEvent, Inventory, InventoryMovement, Order, Organization, ProductImage, ProductImageRole
from app.db.models import ProductStatus
from app.db.session import AsyncSessionLocal
from app.schemas.product import ProductCreate, VariantIn
from app.services import checkout_service, product_service


async def _make_product(org_id, title, price=100, sku=None, stock=5, status=ProductStatus.published, attributes=None, threshold=5):
    async with AsyncSessionLocal() as db:
        product = await product_service.create_product(
            db, org_id, ProductCreate(title=title, slug=title.lower().replace(" ", "-"), variants=[VariantIn(sku=sku or f"{title[:3].upper()}-{uuid.uuid4().hex[:5]}", price=price, attributes=attributes)]),
        )
        variant_id = product.variants[0].id
        inv = (await db.execute(select(Inventory).where(Inventory.variant_id == variant_id))).scalars().first()
        if inv is not None:
            inv.on_hand = stock
            inv.low_stock_threshold = threshold
        product_row = await db.get(type(product), product.id)
        product_row.status = status
        await db.commit()
        return product.slug, variant_id, product.id


@pytest.fixture
async def store(seeded_owner):
    return seeded_owner["org_slug"], seeded_owner["org_id"]


def _checkout(items, key=None, email="shopper@example.com", name="Sam Shopper", ack=True):
    return {
        "idempotency_key": key or uuid.uuid4().hex, "customer_email": email, "customer_name": name,
        "items": [{"variant_id": str(v), "quantity": q} for v, q in items], "demo_checkout_acknowledged": ack,
    }


# ---- catalog data ----

async def test_public_products_expose_real_stock_images_and_attributes(client, store):
    slug, org_id = store
    _, variant_id, product_id = await _make_product(org_id, "Cognac Tote", price=120, stock=3, attributes={"color": "Cognac"})
    async with AsyncSessionLocal() as db:
        db.add(ProductImage(product_id=product_id, url="/static/velora/structured-tote.svg", role=ProductImageRole.canonical, alt_text="Cognac Tote"))
        await db.commit()
    res = await client.get(f"/api/v1/public/stores/{slug}/products/cognac-tote")
    body = res.json()
    v = body["variants"][0]
    assert (v["available"], v["in_stock"], v["low_stock"], v["attributes"]) == (3, True, True, {"color": "Cognac"})  # 3 left is at/below the threshold of 5
    assert body["images"][0]["url"].startswith("http") and body["images"][0]["url"].endswith("/static/velora/structured-tote.svg")
    assert body["images"][0]["alt_text"] == "Cognac Tote"


async def test_sold_out_and_unpublished_products(client, store):
    slug, org_id = store
    await _make_product(org_id, "Gone Tote", stock=0)
    await _make_product(org_id, "Draft Tote", status=ProductStatus.draft)
    listing = (await client.get(f"/api/v1/public/stores/{slug}/products")).json()
    titles = {p["title"]: p for p in listing}
    assert titles["Gone Tote"]["variants"][0]["in_stock"] is False and titles["Gone Tote"]["variants"][0]["available"] == 0
    assert "Draft Tote" not in titles  # drafts are never public
    assert (await client.get(f"/api/v1/public/stores/{slug}/products/draft-tote")).status_code == 404


async def test_store_info_and_unknown_store(client, store):
    slug, _ = store
    info = (await client.get(f"/api/v1/public/stores/{slug}")).json()
    assert info["slug"] == slug and info["demo_checkout"] is True and info["currency"] == "USD"
    assert (await client.get("/api/v1/public/stores/no-such-store")).status_code == 404


# ---- cart ----

async def test_cart_prices_come_from_the_catalog_never_from_the_client(client, store):
    slug, org_id = store
    _, v, _ = await _make_product(org_id, "Priced Bag", price=250, stock=9)
    res = await client.post(f"/api/v1/public/stores/{slug}/cart/validate", json={"items": [{"variant_id": str(v), "quantity": 2, "unit_price": 1, "price": 0.01}]})
    body = res.json()
    assert body["lines"][0]["unit_price"] == 250.0 and body["subtotal"] == 500.0 and body["can_checkout"] is True
    assert "Shipping and tax are not calculated" in body["shipping_note"]


async def test_cart_reports_what_cannot_be_bought(client, store):
    slug, org_id = store
    _, low, _ = await _make_product(org_id, "Low Bag", stock=2)
    _, out, _ = await _make_product(org_id, "Out Bag", stock=0)
    cap = get_settings().checkout_max_quantity_per_line
    _, many, _ = await _make_product(org_id, "Many Bag", stock=cap + 5)
    items = [{"variant_id": str(low), "quantity": 3}, {"variant_id": str(out), "quantity": 1}, {"variant_id": str(many), "quantity": cap + 1}, {"variant_id": str(uuid.uuid4()), "quantity": 1}]
    body = (await client.post(f"/api/v1/public/stores/{slug}/cart/validate", json={"items": items})).json()
    issues = {line["title"] or "unknown": line["issues"] for line in body["lines"]}
    assert issues["Low Bag"] == ["insufficient_stock"] and issues["Out Bag"] == ["out_of_stock"]
    assert issues["Many Bag"] == ["quantity_capped"] and issues["unknown"] == ["unavailable"]
    assert body["can_checkout"] is False and body["subtotal"] == 0.0  # blocked lines never count towards the total


async def test_duplicate_cart_lines_merge_so_they_cannot_dodge_limits(client, store):
    slug, org_id = store
    _, v, _ = await _make_product(org_id, "Split Bag", stock=3)
    body = (await client.post(f"/api/v1/public/stores/{slug}/cart/validate", json={"items": [{"variant_id": str(v), "quantity": 2}, {"variant_id": str(v), "quantity": 2}]})).json()
    assert len(body["lines"]) == 1 and body["lines"][0]["quantity"] == 4 and body["lines"][0]["issues"] == ["insufficient_stock"]


async def test_invalid_cart_quantities_are_rejected(client, store):
    slug, org_id = store
    _, v, _ = await _make_product(org_id, "Qty Bag")
    for qty in (0, -1, 1.5, "two"):
        res = await client.post(f"/api/v1/public/stores/{slug}/cart/validate", json={"items": [{"variant_id": str(v), "quantity": qty}]})
        assert res.status_code == 422


async def test_another_stores_variant_does_not_resolve(client, store):
    slug, org_id = store
    async with AsyncSessionLocal() as db:
        other = Organization(name="Other", slug=f"other-{uuid.uuid4().hex[:6]}")
        db.add(other)
        await db.commit()
        other_id = other.id
    _, their_variant, _ = await _make_product(other_id, "Their Bag", stock=5)
    cart = (await client.post(f"/api/v1/public/stores/{slug}/cart/validate", json={"items": [{"variant_id": str(their_variant), "quantity": 1}]})).json()
    assert cart["lines"][0]["issues"] == ["unavailable"] and cart["lines"][0]["title"] is None  # nothing about it leaks
    res = await client.post(f"/api/v1/public/stores/{slug}/checkout", json=_checkout([(their_variant, 1)]))
    assert res.status_code == 409


# ---- checkout ----

async def test_checkout_creates_a_demo_order_with_server_prices_and_never_claims_payment(client, store):
    slug, org_id = store
    _, v, product_id = await _make_product(org_id, "Order Bag", price=180, stock=6, attributes={"color": "Sand"})
    res = await client.post(f"/api/v1/public/stores/{slug}/checkout", json={**_checkout([(v, 2)]), "items": [{"variant_id": str(v), "quantity": 2, "unit_price": 0.01}]})
    assert res.status_code == 201, res.text
    order = res.json()
    assert order["total"] == 360.0 and order["items"][0]["unit_price"] == 180.0 and order["items"][0]["quantity"] == 2
    assert order["status"] == "pending" and order["payment_status"] == "pending"  # NEVER "paid": no provider confirmed anything
    assert order["demo"] is True and "No payment was taken" in order["note"] and order["replayed"] is False
    async with AsyncSessionLocal() as db:
        inv = (await db.execute(select(Inventory).where(Inventory.variant_id == v))).scalars().first()
        assert inv.on_hand == 4  # stock was decremented
        moves = (await db.execute(select(InventoryMovement).where(InventoryMovement.inventory_id == inv.id))).scalars().all()
        assert [m.delta for m in moves] == [-2] and "Storefront order" in moves[0].reason  # an auditable ledger entry
        events = (await db.execute(select(func.count()).select_from(AnalyticsEvent).where(AnalyticsEvent.org_id == org_id, AnalyticsEvent.product_id == product_id))).scalar_one()
        assert events >= 1


async def test_the_same_idempotency_key_returns_the_same_order(client, store):
    slug, org_id = store
    _, v, _ = await _make_product(org_id, "Once Bag", stock=5)
    payload = _checkout([(v, 1)], key="same-key-12345")
    first = await client.post(f"/api/v1/public/stores/{slug}/checkout", json=payload)
    again = await client.post(f"/api/v1/public/stores/{slug}/checkout", json=payload)
    assert first.status_code == 201 and again.status_code == 201
    assert again.json()["id"] == first.json()["id"] and again.json()["replayed"] is True
    async with AsyncSessionLocal() as db:
        assert (await db.execute(select(func.count()).select_from(Order).where(Order.org_id == org_id))).scalar_one() == 1
        inv = (await db.execute(select(Inventory).where(Inventory.variant_id == v))).scalars().first()
        assert inv.on_hand == 4  # decremented once, not twice


async def test_concurrent_double_submit_creates_exactly_one_order(client, store):
    slug, org_id = store
    _, v, _ = await _make_product(org_id, "Race Bag", stock=5)
    payload = _checkout([(v, 1)], key="race-key-123456")
    results = await asyncio.gather(*[client.post(f"/api/v1/public/stores/{slug}/checkout", json=payload) for _ in range(4)])
    assert {r.status_code for r in results} == {201}
    assert len({r.json()["id"] for r in results}) == 1
    async with AsyncSessionLocal() as db:
        assert (await db.execute(select(func.count()).select_from(Order).where(Order.org_id == org_id))).scalar_one() == 1
        assert (await db.execute(select(Inventory.on_hand).where(Inventory.variant_id == v))).scalar_one() == 4


async def test_the_last_unit_cannot_be_oversold(client, store):
    slug, org_id = store
    _, v, _ = await _make_product(org_id, "Last Bag", stock=1)
    results = await asyncio.gather(*[client.post(f"/api/v1/public/stores/{slug}/checkout", json=_checkout([(v, 1)], email=f"s{i}@example.com")) for i in range(5)])
    codes = sorted(r.status_code for r in results)
    assert codes == [201, 409, 409, 409, 409]
    async with AsyncSessionLocal() as db:
        assert (await db.execute(select(Inventory.on_hand).where(Inventory.variant_id == v))).scalar_one() == 0  # never negative
        assert (await db.execute(select(func.count()).select_from(Order).where(Order.org_id == org_id))).scalar_one() == 1


async def test_checkout_is_all_or_nothing_when_one_line_is_short(client, store):
    slug, org_id = store
    _, ok, _ = await _make_product(org_id, "Fine Bag", stock=5)
    _, short, _ = await _make_product(org_id, "Short Bag", stock=1)
    res = await client.post(f"/api/v1/public/stores/{slug}/checkout", json=_checkout([(ok, 2), (short, 3)]))
    assert res.status_code == 409
    lines = res.json()["error"]["details"]["lines"]
    assert lines[0]["issue"] == "insufficient_stock" and lines[0]["available"] == 1
    async with AsyncSessionLocal() as db:
        assert (await db.execute(select(Inventory.on_hand).where(Inventory.variant_id == ok))).scalar_one() == 5  # untouched
        assert (await db.execute(select(func.count()).select_from(Order).where(Order.org_id == org_id))).scalar_one() == 0


@pytest.mark.parametrize("mutate,code", [
    (lambda p: {**p, "demo_checkout_acknowledged": False}, 422),
    (lambda p: {**p, "customer_email": "not-an-email"}, 422),
    (lambda p: {**p, "customer_name": ""}, 422),
    (lambda p: {**p, "idempotency_key": "short"}, 422),
    (lambda p: {**p, "idempotency_key": "bad key with spaces!"}, 422),
    (lambda p: {**p, "items": []}, 422),
    (lambda p: {**p, "items": [{**p["items"][0], "quantity": 0}]}, 422),
    (lambda p: {**p, "items": [{**p["items"][0], "quantity": 11}]}, 409),  # over the per-line limit
])
async def test_checkout_validates_input(client, store, mutate, code):
    slug, org_id = store
    _, v, _ = await _make_product(org_id, "Valid Bag", stock=50)
    res = await client.post(f"/api/v1/public/stores/{slug}/checkout", json=mutate(_checkout([(v, 1)])))
    assert res.status_code == code, res.text
    async with AsyncSessionLocal() as db:
        assert (await db.execute(select(func.count()).select_from(Order).where(Order.org_id == org_id))).scalar_one() == 0


async def test_unpublished_products_cannot_be_bought(client, store):
    slug, org_id = store
    _, v, _ = await _make_product(org_id, "Hidden Bag", status=ProductStatus.draft, stock=5)
    assert (await client.post(f"/api/v1/public/stores/{slug}/checkout", json=_checkout([(v, 1)]))).status_code == 409


async def test_returning_customers_are_matched_by_email(client, store):
    slug, org_id = store
    _, v, _ = await _make_product(org_id, "Again Bag", stock=9)
    for _ in range(2):
        assert (await client.post(f"/api/v1/public/stores/{slug}/checkout", json=_checkout([(v, 1)], email="Repeat@Example.com"))).status_code == 201
    from app.db.models import Customer
    async with AsyncSessionLocal() as db:
        assert (await db.execute(select(func.count()).select_from(Customer).where(Customer.org_id == org_id))).scalar_one() == 1


# ---- guest order lookup ----

async def test_order_lookup_needs_both_the_id_and_the_email_and_only_inside_the_store(client, store):
    slug, org_id = store
    _, v, _ = await _make_product(org_id, "Look Bag", stock=5)
    placed = (await client.post(f"/api/v1/public/stores/{slug}/checkout", json=_checkout([(v, 1)], email="me@example.com"))).json()
    ok = await client.post(f"/api/v1/public/stores/{slug}/orders/lookup", json={"order_id": placed["id"], "email": "ME@example.com"})
    assert ok.status_code == 200 and ok.json()["id"] == placed["id"] and ok.json()["items"][0]["title"] == "Look Bag"

    wrong_email = await client.post(f"/api/v1/public/stores/{slug}/orders/lookup", json={"order_id": placed["id"], "email": "other@example.com"})
    unknown_id = await client.post(f"/api/v1/public/stores/{slug}/orders/lookup", json={"order_id": str(uuid.uuid4()), "email": "me@example.com"})
    assert wrong_email.status_code == unknown_id.status_code == 404
    assert wrong_email.json()["error"]["message"] == unknown_id.json()["error"]["message"]  # no way to tell which part was wrong

    async with AsyncSessionLocal() as db:
        other = Organization(name="Elsewhere", slug=f"elsewhere-{uuid.uuid4().hex[:6]}")
        db.add(other)
        await db.commit()
        other_slug = other.slug
    cross = await client.post(f"/api/v1/public/stores/{other_slug}/orders/lookup", json={"order_id": placed["id"], "email": "me@example.com"})
    assert cross.status_code == 404  # another store can never read this order


async def test_order_lookup_is_rate_limited(client, store, monkeypatch):
    slug, _ = store
    monkeypatch.setattr(get_settings(), "order_lookups_per_minute", 3)
    checkout_service._lookups.clear()
    body = {"order_id": str(uuid.uuid4()), "email": "a@example.com"}
    codes = [(await client.post(f"/api/v1/public/stores/{slug}/orders/lookup", json=body)).status_code for _ in range(5)]
    assert codes[:3] == [404, 404, 404] and codes[3] == 422  # then it stops answering at all
    checkout_service._lookups.clear()


# ---- published storefront ----

async def test_public_storefront_includes_the_store_it_belongs_to(client, seeded_owner):
    from app.services import demo_service  # noqa: F401  (ensures the demo baseline helpers import cleanly)
    headers = {"Authorization": f"Bearer {(await client.post('/api/v1/auth/login', json={'email': seeded_owner['email'], 'password': seeded_owner['password']})).json()['access_token']}"}
    draft = (await client.get("/api/v1/storefront/draft", headers=headers)).json()
    preview = (await client.get(f"/api/v1/public/preview/{draft['id']}")).json()
    assert preview["org_slug"] == seeded_owner["org_slug"]  # a preview link carries no store slug; this is how it finds its catalog
