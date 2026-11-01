import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.db.models import AnalyticsEventType


class RecordEvent(BaseModel):
    event_type: AnalyticsEventType
    product_slug: str | None = None


class PublicVariant(BaseModel):
    id: uuid.UUID
    sku: str
    price: float
    attributes: dict | None = None
    # Real stock: on hand minus reserved, summed over locations. Never invented, never padded.
    available: int = 0
    in_stock: bool = False
    low_stock: bool = False

    model_config = {"from_attributes": True}


class PublicImage(BaseModel):
    url: str
    alt_text: str | None = None


class PublicProduct(BaseModel):
    id: uuid.UUID
    title: str
    slug: str
    category: str | None
    description: str | None
    seo_title: str | None = None
    seo_description: str | None = None
    tags: list[str] = []
    images: list[PublicImage] = []
    variants: list[PublicVariant]

    model_config = {"from_attributes": True}


class PublicStoreInfo(BaseModel):
    store_name: str
    slug: str
    currency: str = "USD"
    # Checkout is a labelled demo: no payment provider is connected, so no payment is ever taken or claimed.
    demo_checkout: bool = True
    has_live_storefront: bool = False
    max_quantity_per_line: int = 10


class PublicCollection(BaseModel):
    id: uuid.UUID
    title: str
    slug: str
    description: str | None
    product_ids: list[uuid.UUID]

    model_config = {"from_attributes": True}


class PublicSection(BaseModel):
    id: uuid.UUID
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
    # Lets a draft-preview link (which carries only the version id) find the store its catalog belongs to.
    org_slug: str
    theme: dict
    pages: list[PublicPage]


class CartLineIn(BaseModel):
    variant_id: uuid.UUID
    quantity: int = Field(ge=1, le=1000)


class CartValidateIn(BaseModel):
    items: list[CartLineIn] = Field(max_length=100)


class CartLineOut(BaseModel):
    variant_id: uuid.UUID
    product_slug: str | None = None
    title: str | None = None
    sku: str | None = None
    attributes: dict | None = None
    image_url: str | None = None
    unit_price: float | None = None  # authoritative: read from the catalog now, never from the client
    quantity: int
    available: int = 0
    max_quantity: int = 0
    line_total: float | None = None
    # unavailable | out_of_stock | insufficient_stock | quantity_capped. Empty means it can be bought as is.
    issues: list[str] = []


class CartOut(BaseModel):
    lines: list[CartLineOut]
    subtotal: float  # only lines with no issues count towards it
    currency: str = "USD"
    can_checkout: bool
    # Shipping and tax are not configured for this store, so none is calculated or implied.
    shipping_note: str = "Shipping and tax are not calculated in this demo."


class CheckoutIn(BaseModel):
    idempotency_key: str = Field(min_length=8, max_length=80, pattern=r"^[A-Za-z0-9_\-]+$")
    customer_email: EmailStr
    customer_name: str = Field(min_length=1, max_length=200)
    items: list[CartLineIn] = Field(min_length=1, max_length=100)
    # The shopper must acknowledge this is a demo checkout. There is no payment processor behind it.
    demo_checkout_acknowledged: bool


class OrderItemOut(BaseModel):
    title: str
    sku: str
    attributes: dict | None = None
    quantity: int
    unit_price: float
    line_total: float


class PublicOrder(BaseModel):
    id: uuid.UUID
    status: str
    payment_status: str  # "pending" until a payment provider confirms; this demo never sets it to paid
    total: float
    currency: str = "USD"
    created_at: datetime
    customer_name: str
    customer_email: str
    items: list[OrderItemOut]
    demo: bool = True
    note: str = "Demo order. No payment was taken and nothing will be shipped."
    replayed: bool = False


class OrderLookupIn(BaseModel):
    order_id: uuid.UUID
    email: EmailStr
