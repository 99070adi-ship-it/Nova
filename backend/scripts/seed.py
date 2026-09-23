"""Full VELORA demo dataset (ARCHITECTURE.md "Demo data — VELORA"): a premium handbags/
accessories brand with ~26 products across 5 collections, realistic customers/orders/inventory,
and deliberately seeded problems — 2-3 low-stock bestsellers, 2-3 dead-stock items, one
collection (Evening Clutches) with declining sales, 2-3 high-traffic/low-conversion products, a
churn-risk customer segment, and a handful of abandoned carts — so Store Manager's Store Health
findings have real evidence to cite instead of a suspiciously empty store.

Also runs three ProductDrafts through the real Create My Store product-generation flow (one fully
specified, two deliberately incomplete — photo/title only) so the owner has live drafts to
review, demonstrating the known/suggested/requires_confirmation distinction end to end rather
than as a one-off unit test fixture. The main 26-product catalog is seeded directly (it
represents an already-established catalog, not something a merchant would re-enter one at a time
through the wizard) — Create My Store stays available afterward for the reviewer to walk the
brand-input -> storefront-generation -> publish path live against a store that already has data
to render.

One seed() entrypoint, not idempotent — run once against a fresh database (same convention as
scripts/seed_bootstrap.py, which this supersedes; do not run both against the same database).
"""

import asyncio
import random
import uuid
from datetime import timedelta

from app.core.security import hash_password
from app.db.base import utcnow
from app.db.models import (
    AnalyticsEvent,
    AnalyticsEventType,
    CartEvent,
    CartEventType,
    Collection,
    CollectionProduct,
    Customer,
    Inventory,
    InventoryLocation,
    Order,
    OrderItem,
    OrderStatus,
    Organization,
    PaymentStatus,
    Product,
    ProductStatus,
    ProductVariant,
    Store,
    User,
    UserRole,
)
from app.db.session import AsyncSessionLocal
from app.repositories import analytics_repo
from app.schemas.store_creation import BrandInput, ProductDraftInput
from app.services import product_agent_service, store_creation_service

random.seed(42)

# (title, price, problem) — problem is one of: low_stock, dead_stock, low_conversion, declining, None
CATALOG: dict[str, list[tuple[str, float, str | None]]] = {
    "Signature Totes": [
        ("Structured Tote", 320, "low_stock"),
        ("Weekender Tote", 280, None),
        ("Canvas Everyday Tote", 140, None),
        ("Mini Structured Tote", 260, None),
        ("Oversized Shopper Tote", 240, "low_conversion"),
        ("Woven Straw Tote", 180, "dead_stock"),
    ],
    "Everyday Crossbody": [
        ("City Crossbody", 220, "low_stock"),
        ("Mini Crossbody", 180, None),
        ("Saddle Crossbody", 260, None),
        ("Quilted Crossbody", 300, None),
        ("Convertible Crossbody", 240, "low_conversion"),
        ("Belt Bag Crossbody", 160, None),
    ],
    "Evening Clutches": [
        ("Satin Evening Clutch", 190, "declining"),
        ("Beaded Clutch", 220, "declining"),
        ("Envelope Clutch", 150, "declining"),
        ("Velvet Clutch", 170, "declining"),
        ("Crystal-Embellished Clutch", 260, "low_conversion"),
    ],
    "Wallets & Cardholders": [
        ("Bifold Wallet", 95, "low_stock"),
        ("Zip-Around Wallet", 110, None),
        ("Cardholder", 60, None),
        ("Coin Pouch", 40, "dead_stock"),
        ("Passport Holder", 85, None),
    ],
    "Belts & Accessories": [
        ("Leather Belt", 90, None),
        ("Reversible Belt", 100, None),
        ("Silk Scarf", 75, None),
        ("Keychain Charm", 35, "dead_stock"),
    ],
}

MATERIALS = {
    "Signature Totes": "full-grain leather",
    "Everyday Crossbody": "pebbled leather",
    "Evening Clutches": "silk satin",
    "Wallets & Cardholders": "pebbled leather",
    "Belts & Accessories": "vegetable-tanned leather",
}

CUSTOMERS = [
    ("Ava Bennett", "ava.bennett@example.com"),
    ("Noah Fischer", "noah.fischer@example.com"),
    ("Mia Torres", "mia.torres@example.com"),
    ("Liam Chen", "liam.chen@example.com"),
    ("Sofia Reyes", "sofia.reyes@example.com"),
    ("Ethan Brooks", "ethan.brooks@example.com"),
    ("Isabella Novak", "isabella.novak@example.com"),
    ("Lucas Moretti", "lucas.moretti@example.com"),
    ("Chloe Dupont", "chloe.dupont@example.com"),
    ("Oliver Kane", "oliver.kane@example.com"),
    ("Amara Osei", "amara.osei@example.com"),
    ("Felix Lindqvist", "felix.lindqvist@example.com"),
]
# Customers 0-6 stay active (recent orders); 7-11 are the churn-risk segment (no recent activity).
CHURN_RISK_START_INDEX = 7


