import uuid

from pydantic import BaseModel

from app.db.models import AnalyticsEventType


class RecordEvent(BaseModel):
    event_type: AnalyticsEventType
    product_slug: str | None = None


class PublicVariant(BaseModel):
    id: uuid.UUID
    sku: str
    price: float

    model_config = {"from_attributes": True}


class PublicProduct(BaseModel):
    id: uuid.UUID
    title: str
    slug: str
    category: str | None
    description: str | None
    variants: list[PublicVariant]

    model_config = {"from_attributes": True}


class PublicCollection(BaseModel):
    id: uuid.UUID
    title: str
    slug: str
    description: str | None
    product_ids: list[uuid.UUID]

    model_config = {"from_attributes": True}


class PublicSection(BaseModel):
    type: str
    order: int
    configuration: dict

    model_config = {"from_attributes": True}


class PublicPage(BaseModel):
    slug: str
    title: str
    order: int
    sections: list[PublicSection]

    model_config = {"from_attributes": True}


class PublicStorefront(BaseModel):
    store_name: str
    theme: dict
    pages: list[PublicPage]
