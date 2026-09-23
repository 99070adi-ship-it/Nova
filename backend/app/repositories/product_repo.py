import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.models import Product, ProductStatus, ProductVariant


async def list_products(db: AsyncSession, org_id: uuid.UUID) -> list[Product]:
    result = await db.execute(
        select(Product).where(Product.org_id == org_id).options(selectinload(Product.variants)).order_by(Product.created_at.desc())
    )
    return list(result.scalars().unique().all())


async def get_product(db: AsyncSession, org_id: uuid.UUID, product_id: uuid.UUID) -> Product | None:
    result = await db.execute(
        select(Product)
        .where(Product.id == product_id, Product.org_id == org_id)
        .options(selectinload(Product.variants))
    )
    return result.scalar_one_or_none()


async def create_product(
    db: AsyncSession, org_id: uuid.UUID, *, title: str, slug: str, category: str | None, tags: list | None,
    description: str | None, seo_title: str | None, seo_description: str | None, variants: list[dict],
) -> Product:
    product = Product(
        org_id=org_id, title=title, slug=slug, category=category, tags=tags, description=description,
        seo_title=seo_title, seo_description=seo_description, status=ProductStatus.draft,
    )
    db.add(product)
    await db.flush()
    for v in variants:
        db.add(ProductVariant(product_id=product.id, **v))
    await db.flush()
    return await get_product(db, org_id, product.id)  # reload with variants relationship populated


async def list_published_products(db: AsyncSession, org_id: uuid.UUID) -> list[Product]:
    result = await db.execute(
        select(Product)
        .where(Product.org_id == org_id, Product.status == ProductStatus.published)
        .options(selectinload(Product.variants))
        .order_by(Product.created_at.desc())
    )
    return list(result.scalars().unique().all())


async def get_published_product_by_slug(db: AsyncSession, org_id: uuid.UUID, slug: str) -> Product | None:
    result = await db.execute(
        select(Product)
        .where(Product.org_id == org_id, Product.slug == slug, Product.status == ProductStatus.published)
        .options(selectinload(Product.variants))
    )
    return result.scalar_one_or_none()


async def update_product(db: AsyncSession, org_id: uuid.UUID, product_id: uuid.UUID, **fields) -> Product | None:
    product = await get_product(db, org_id, product_id)
    if product is None:
        return None
    for key, value in fields.items():
        if value is not None:
            setattr(product, key, value)
    await db.flush()
    return product
