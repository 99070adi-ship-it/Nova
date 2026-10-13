"""Full VELORA demo dataset (ARCHITECTURE.md "Demo data — VELORA") plus the dev-only demo reset
(Checkpoint 11): a premium handbags/accessories brand with ~26 products across 5 collections,
realistic customers/orders/inventory, and deliberately seeded problems — 2-3 low-stock
bestsellers, 2-3 dead-stock items, one collection (Evening Clutches) with declining sales, 2-3
high-traffic/low-conversion products, a churn-risk customer segment, and a handful of abandoned
carts — so Store Manager's Store Health findings have real evidence to cite instead of a
suspiciously empty store.

Also runs three ProductDrafts through the real Create My Store product-generation flow (one fully
specified, two deliberately incomplete — photo/title only) so the owner has live drafts to
review, demonstrating the known/suggested/requires_confirmation distinction end to end rather
than as a one-off unit test fixture.

`seed_velora_demo()` is not idempotent on its own — it assumes a database with no existing
"velora" org (same convention the old scripts/seed.py had). `reset_demo()` is the safe,
repeatable entrypoint: it wipes the whole database first (same TRUNCATE ... CASCADE
tests/conftest.py's cleanup fixture already relies on — cascades through every table transitively
FK'd to `organizations`, not just the one named) and reseeds from scratch, so it can be called
repeatedly against a live dev database between demo walkthroughs."""

import random
import uuid
from datetime import timedelta

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

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
    GeneratedBy,
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
    StorefrontVersionStatus,
    User,
    UserRole,
)
from app.db.session import AsyncSessionLocal
from app.repositories import analytics_repo, storefront_repo
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


# The published VELORA storefront every demo workspace starts with — a real `live` StorefrontVersion
# in the same tables, served by the same public API and rendered by the same storefront app as any
# merchant's store. It is written with the same section types the renderer supports (hero,
# brand_story, product_grid) and the same theme tokens Store Builder edits; there is no
# demo-only rendering path. It is flagged `is_seed_baseline` so it never counts as the owner's own
# publish for onboarding, and it stays live while the owner builds a separate draft.
VELORA_BASELINE_PAGES = [
    {
        "slug": "home", "title": "Home", "order": 0,
        "sections": [
            {"type": "hero", "order": 0, "configuration": {
                "headline": "Quiet leather, made to last.",
                "subheadline": "Handbags, wallets and leather accessories for people who buy once and carry for years.",
                "cta_text": "Shop the collection", "cta_href": "/products",
            }},
            {"type": "product_grid", "order": 1, "configuration": {"title": "The edit", "collection_id": None, "limit": 8}},
            {"type": "brand_story", "order": 2, "configuration": {
                "heading": "Made slowly, worn for years.",
                "body": (
                    "Velora designs considered leather goods in warm neutrals and soft structure. Every piece is cut "
                    "from full-grain and pebbled leather and finished by hand, built to age well rather than chase trends."
                ),
            }},
        ],
    }
]
VELORA_BASELINE_THEME = {
    "primary_color": "#2A1D15",
    "background_color": "#F3EEE6",
    "font_family": "'Cormorant Garamond', Georgia, serif",
    "border_radius": "2px",
}


def _slug(title: str) -> str:
    return title.lower().replace(" ", "-").replace("&", "and")


def _copy(title: str, collection_title: str) -> tuple[str, str, str]:
    material = MATERIALS[collection_title]
    description = f"{title} crafted from {material}, designed for effortless everyday elegance."
    return description, f"{title} | Velora", description[:160]


async def _seed_velora_catalog(*, org_slug: str, login_email: str, login_password: str = "changeme123") -> dict:
    """The rich business history alone — products, inventory, customers, orders, analytics,
    deliberately seeded problems, plus one published VELORA baseline storefront (a real live
    version flagged `is_seed_baseline`; no draft exists yet). No BrandProfile, no ProductDrafts, no AI runs —
    shared by `seed_velora_demo()` below (the dev-only reset, which adds the brand/drafts
    afterward for a developer reviewing the Create My Store review step) and
    `create_isolated_demo_workspace()` (the public demo-login, which deliberately leaves
    onboarding itself untouched so the real Guide tutorial walks through genuinely, while Store
    Health already has real sales/inventory/customer evidence once a visitor reaches "run the
    business"). `org_slug`/`login_email` are parameters rather than hardcoded literals so this can
    seed either the one fixed dev fixture or a fresh, uniquely-identified org per public demo
    visitor — see `create_isolated_demo_workspace()`'s docstring for why that distinction matters.
    Always marks the org `is_demo=True` — this function is never used for a real signup."""
    async with AsyncSessionLocal() as db:
        org = Organization(name="Velora", slug=org_slug, is_demo=True)
        db.add(org)
        await db.flush()

        owner = User(
            org_id=org.id, email=login_email, password_hash=hash_password(login_password),
            full_name="Owner", role=UserRole.owner,
        )
        db.add(owner)
        db.add(Store(org_id=org.id, name="Velora", currency="USD"))

        location = InventoryLocation(org_id=org.id, name="Main Warehouse")
        db.add(location)
        await db.flush()

        customers = []
        for name, email in CUSTOMERS:
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
                variant = ProductVariant(org_id=org.id, product_id=product.id, sku=sku, price=price, cost=round(price * 0.4, 2))
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

        await storefront_repo.create_version(
            db, org.id, status=StorefrontVersionStatus.live, generated_by=GeneratedBy.owner,
            pages=VELORA_BASELINE_PAGES, theme_tokens=VELORA_BASELINE_THEME, published_at=utcnow(),
            is_seed_baseline=True,
        )

        await db.commit()
        await analytics_repo.recompute_daily_metrics(db, org.id)
        await db.commit()

        org_id = org.id
        product_count = len(all_variants)
        collection_count = len(collections)
        customer_count = len(customers)

    return {
        "org_id": str(org_id),
        "org_slug": org_slug, "login_email": login_email, "login_password": login_password,
        "products": product_count, "collections": collection_count, "customers": customer_count,
    }


