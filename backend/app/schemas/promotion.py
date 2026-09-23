import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class PromotionCreate(BaseModel):
    code: str = Field(min_length=1, max_length=50)
    type: str = Field(pattern="^(percentage|fixed_amount)$")
    value: float = Field(gt=0)
    scope: dict | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None


class PromotionUpdate(BaseModel):
    active: bool | None = None
    ends_at: datetime | None = None


class PromotionOut(BaseModel):
    id: uuid.UUID
    code: str
    type: str
    value: float
    scope: dict | None
    starts_at: datetime | None
    ends_at: datetime | None
    active: bool
    created_at: datetime

    model_config = {"from_attributes": True}
