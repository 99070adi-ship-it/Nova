import re
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    ProductDraft,
    ProductDraftStatus,
    StoreCreationSession,
    StoreCreationStatus,
)
from app.errors import ConflictError, NotFoundError, ValidationDomainError
from app.repositories import inventory_repo, product_repo, store_creation_repo
from app.schemas.store_creation import PRODUCT_DRAFT_FIELD_NAMES, ProductDraftInput
from app.services import storefront_generation_service

# "Use VELORA Sample Products" onboarding shortcut (ARCHITECTURE.md Checkpoint 11 / the onboarding
# correction's optional shortcut inside the "add products" step) — five fully specified example
# products so a new merchant can see the rest of Create My Store (generation, review, storefront)
# without hand-typing products first. Not VELORA's own live catalog rows — those belong to the
# seeded VELORA demo org (app/services/demo_service.py) — the same style of sample data, created
# fresh under whichever org calls this.
SAMPLE_PRODUCTS: list[dict] = [
    {
        "title": "Structured Tote", "price": 320.0, "sku": "DEMO-TOTE-01", "category": "Signature Totes",
        "description": "A structured full-grain leather tote built for daily carry.", "tags": ["totes", "leather"],
    },
    {
        "title": "City Crossbody", "price": 220.0, "sku": "DEMO-CROSS-01", "category": "Everyday Crossbody",
        "description": "A compact pebbled-leather crossbody sized for everyday essentials.", "tags": ["crossbody", "leather"],
    },
    {
        "title": "Bifold Wallet", "price": 95.0, "sku": "DEMO-WALLET-01", "category": "Wallets & Cardholders",
        "description": "A slim bifold wallet in pebbled leather.", "tags": ["wallets", "leather"],
    },
    {
        "title": "Leather Belt", "price": 90.0, "sku": "DEMO-BELT-01", "category": "Belts & Accessories",
        "description": "A vegetable-tanned leather belt with a solid brass buckle.", "tags": ["belts", "leather"],
    },
    {
        "title": "Satin Evening Clutch", "price": 190.0, "sku": "DEMO-CLUTCH-01", "category": "Evening Clutches",
        "description": "A satin evening clutch with a slim, considered silhouette.", "tags": ["clutches", "evening"],
    },
]


async def start_or_get_session(db: AsyncSession, org_id: uuid.UUID) -> StoreCreationSession:
    session = await store_creation_repo.get_current_session(db, org_id)
    if session is None:
        session = await store_creation_repo.create_session(db, org_id)
        await db.commit()
    return session


async def get_current_session_or_404(db: AsyncSession, org_id: uuid.UUID) -> StoreCreationSession:
    session = await store_creation_repo.get_current_session(db, org_id)
    if session is None:
        raise NotFoundError("No active store creation session — call start first")
    return session


async def submit_brand_input(db: AsyncSession, org_id: uuid.UUID, payload) -> StoreCreationSession:
    session = await get_current_session_or_404(db, org_id)
    await store_creation_repo.upsert_brand_profile(db, org_id, **payload.model_dump())
    if session.status == StoreCreationStatus.brand_input:
        session.status = StoreCreationStatus.product_input
        session.current_step = "product_input"
    await db.commit()
    return session


async def list_product_drafts(db: AsyncSession, org_id: uuid.UUID) -> list[ProductDraft]:
    session = await get_current_session_or_404(db, org_id)
    return await store_creation_repo.list_product_drafts(db, org_id, session.id)