async def seed_velora_demo() -> dict:
    """The dev-only reset's full baseline (ARCHITECTURE.md Checkpoint 11) — the rich catalog
    above, plus a brand profile and three live ProductDrafts (one fully specified, two
    deliberately incomplete) so the known/suggested/requires_confirmation distinction is visible
    to a developer reviewing Create My Store, not just in a test fixture. Always seeds under the
    one fixed dev identity (`velora`/`owner@velora.demo`) — the public demo-login
    (`create_isolated_demo_workspace()` below) is a completely separate path that never touches
    this identity and deliberately skips this part — see its own docstring."""

    summary = await _seed_velora_catalog(org_slug="velora", login_email=DEMO_EMAIL, login_password=DEMO_PASSWORD)
    org_id = uuid.UUID(summary["org_id"])

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

    return {**summary, "product_drafts": len(draft_inputs)}


async def _wipe_database(db: AsyncSession) -> None:
    # Cascades through every table transitively FK'd to `organizations` (and everything FK'd to
    # `users`/`stores` not otherwise reachable, e.g. refresh_tokens) — same statement
    # tests/conftest.py's cleanup fixture uses, proven to clear the whole dataset, not just these
    # five tables by name. Only ever called from the dev-only path below — never from the public
    # demo entry, which must never affect any other visitor's workspace.
    await db.execute(text("TRUNCATE refresh_tokens, users, brand_profiles, stores, organizations CASCADE"))


async def reset_demo() -> dict:
    """Dev-only demo reset (ARCHITECTURE.md Checkpoint 11) — wipes the entire database (every org,
    not just VELORA's — there is no reliable partial-org delete without ON DELETE CASCADE on every
    FK, and a demo reset is meant to return to a pristine state anyway) and reseeds VELORA's rich
    mature-business baseline fresh under the one fixed dev identity. Gated at the route layer to
    `settings.env == "local"`; never wire this up without that gate, and never call it from the
    public demo path — see `create_isolated_demo_workspace()` below, which is what
    `/auth/demo-login` actually calls, and which never wipes anything."""

    async with AsyncSessionLocal() as db:
        await _wipe_database(db)
        await db.commit()
    return await seed_velora_demo()


# The dev-only fixture identity `/dev/demo-reset` always reseeds under — fixed and shared on
# purpose, since that route is for a developer's own local workflow, never exposed publicly.
DEMO_EMAIL = "owner@velora.demo"
DEMO_PASSWORD = "changeme123"


async def create_isolated_demo_workspace() -> dict:
    """Called from `auth_service.enter_demo()` for a visitor with no existing (or no longer valid)
    demo session — the public, unauthenticated `/auth/demo-login` entry point. Unlike the old
    shared-identity design this replaces, this NEVER wipes anything: it additively creates one
    brand-new org (`is_demo=True`), uniquely slugged and uniquely emailed so it can never collide
    with another visitor's workspace or with the dev fixture above, then seeds VELORA's rich
    business history (`_seed_velora_catalog()` — the same 26 products, 5 collections, real
    customers/orders, deliberately seeded problems) under it — deliberately WITHOUT a brand
    profile, without resolving any ProductDraft, without generating a storefront draft (the published
    baseline above is already live and stays live while the visitor builds their own draft), without running
    Store Health. Onboarding is therefore genuinely incomplete, step 1 ("brand"), exactly like a
    fresh signup: the real mandatory Guide pipeline (App.tsx's RequireOnboardingComplete) walks
    the visitor through it for real, with NOVA demonstrating each step using VELORA's real info
    and the visitor pressing the real button each time.

    The payoff for seeding the rich catalog ahead of the tutorial rather than leaving the org
    completely empty: by the time the visitor reaches "run the business" (the tutorial's own real
    "How is my store doing?" step) and presses that button themselves, Store Health has genuine
    history to analyze — the real low-stock/declining-collection/churn-risk conditions seeded
    above — not a suspiciously empty store.

    Known, accepted limitation: nothing here ever deletes an abandoned demo org. There is no
    `ON DELETE CASCADE` on any FK rooted at `organizations` (confirmed — no migration sets one),
    so a correct, scoped single-org delete would need either a schema migration adding it
    everywhere (large blast radius) or a hand-maintained, strictly-ordered multi-table delete (a
    real risk of silently leaving orphaned rows if a future table is added and this isn't kept in
    sync). Given this is a portfolio demo, not a production multi-tenant system, unbounded
    low-volume demo-org growth in Postgres is an acceptable tradeoff; a real cleanup sweep is a
    deliberate follow-up decision, not something to shortcut here."""

    short_id = uuid.uuid4().hex[:10]
    return await _seed_velora_catalog(org_slug=f"velora-demo-{short_id}", login_email=f"owner+{short_id}@velora.demo")
