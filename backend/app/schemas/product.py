import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.db.models import ProductImageRole, ProductStatus


class VariantIn(BaseModel):
    sku: str = Field(min_length=1, max_length=100)
    price: float = Field(gt=0)
    cost: float | None = None
    attributes: dict | None = None


class VariantOut(BaseModel):
    id: uuid.UUID
    sku: str
    price: float
    cost: float | None
    attributes: dict | None

    model_config = {"from_attributes": True}


class ProductCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    slug: str = Field(min_length=1, max_length=300)
    category: str | None = None
    tags: list[str] | None = None
    description: str | None = None
    seo_title: str | None = None
    seo_description: str | None = None
    variants: list[VariantIn] = Field(min_length=1)


class ProductUpdate(BaseModel):
    title: str | None = None
    status: ProductStatus | None = None
    category: str | None = None
    tags: list[str] | None = None
    description: str | None = None
    seo_title: str | None = None
    seo_description: str | None = None


class GenerateLifestyleImage(BaseModel):
    environment: str | None = Field(default=None, max_length=100)
    mood: str | None = Field(default=None, max_length=100)


class ProductImageOut(BaseModel):
    id: uuid.UUID
    url: str
    role: ProductImageRole
    is_ai_generated: bool
    provider: str | None
    model: str | None
    environment: str | None
    mood: str | None
    source_image_id: uuid.UUID | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ProductOut(BaseModel):
    id: uuid.UUID
    title: str
    slug: str
    status: ProductStatus
    category: str | None
    tags: list[str] | None
    description: str | None
    seo_title: str | None
    seo_description: str | None
    created_at: datetime
    variants: list[VariantOut] = []

    model_config = {"from_attributes": True}
