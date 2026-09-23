from pydantic import BaseModel


class TopProduct(BaseModel):
    title: str
    revenue: float
    units: int


class SalesSummary(BaseModel):
    revenue: float
    orders: int
    top_products: list[TopProduct]
    days: int


class LowStockProduct(BaseModel):
    title: str
    sku: str
    on_hand: int
    low_stock_threshold: int


class CustomerActivity(BaseModel):
    name: str
    email: str
    order_count: int
    last_order_at: str | None
    inactive: bool
