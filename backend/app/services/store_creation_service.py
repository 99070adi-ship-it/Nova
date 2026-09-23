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
from app.schemas.store_creation import PRODUCT_DRAFT_FIELD_NAMES


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


async def _get_draft_or_404(db: AsyncSession, org_id: uuid.UUID, draft_id: uuid.UUID) -> ProductDraft:
    draft = await store_creation_repo.get_product_draft(db, org_id, draft_id)
    if draft is None:
        raise NotFoundError("Product draft not found")
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

    product = await product_repo.create_product(
        db, org_id,
        title=title, slug=_slugify(title), category=draft.fields.get("category"), tags=draft.fields.get("tags"),
        description=draft.fields.get("description"), seo_title=None, seo_description=None,
        variants=[{"sku": sku, "price": price, "cost": None, "attributes": None}],
    )
    location = await inventory_repo.get_or_create_default_location(db, org_id)
    for variant in product.variants:
        await inventory_repo.create_inventory_row(
            db, variant_id=variant.id, location_id=location.id, on_hand=0, low_stock_threshold=5
        )
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