def _slug(title: str) -> str:
    return title.lower().replace(" ", "-").replace("&", "and")


def _copy(title: str, collection_title: str) -> tuple[str, str, str]:
    material = MATERIALS[collection_title]
    description = f"{title} crafted from {material}, designed for effortless everyday elegance."
    return description, f"{title} | Velora", description[:160]


async def seed() -> None:
    async with AsyncSessionLocal() as db:
        org = Organization(name="Velora", slug="velora")
        db.add(org)
        await db.flush()

        owner = User(
            org_id=org.id, email="owner@velora.demo", password_hash=hash_password("changeme123"),
            full_name="Owner", role=UserRole.owner,
        )
        db.add(owner)
        db.add(Store(org_id=org.id, name="Velora", currency="USD"))

        location = InventoryLocation(org_id=org.id, name="Main Warehouse")
        db.add(location)
        await db.flush()

        customers = []
        for i, (name, email) in enumerate(CUSTOMERS):
            customer = Customer(org_id=org.id, name=name, email=email)
            db.add(customer)
            customers.append(customer)
        await db.flush()

        collections: dict[str, Collection] = {}
        for title in CATALOG:
            collection = Collection(org_id=org.id, title=title, slug=_slug(title), description=f"The {title} edit.")
            db.add(collection)
            collections[title] = collection
        await db.flush()

        products_by_problem: dict[str, list[tuple[Product, ProductVariant]]] = {"low_stock": [], "dead_stock": [], "low_conversion": [], "declining": []}
        all_variants: list[tuple[Product, ProductVariant, str, str | None]] = []  # (product, variant, collection_title, problem)

        for collection_title, items in CATALOG.items():
            for title, price, problem in items:
                description, seo_title, seo_description = _copy(title, collection_title)
                product = Product(
                    org_id=org.id, title=title, slug=_slug(title), status=ProductStatus.published,
                    category=collection_title, tags=[collection_title.split()[0].lower()],
                    description=description, seo_title=seo_title, seo_description=seo_description,
                )
                db.add(product)
                await db.flush()

                sku = f"{''.join(w[0] for w in title.split())}-{uuid.uuid4().hex[:4].upper()}"
                variant = ProductVariant(product_id=product.id, sku=sku, price=price, cost=round(price * 0.4, 2))
                db.add(variant)
                await db.flush()

                on_hand = {"low_stock": 2, "dead_stock": 90}.get(problem, 25)
                db.add(Inventory(variant_id=variant.id, location_id=location.id, on_hand=on_hand, low_stock_threshold=5))
                db.add(CollectionProduct(collection_id=collections[collection_title].id, product_id=product.id))

                if problem in products_by_problem:
                    products_by_problem[problem].append((product, variant))
                all_variants.append((product, variant, collection_title, problem))
        await db.flush()

        # ---- Orders: bestsellers (recent, frequent), normal products (light, spread out),
        # declining collection (front-loaded into the older half of the window), dead stock /
        # low-conversion products get zero or near-zero orders.
        for product, variant, collection_title, problem in all_variants:
            if problem == "low_stock":
                order_days = [random.randint(0, 20) for _ in range(10)]
            elif problem == "declining":
                order_days = [random.randint(35, 59) for _ in range(7)] + [random.randint(0, 15) for _ in range(1)]
            elif problem == "low_conversion":
                order_days = [random.randint(0, 59)] if random.random() < 0.5 else []
            elif problem == "dead_stock":
                order_days = []
            else:
                order_days = [random.randint(0, 59) for _ in range(random.randint(2, 5))]

            for days_ago in order_days:
                customer = customers[random.randint(0, CHURN_RISK_START_INDEX - 1)]  # active customers drive sales
                created_at = utcnow() - timedelta(days=days_ago, hours=random.randint(0, 20))
                quantity = random.choice([1, 1, 1, 2])
                unit_price = float(variant.price)
                order = Order(
                    org_id=org.id, customer_id=customer.id, status=OrderStatus.fulfilled,
                    payment_status=PaymentStatus.paid, total=round(unit_price * quantity, 2), created_at=created_at,
                )
                db.add(order)
                await db.flush()
                db.add(OrderItem(order_id=order.id, variant_id=variant.id, quantity=quantity, unit_price=unit_price))
                db.add(AnalyticsEvent(
                    org_id=org.id, event_type=AnalyticsEventType.purchase, product_id=product.id,
                    customer_id=customer.id, created_at=created_at,
                ))

            # Browsing evidence — low_conversion products get lots of views but the order list
            # above stays mostly empty, which is the whole point of the finding.
            view_count = 45 if problem == "low_conversion" else random.randint(5, 15)
            for _ in range(view_count):
                days_ago = random.randint(0, 59)
                db.add(AnalyticsEvent(
                    org_id=org.id, event_type=AnalyticsEventType.product_view, product_id=product.id,
                    created_at=utcnow() - timedelta(days=days_ago, hours=random.randint(0, 20)),
                ))
        await db.flush()

        # ---- Churn-risk customers: no order in 45-90 days. Active customers already got orders
        # above (days_ago capped well under 30 for most product order windows).
        for customer in customers[CHURN_RISK_START_INDEX:]:
            product, variant, _, _ = all_variants[random.randint(0, len(all_variants) - 1)]
            days_ago = random.randint(45, 90)
            created_at = utcnow() - timedelta(days=days_ago)
            unit_price = float(variant.price)
            order = Order(
                org_id=org.id, customer_id=customer.id, status=OrderStatus.fulfilled,
                payment_status=PaymentStatus.paid, total=unit_price, created_at=created_at,
            )
            db.add(order)
            await db.flush()
            db.add(OrderItem(order_id=order.id, variant_id=variant.id, quantity=1, unit_price=unit_price))
            db.add(AnalyticsEvent(
                org_id=org.id, event_type=AnalyticsEventType.purchase, product_id=product.id,
                customer_id=customer.id, created_at=created_at,
            ))

        # ---- Abandoned carts.
        for _ in range(6):
            customer = random.choice(customers)
            _, variant, _, _ = all_variants[random.randint(0, len(all_variants) - 1)]
            db.add(CartEvent(
                org_id=org.id, customer_id=customer.id, variant_id=variant.id, event=CartEventType.abandoned,
                created_at=utcnow() - timedelta(days=random.randint(0, 20)),
            ))

        # ---- Homepage-level traffic (not tied to a product) — gives the Storefront Agent real
        # hero-CTR evidence instead of nothing to cite.
        for _ in range(60):
            db.add(AnalyticsEvent(
                org_id=org.id, event_type=AnalyticsEventType.page_view,
                created_at=utcnow() - timedelta(days=random.randint(0, 30), hours=random.randint(0, 20)),
            ))
        for _ in range(12):
            db.add(AnalyticsEvent(
                org_id=org.id, event_type=AnalyticsEventType.hero_click,
                created_at=utcnow() - timedelta(days=random.randint(0, 30), hours=random.randint(0, 20)),
            ))

        await db.commit()
        await analytics_repo.recompute_daily_metrics(db, org.id)
        await db.commit()

        print(f"Seeded org '{org.slug}' — {len(all_variants)} products across {len(collections)} collections, {len(customers)} customers.")
        print("Login as owner@velora.demo / changeme123")

        # ---- Create My Store: brand profile + three live ProductDrafts (one fully specified,
        # two deliberately incomplete) so the known/suggested/requires_confirmation distinction
        # is visible in the running app, not just in a test fixture.
        org_id = org.id

    async with AsyncSessionLocal() as db:
        await store_creation_service.start_or_get_session(db, org_id)
        await store_creation_service.submit_brand_input(db, org_id, BrandInput(
            name="Velora",
            description="A premium handbags and accessories house for people who buy once and carry for years.",
            sells_what="Handbags, wallets, and leather accessories",
            target_customer="Professionals in their late 20s to 40s who value quiet, lasting quality over logos",
            positioning="Quiet luxury — considered materials and construction over trend-chasing",
            vibe_text="Warm neutrals, soft structure, understated confidence",
            tone="Warm, confident, understated",
            inspiration_reference_text="The Row, Polene, Cuyana",
        ))

    draft_inputs = [
        ProductDraftInput(
            title="Heritage Card Case", description="A slim heritage-inspired card case in pebbled leather.",
            price=65, sku="HCC-1", category="Wallets & Cardholders", tags=["wallets", "leather"],
        ),
        ProductDraftInput(title="Suede Hobo Bag", source_image_refs=["seed/suede-hobo-1.jpg"]),
        ProductDraftInput(title="Woven Rattan Clutch", category="Evening Clutches", source_image_refs=["seed/rattan-clutch-1.jpg"]),
    ]
    for draft_input in draft_inputs:
        async with AsyncSessionLocal() as db:
            draft = await store_creation_service.create_product_draft(db, org_id, draft_input)
        async with AsyncSessionLocal() as db:
            await product_agent_service.generate_draft_content(db, org_id, draft.id)

    print("Seeded 3 product drafts (1 fully specified, 2 partial) awaiting owner review in Create My Store.")


if __name__ == "__main__":
    asyncio.run(seed())
