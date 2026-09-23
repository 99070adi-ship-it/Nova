import uuid

from pydantic import BaseModel, Field


class InventoryOut(BaseModel):
    id: uuid.UUID
    variant_id: uuid.UUID
    location_id: uuid.UUID
    on_hand: int
    reserved: int
    low_stock_threshold: int
    sku: str
    product_id: uuid.UUID
    product_title: str

    model_config = {"from_attributes": True}


class InventoryAdjust(BaseModel):
    delta: int
    reason: str = Field(min_length=1, max_length=200)
