"""Storefront cart validation, demo checkout and guest order lookup.

Everything the shopper's browser sends is a CLAIM: the cart holds only variant ids and quantities, and every
price, title, stock figure and total here is read from the database at that moment. Checkout runs in one
transaction that locks the inventory rows it will decrement, so two shoppers can never buy the same last
unit, and an idempotency key makes a double-click or a retried request return the same order.

There is no payment provider. Orders are created with payment_status "pending" and this module never marks
one paid; the storefront labels the whole flow as a demo."""

import time
import uuid
from collections import defaultdict, deque
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import get_settings
from app.db.base import utcnow
from app.db.models import (
    AnalyticsEventType, CheckoutRequest, Customer, Inventory, InventoryMovement, Order, OrderItem, OrderStatus,
    PaymentStatus, Product, ProductImage, ProductStatus, ProductVariant,
)
from app.errors import ConflictError, NotFoundError, ValidationDomainError
from app.repositories import analytics_repo
from app.schemas.public import (
    CartLineIn, CartLineOut, CartOut, CheckoutIn, OrderItemOut, PublicOrder,
)


def _money(value) -> float:
    return float(Decimal(str(value)).quantize(Decimal("0.01")))


def merge_lines(items: list[CartLineIn]) -> dict[uuid.UUID, int]:
    """Duplicate lines for one variant are one line (the sum), so a split cart cannot dodge a limit."""
    merged: dict[uuid.UUID, int] = defaultdict(int)
    for item in items:
        merged[item.variant_id] += item.quantity
    return dict(merged)


async def _variants(db: AsyncSession, org_id: uuid.UUID, ids: list[uuid.UUID], *, lock: bool = False):
    """Variants of PUBLISHED products in this store only; another store's variant id simply does not resolve."""
    stmt = (
        select(ProductVariant, Product)
        .join(Product, Product.id == ProductVariant.product_id)
        .where(ProductVariant.id.in_(ids), ProductVariant.org_id == org_id, Product.org_id == org_id, Product.status == ProductStatus.published)
    )
    rows = (await db.execute(stmt)).all()
    return {v.id: (v, p) for v, p in rows}


async def _inventory(db: AsyncSession, ids: list[uuid.UUID], *, lock: bool) -> dict[uuid.UUID, list[Inventory]]:
    stmt = select(Inventory).where(Inventory.variant_id.in_(ids)).order_by(Inventory.id)  # stable order: no lock cycles
    if lock:
        stmt = stmt.with_for_update()
    by_variant: dict[uuid.UUID, list[Inventory]] = defaultdict(list)
    for inv in (await db.execute(stmt)).scalars().all():
        by_variant[inv.variant_id].append(inv)
    return by_variant


def available_of(rows: list[Inventory]) -> int:
    return max(0, sum(i.on_hand - i.reserved for i in rows))


async def _primary_images(db: AsyncSession, product_ids: list[uuid.UUID]) -> dict[uuid.UUID, str]:
    rows = (await db.execute(select(ProductImage).where(ProductImage.product_id.in_(product_ids)).order_by(ProductImage.created_at))).scalars().all()
    out: dict[uuid.UUID, str] = {}
    for img in sorted(rows, key=lambda i: 0 if i.role.value == "canonical" else 1):
        out.setdefault(img.product_id, img.url)
    return out


