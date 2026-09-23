import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Organization, Product, StorefrontVersion
from app.errors import NotFoundError
from app.repositories import collection_repo, product_repo, storefront_repo


async def get_org_by_slug_or_404(db: AsyncSession, org_slug: str) -> Organization:
    org = await storefront_repo.get_org_by_slug(db, org_slug)
    if org is None:
        raise NotFoundError("Store not found")
    return org


async def get_live_storefront(db: AsyncSession, org_id: uuid.UUID) -> StorefrontVersion:
    live = await storefront_repo.get_live(db, org_id)
    if live is None:
        raise NotFoundError("This store hasn't published a storefront yet")
    return live


async def list_published_products(db: AsyncSession, org_id: uuid.UUID) -> list[Product]:
    return await product_repo.list_published_products(db, org_id)


async def get_published_product_or_404(db: AsyncSession, org_id: uuid.UUID, slug: str) -> Product:
    product = await product_repo.get_published_product_by_slug(db, org_id, slug)
    if product is None:
        raise NotFoundError("Product not found")
    return product


async def list_collections(db: AsyncSession, org_id: uuid.UUID) -> list[tuple]:
    collections = await collection_repo.list_collections(db, org_id)
    return [(c, await collection_repo.get_product_ids(db, c.id)) for c in collections]


async def get_collection_or_404(db: AsyncSession, org_id: uuid.UUID, collection_id: uuid.UUID) -> tuple:
    collection = await collection_repo.get_collection(db, org_id, collection_id)
    if collection is None:
        raise NotFoundError("Collection not found")
    return collection, await collection_repo.get_product_ids(db, collection.id)
