import uuid

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.models import Product, ProductImage, ProductImageRole, ProductStatus, ProductVariant


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


async def sku_taken(db: AsyncSession, org_id: uuid.UUID, sku: str) -> bool:
    result = await db.execute(select(ProductVariant.id).where(ProductVariant.org_id == org_id, ProductVariant.sku == sku).limit(1))
    return result.first() is not None


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
        db.add(ProductVariant(org_id=org_id, product_id=product.id, **v))
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


async def list_products_missing_description(db: AsyncSession, org_id: uuid.UUID) -> list[Product]:
    result = await db.execute(
        select(Product)
        .where(Product.org_id == org_id, or_(Product.description.is_(None), Product.description == ""))
        .options(selectinload(Product.variants))
    )
    return list(result.scalars().unique().all())


async def update_product(db: AsyncSession, org_id: uuid.UUID, product_id: uuid.UUID, **fields) -> Product | None:
    product = await get_product(db, org_id, product_id)
    if product is None:
        return None
    for key, value in fields.items():
        if value is not None:
            setattr(product, key, value)
    await db.flush()
    return product


async def create_canonical_image(db: AsyncSession, product_id: uuid.UUID, *, url: str) -> ProductImage:
    image = ProductImage(product_id=product_id, url=url, role=ProductImageRole.canonical, is_ai_generated=False)
    db.add(image)
    await db.flush()
    return image


async def get_canonical_image(db: AsyncSession, product_id: uuid.UUID) -> ProductImage | None:
    result = await db.execute(
        select(ProductImage).where(ProductImage.product_id == product_id, ProductImage.role == ProductImageRole.canonical)
    )
    return result.scalars().first()


async def list_images(db: AsyncSession, product_id: uuid.UUID) -> list[ProductImage]:
    result = await db.execute(select(ProductImage).where(ProductImage.product_id == product_id).order_by(ProductImage.created_at.asc()))
    return list(result.scalars().all())


async def create_generated_image(
    db: AsyncSession, product_id: uuid.UUID, *, url: str, provider: str, model: str, prompt_metadata: dict,
    environment: str | None, mood: str | None, source_image_id: uuid.UUID,
) -> ProductImage:
    image = ProductImage(
        product_id=product_id, url=url, role=ProductImageRole.generated, is_ai_generated=True, provider=provider,
        model=model, prompt_metadata=prompt_metadata, environment=environment, mood=mood, source_image_id=source_image_id,
    )
    db.add(image)
    await db.flush()
    return image
