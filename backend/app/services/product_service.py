import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Product
from app.errors import NotFoundError
from app.repositories import inventory_repo, product_repo


async def list_products(db: AsyncSession, org_id: uuid.UUID) -> list[Product]:
    return await product_repo.list_products(db, org_id)


async def get_product_or_404(db: AsyncSession, org_id: uuid.UUID, product_id: uuid.UUID) -> Product:
    product = await product_repo.get_product(db, org_id, product_id)
    if product is None:
        raise NotFoundError("Product not found")
    return product


async def create_product(db: AsyncSession, org_id: uuid.UUID, payload) -> Product:
    product = await product_repo.create_product(
        db, org_id,
        title=payload.title, slug=payload.slug, category=payload.category, tags=payload.tags,
        description=payload.description, seo_title=payload.seo_title, seo_description=payload.seo_description,
        variants=[v.model_dump() for v in payload.variants],
    )
    # Every variant gets a stock record from day one — otherwise there's no entry point into
    # inventory tracking/adjustment at all.
    location = await inventory_repo.get_or_create_default_location(db, org_id)
    for variant in product.variants:
        await inventory_repo.create_inventory_row(
            db, variant_id=variant.id, location_id=location.id, on_hand=0, low_stock_threshold=5
        )
    await db.commit()
    return product


async def update_product(db: AsyncSession, org_id: uuid.UUID, product_id: uuid.UUID, payload) -> Product:
    product = await product_repo.update_product(db, org_id, product_id, **payload.model_dump(exclude_unset=True))
    if product is None:
        raise NotFoundError("Product not found")
    await db.commit()
    return product
