import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.db.models import ProductDraftStatus, StoreCreationStatus


class BrandInput(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    sells_what: str | None = None
    target_customer: str | None = None
    positioning: str | None = None
    vibe_text: str | None = None
    tone: str | None = None
    inspiration_reference_text: str | None = None


class SessionOut(BaseModel):
    id: uuid.UUID
    status: StoreCreationStatus
    current_step: str | None
    started_at: datetime = Field(alias="created_at")
    completed_at: datetime | None

    model_config = {"from_attributes": True, "populate_by_name": True}


PRODUCT_DRAFT_FIELD_NAMES = ["title", "description", "price", "sku", "category", "tags", "seo_title", "seo_description"]

# Fields the Product Agent is allowed to fill in with "suggested" content — never price/sku,
# which are structural data, not content the model can plausibly propose (ARCHITECTURE.md
# "Product ingestion & AI product content workflow").
PRODUCT_AGENT_GENERATABLE_FIELDS = ["description", "category", "tags", "seo_title", "seo_description"]


class ProductDraftInput(BaseModel):
    title: str | None = None
    description: str | None = None
    price: float | None = None
    sku: str | None = None
    category: str | None = None
    tags: list[str] | None = None
    seo_title: str | None = None
    seo_description: str | None = None
    source_image_refs: list[str] | None = None


class ProductDraftUpdate(BaseModel):
    """Owner edits during the review step (Guide step 4: "owner accepts/edits/rejects
    suggestions") — filling in a `requires_confirmation` field (price/sku are never AI-generated,
    ARCHITECTURE.md "Product ingestion") or overriding a `suggested` one. Every field the owner
    sets here becomes `known`, same as if they'd typed it at creation. Unset fields are left
    alone — `exclude_unset` at the call site distinguishes "not editing this field" from "clearing
    it to null"."""

    title: str | None = None
    description: str | None = None
    price: float | None = None
    sku: str | None = None
    category: str | None = None
    tags: list[str] | None = None
    seo_title: str | None = None
    seo_description: str | None = None


class ProductDraftOut(BaseModel):
    id: uuid.UUID
    status: ProductDraftStatus
    fields: dict
    field_status: dict
    source_image_refs: list[str] | None
    accepted_product_id: uuid.UUID | None
    created_at: datetime

    model_config = {"from_attributes": True}