def _slugify(title: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    return slug or f"product-{uuid.uuid4().hex[:8]}"


async def create_product_draft(db: AsyncSession, org_id: uuid.UUID, payload) -> ProductDraft:
    session = await get_current_session_or_404(db, org_id)
    if session.status not in (StoreCreationStatus.product_input, StoreCreationStatus.brand_input):
        raise ConflictError(f"Cannot add product drafts while session is {session.status}")

    fields: dict = {}
    field_status: dict = {}
    for name in PRODUCT_DRAFT_FIELD_NAMES:
        value = getattr(payload, name)
        fields[name] = value
        # Known ⇔ the owner actually typed it. Everything else starts requires_confirmation —
        # AI generation (P6) is the only thing allowed to move a field to "suggested", and it
        # must never touch a field that's already "known" (ARCHITECTURE.md "Product ingestion").
        field_status[name] = "known" if value is not None else "requires_confirmation"

    draft = await store_creation_repo.create_product_draft(
        db, org_id, session.id, fields=fields, field_status=field_status, source_image_refs=payload.source_image_refs
    )
    await db.commit()
    return draft


async def create_sample_product_drafts(db: AsyncSession, org_id: uuid.UUID) -> list[ProductDraft]:
    """"Use VELORA Sample Products" — see SAMPLE_PRODUCTS above. Each one is fully specified (all
    fields `known`), so they're immediately acceptable without a Product Agent generation pass,
    though the owner can still run "Generate content" on them like any other draft."""

    drafts = []
    for sample in SAMPLE_PRODUCTS:
        payload = ProductDraftInput(
            title=sample["title"], price=sample["price"], sku=sample["sku"], category=sample["category"],
            description=sample["description"], tags=sample["tags"], seo_title=None, seo_description=None,
            source_image_refs=None,
        )
        drafts.append(await create_product_draft(db, org_id, payload))
    return drafts


async def _get_draft_or_404(db: AsyncSession, org_id: uuid.UUID, draft_id: uuid.UUID) -> ProductDraft:
    draft = await store_creation_repo.get_product_draft(db, org_id, draft_id)
    if draft is None:
        raise NotFoundError("Product draft not found")
    return draft


async def update_product_draft(db: AsyncSession, org_id: uuid.UUID, draft_id: uuid.UUID, payload) -> ProductDraft:
    """Owner edit during review (Guide step 4) — the only way to move a `requires_confirmation`
    field (price/sku, never AI-generated) or a `suggested` one to `known` without rejecting and
    re-creating the whole draft. Blocked once the draft is finalized either way, same as accept/
    reject below."""

    draft = await _get_draft_or_404(db, org_id, draft_id)
    if draft.status in (ProductDraftStatus.accepted, ProductDraftStatus.rejected):
        raise ConflictError(f"Draft already {draft.status}")

    updates = payload.model_dump(exclude_unset=True)
    if updates:
        fields = dict(draft.fields)
        field_status = dict(draft.field_status)
        for name, value in updates.items():
            fields[name] = value
            field_status[name] = "known"
        draft.fields = fields
        draft.field_status = field_status
        await db.commit()
    return draft


async def accept_product_draft(db: AsyncSession, org_id: uuid.UUID, draft_id: uuid.UUID) -> ProductDraft:
    draft = await _get_draft_or_404(db, org_id, draft_id)
    if draft.status != ProductDraftStatus.owner_reviewing and draft.status != ProductDraftStatus.generated:
        raise ConflictError(f"Draft already {draft.status}")

    title = draft.fields.get("title")
    price = draft.fields.get("price")
    sku = draft.fields.get("sku")
    if not title or price is None or not sku:
        raise ValidationDomainError("Draft needs at least title, price, and sku before it can be accepted")
    if await product_repo.sku_taken(db, org_id, sku):
        raise ConflictError(f"SKU {sku} is already used by another product in this store")

    product = await product_repo.create_product(
        db, org_id,
        title=title, slug=_slugify(title), category=draft.fields.get("category"), tags=draft.fields.get("tags"),
        description=draft.fields.get("description"), seo_title=draft.fields.get("seo_title"),
        seo_description=draft.fields.get("seo_description"),
        variants=[{"sku": sku, "price": price, "cost": None, "attributes": None}],
    )
    location = await inventory_repo.get_or_create_default_location(db, org_id)
    for variant in product.variants:
        await inventory_repo.create_inventory_row(
            db, variant_id=variant.id, location_id=location.id, on_hand=0, low_stock_threshold=5
        )
    if draft.source_image_refs:
        # The first supplied photo becomes the canonical image — immutable with respect to AI
        # generation from here on; only an explicit owner upload can ever replace it
        # (ARCHITECTURE.md "AI image system").
        await product_repo.create_canonical_image(db, product.id, url=draft.source_image_refs[0])
    draft.status = ProductDraftStatus.accepted
    draft.accepted_product_id = product.id
    await db.commit()
    return draft


async def reject_product_draft(db: AsyncSession, org_id: uuid.UUID, draft_id: uuid.UUID) -> ProductDraft:
    draft = await _get_draft_or_404(db, org_id, draft_id)
    if draft.status in (ProductDraftStatus.accepted, ProductDraftStatus.rejected):
        raise ConflictError(f"Draft already {draft.status}")
    draft.status = ProductDraftStatus.rejected
    await db.commit()
    return draft


async def generate_storefront(db: AsyncSession, org_id: uuid.UUID) -> StoreCreationSession:
    """Step 4 of Create My Store — generates the storefront draft from brand + accepted products,
    then advances the session to ready_for_review (ARCHITECTURE.md "Create My Store")."""

    session = await get_current_session_or_404(db, org_id)
    await storefront_generation_service.generate(db, org_id)
    if session.status in (StoreCreationStatus.product_input, StoreCreationStatus.generating_products):
        session.status = StoreCreationStatus.ready_for_review
        session.current_step = "ready_for_review"
        await db.commit()
    return session
