import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.db.models import OrderStatus, PaymentStatus


class OrderItemIn(BaseModel):
    variant_id: uuid.UUID
    quantity: int = Field(gt=0)


class OrderCreate(BaseModel):
    customer_id: uuid.UUID
    items: list[OrderItemIn] = Field(min_length=1)


class OrderItemOut(BaseModel):
    id: uuid.UUID
    variant_id: uuid.UUID
    quantity: int
    unit_price: float

    model_config = {"from_attributes": True}


class OrderOut(BaseModel):
    id: uuid.UUID
    customer_id: uuid.UUID
    status: OrderStatus
    payment_status: PaymentStatus
    total: float
    created_at: datetime
    items: list[OrderItemOut] = []

    model_config = {"from_attributes": True}