async def validate_cart(db: AsyncSession, org_id: uuid.UUID, items: list[CartLineIn], *, absolute) -> CartOut:
    """The cart as it really stands: authoritative prices, real stock, and what (if anything) blocks checkout."""
    cap = get_settings().checkout_max_quantity_per_line
    merged = merge_lines(items)
    ids = list(merged)
    variants = await _variants(db, org_id, ids) if ids else {}
    inventory = await _inventory(db, list(variants), lock=False) if variants else {}
    images = await _primary_images(db, [p.id for _, p in variants.values()]) if variants else {}

    lines: list[CartLineOut] = []
    subtotal = Decimal("0")
    can_checkout = bool(merged)
    for variant_id, quantity in merged.items():
        found = variants.get(variant_id)
        if found is None:
            lines.append(CartLineOut(variant_id=variant_id, quantity=quantity, issues=["unavailable"]))
            can_checkout = False
            continue
        variant, product = found
        available = available_of(inventory.get(variant_id, []))
        issues: list[str] = []
        if available <= 0:
            issues.append("out_of_stock")
        elif quantity > available:
            issues.append("insufficient_stock")
        if quantity > cap:
            issues.append("quantity_capped")
        line_total = _money(Decimal(str(variant.price)) * quantity) if not issues else None
        if issues:
            can_checkout = False
        else:
            subtotal += Decimal(str(variant.price)) * quantity
        image = images.get(product.id)
        lines.append(CartLineOut(
            variant_id=variant_id, product_slug=product.slug, title=product.title, sku=variant.sku, attributes=variant.attributes,
            image_url=absolute(image) if image else None, unit_price=_money(variant.price), quantity=quantity, available=available,
            max_quantity=min(available, cap), line_total=line_total, issues=issues,
        ))
    return CartOut(lines=lines, subtotal=_money(subtotal), can_checkout=can_checkout)


def _to_public_order(order: Order, customer: Customer, titles: dict[uuid.UUID, tuple[str, str, dict | None]], *, replayed: bool = False) -> PublicOrder:
    items = []
    for item in order.items:
        title, sku, attributes = titles.get(item.variant_id, ("Item no longer sold", "", None))
        items.append(OrderItemOut(
            title=title, sku=sku, attributes=attributes, quantity=item.quantity, unit_price=_money(item.unit_price),
            line_total=_money(Decimal(str(item.unit_price)) * item.quantity),
        ))
    return PublicOrder(
        id=order.id, status=order.status.value, payment_status=order.payment_status.value, total=_money(order.total),
        created_at=order.created_at, customer_name=customer.name, customer_email=customer.email, items=items, replayed=replayed,
    )


async def _order_view(db: AsyncSession, org_id: uuid.UUID, order_id: uuid.UUID, *, replayed: bool = False) -> PublicOrder:
    order = (await db.execute(select(Order).where(Order.id == order_id, Order.org_id == org_id).options(selectinload(Order.items)))).scalar_one()
    customer = await db.get(Customer, order.customer_id)
    ids = [i.variant_id for i in order.items]
    rows = (await db.execute(
        select(ProductVariant.id, Product.title, ProductVariant.sku, ProductVariant.attributes)
        .join(Product, Product.id == ProductVariant.product_id).where(ProductVariant.id.in_(ids))
    )).all()
    return _to_public_order(order, customer, {r[0]: (r[1], r[2], r[3]) for r in rows}, replayed=replayed)  # type: ignore[arg-type]


