import uuid
from datetime import date, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import utcnow
from app.db.models import (
    AnalyticsEvent,
    AnalyticsEventType,
    Customer,
    Inventory,
    Order,
    OrderItem,
    Product,
    ProductVariant,
    SalesMetricDaily,
)


async def record_event(
    db: AsyncSession, org_id: uuid.UUID, *, event_type: AnalyticsEventType, product_id: uuid.UUID | None = None,
    collection_id: uuid.UUID | None = None,
) -> AnalyticsEvent:
    event = AnalyticsEvent(org_id=org_id, event_type=event_type, product_id=product_id, collection_id=collection_id)
    db.add(event)
    await db.flush()
    return event


async def count_events(db: AsyncSession, org_id: uuid.UUID, *, event_type: AnalyticsEventType, since_days: int) -> int:
    cutoff = utcnow() - timedelta(days=since_days)
    result = await db.execute(
        select(func.count()).select_from(AnalyticsEvent).where(
            AnalyticsEvent.org_id == org_id, AnalyticsEvent.event_type == event_type, AnalyticsEvent.created_at >= cutoff
        )
    )
    return result.scalar_one()


async def recompute_daily_metrics(db: AsyncSession, org_id: uuid.UUID) -> None:
    """Rebuilds SalesMetricDaily from Order/OrderItem for this org — cheap at demo data volume,
    so a full recompute on every order (rather than an incremental update) keeps this simple and
    always correct (ARCHITECTURE.md "Analytics": agents query the rollup, never raw events)."""

    await db.execute(delete(SalesMetricDaily).where(SalesMetricDaily.org_id == org_id))

    # Per-product daily rollup.
    per_product = await db.execute(
        select(
            func.date(Order.created_at).label("day"), ProductVariant.product_id,
            func.sum(OrderItem.unit_price * OrderItem.quantity).label("revenue"),
            func.count(func.distinct(Order.id)).label("orders"), func.sum(OrderItem.quantity).label("units"),
        )
        .select_from(Order)
        .join(OrderItem, OrderItem.order_id == Order.id)
        .join(ProductVariant, ProductVariant.id == OrderItem.variant_id)
        .where(Order.org_id == org_id)
        .group_by(func.date(Order.created_at), ProductVariant.product_id)
    )
    for row in per_product.all():
        db.add(SalesMetricDaily(org_id=org_id, date=row.day, product_id=row.product_id, revenue=row.revenue or 0, orders=row.orders, units=row.units or 0))

    # Org-wide daily total (product_id=None).
    totals = await db.execute(
        select(
            func.date(Order.created_at).label("day"),
            func.sum(Order.total).label("revenue"), func.count(func.distinct(Order.id)).label("orders"),
        )
        .where(Order.org_id == org_id)
        .group_by(func.date(Order.created_at))
    )
    for row in totals.all():
        db.add(SalesMetricDaily(org_id=org_id, date=row.day, product_id=None, revenue=row.revenue or 0, orders=row.orders, units=0))

    await db.flush()


async def get_sales_summary(db: AsyncSession, org_id: uuid.UUID, *, days: int) -> dict:
    cutoff = date.today() - timedelta(days=days)
    totals = (
        await db.execute(
            select(func.coalesce(func.sum(SalesMetricDaily.revenue), 0), func.coalesce(func.sum(SalesMetricDaily.orders), 0))
            .where(SalesMetricDaily.org_id == org_id, SalesMetricDaily.product_id.is_(None), SalesMetricDaily.date >= cutoff)
        )
    ).one()

    top_products_result = await db.execute(
        select(Product.title, func.sum(SalesMetricDaily.revenue).label("revenue"), func.sum(SalesMetricDaily.units).label("units"))
        .join(Product, Product.id == SalesMetricDaily.product_id)
        .where(SalesMetricDaily.org_id == org_id, SalesMetricDaily.date >= cutoff)
        .group_by(Product.id, Product.title)
        .order_by(func.sum(SalesMetricDaily.revenue).desc())
        .limit(5)
    )
    top_products = [{"title": r.title, "revenue": float(r.revenue or 0), "units": int(r.units or 0)} for r in top_products_result.all()]

    return {"revenue": float(totals[0]), "orders": int(totals[1]), "top_products": top_products, "days": days}


async def get_low_stock_products(db: AsyncSession, org_id: uuid.UUID) -> list[dict]:
    result = await db.execute(
        select(Product.title, ProductVariant.sku, Inventory.on_hand, Inventory.low_stock_threshold)
        .select_from(Inventory)
        .join(ProductVariant, Inventory.variant_id == ProductVariant.id)
        .join(Product, ProductVariant.product_id == Product.id)
        .where(Product.org_id == org_id, Inventory.on_hand <= Inventory.low_stock_threshold)
        .order_by(Inventory.on_hand.asc())
    )
    return [{"title": r.title, "sku": r.sku, "on_hand": r.on_hand, "low_stock_threshold": r.low_stock_threshold} for r in result.all()]


async def get_customer_activity(db: AsyncSession, org_id: uuid.UUID, *, inactive_days: int) -> list[dict]:
    cutoff = utcnow() - timedelta(days=inactive_days)
    result = await db.execute(
        select(Customer.id, Customer.name, Customer.email, func.max(Order.created_at).label("last_order_at"), func.count(Order.id).label("order_count"))
        .select_from(Customer)
        .outerjoin(Order, Order.customer_id == Customer.id)
        .where(Customer.org_id == org_id)
        .group_by(Customer.id, Customer.name, Customer.email)
    )
    rows = []
    for r in result.all():
        is_inactive = r.last_order_at is None or r.last_order_at < cutoff
        rows.append({
            "name": r.name, "email": r.email, "order_count": int(r.order_count or 0),
            "last_order_at": r.last_order_at.isoformat() if r.last_order_at else None, "inactive": is_inactive,
        })
    return rows
