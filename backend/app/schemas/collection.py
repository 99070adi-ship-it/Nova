import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class CollectionCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    slug: str = Field(min_length=1, max_length=300)
    description: str | None = None


class CollectionUpdate(BaseModel):
    title: str | None = None
    description: str | None = None


class CollectionOut(BaseModel):
    id: uuid.UUID
    title: str
    slug: str
    description: str | None
    created_at: datetime
    product_ids: list[uuid.UUID] = []

    model_config = {"from_attributes": True}


class AddProductToCollection(BaseModel):
    product_id: uuid.UUID