async def place_order(db: AsyncSession, org_id: uuid.UUID, payload: CheckoutIn) -> PublicOrder:
    if not payload.demo_checkout_acknowledged:
        raise ValidationDomainError("Please confirm that you understand this is a demo checkout: no payment is taken.")

    settings = get_settings()
    existing = (await db.execute(select(CheckoutRequest).where(CheckoutRequest.org_id == org_id, CheckoutRequest.idempotency_key == payload.idempotency_key))).scalar_one_or_none()
    if existing is not None:
        return await _order_view(db, org_id, existing.order_id, replayed=True)

    merged = merge_lines(payload.items)
    if len(merged) > settings.checkout_max_lines:
        raise ValidationDomainError(f"A cart can hold at most {settings.checkout_max_lines} different items.")
    cap = settings.checkout_max_quantity_per_line
    ids = sorted(merged)  # deterministic lock order across concurrent checkouts

    variants = await _variants(db, org_id, ids)
    problems: list[dict] = []
    for variant_id in ids:
        if variant_id not in variants:
            problems.append({"variant_id": str(variant_id), "issue": "unavailable"})
        elif merged[variant_id] > cap:
            problems.append({"variant_id": str(variant_id), "issue": "quantity_capped", "max_quantity": cap})
    if problems:
        raise ConflictError("Some items in your cart can't be bought as they are.", details={"lines": problems})

    inventory = await _inventory(db, ids, lock=True)  # row locks held until commit: no overselling
    for variant_id in ids:
        available = available_of(inventory.get(variant_id, []))
        if merged[variant_id] > available:
            problems.append({"variant_id": str(variant_id), "issue": "out_of_stock" if available <= 0 else "insufficient_stock", "available": available})
    if problems:
        raise ConflictError("Some items just sold out or don't have enough stock.", details={"lines": problems})

    email = payload.customer_email.strip().lower()
    customer = (await db.execute(select(Customer).where(Customer.org_id == org_id, func.lower(Customer.email) == email))).scalars().first()
    if customer is None:
        customer = Customer(org_id=org_id, email=email, name=payload.customer_name.strip())
        db.add(customer)
        await db.flush()

    total = Decimal("0")
    order = Order(org_id=org_id, customer_id=customer.id, status=OrderStatus.pending, payment_status=PaymentStatus.pending, total=0)
    db.add(order)
    await db.flush()
    for variant_id in ids:
        variant, product = variants[variant_id]
        quantity = merged[variant_id]
        db.add(OrderItem(order_id=order.id, variant_id=variant_id, quantity=quantity, unit_price=variant.price))
        total += Decimal(str(variant.price)) * quantity
        remaining = quantity
        for inv in inventory[variant_id]:
            take = min(remaining, max(0, inv.on_hand - inv.reserved))
            if take:
                inv.on_hand -= take
                db.add(InventoryMovement(inventory_id=inv.id, delta=-take, reason=f"Storefront order {order.id}"))
                remaining -= take
        await analytics_repo.record_event(db, org_id, event_type=AnalyticsEventType.purchase, product_id=product.id)
    order.total = _money(total)

    db.add(CheckoutRequest(org_id=org_id, idempotency_key=payload.idempotency_key, order_id=order.id, created_at=utcnow()))
    try:
        await db.flush()
    except IntegrityError:
        # A concurrent request with the same key won the race: discard this attempt and return its order.
        await db.rollback()
        winner = (await db.execute(select(CheckoutRequest).where(CheckoutRequest.org_id == org_id, CheckoutRequest.idempotency_key == payload.idempotency_key))).scalar_one()
        return await _order_view(db, org_id, winner.order_id, replayed=True)
    await analytics_repo.recompute_daily_metrics(db, org_id)
    await db.commit()
    return await _order_view(db, org_id, order.id)


# ---- guest order lookup (there are no customer accounts) --------------------------------------------------

_lookups: dict[str, deque[float]] = defaultdict(deque)


def check_lookup_rate(client_key: str, *, now: float | None = None) -> None:
    limit = get_settings().order_lookups_per_minute
    t = time.monotonic() if now is None else now
    q = _lookups[client_key]
    while q and t - q[0] > 60:
        q.popleft()
    if len(q) >= limit:
        raise ValidationDomainError("Too many lookups. Please wait a minute and try again.")
    q.append(t)


async def lookup_order(db: AsyncSession, org_id: uuid.UUID, order_id: uuid.UUID, email: str) -> PublicOrder:
    """An order is visible only with BOTH its unguessable id and the email it was placed with, inside the store
    it belongs to. A wrong id, wrong email or another store's order all give the same answer."""
    row = (await db.execute(
        select(Order, Customer).join(Customer, Customer.id == Order.customer_id)
        .where(Order.id == order_id, Order.org_id == org_id, func.lower(Customer.email) == email.strip().lower())
    )).first()
    if row is None:
        raise NotFoundError("We couldn't find an order with that number and email.")
    return await _order_view(db, org_id, order_id)
