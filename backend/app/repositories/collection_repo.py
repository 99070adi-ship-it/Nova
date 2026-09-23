import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Collection, CollectionProduct, CollectionProductCreatedBy


async def list_collections(db: AsyncSession, org_id: uuid.UUID) -> list[Collection]:
    result = await db.execute(select(Collection).where(Collection.org_id == org_id).order_by(Collection.created_at.desc()))
    return list(result.scalars().all())


async def get_collection(db: AsyncSession, org_id: uuid.UUID, collection_id: uuid.UUID) -> Collection | None:
    result = await db.execute(select(Collection).where(Collection.id == collection_id, Collection.org_id == org_id))
    return result.scalar_one_or_none()


async def get_product_ids(db: AsyncSession, collection_id: uuid.UUID) -> list[uuid.UUID]:
    result = await db.execute(select(CollectionProduct.product_id).where(CollectionProduct.collection_id == collection_id))
    return list(result.scalars().all())


async def create_collection(db: AsyncSession, org_id: uuid.UUID, *, title: str, slug: str, description: str | None) -> Collection:
    collection = Collection(org_id=org_id, title=title, slug=slug, description=description)
    db.add(collection)
    await db.flush()
    return collection


async def update_collection(db: AsyncSession, org_id: uuid.UUID, collection_id: uuid.UUID, **fields) -> Collection | None:
    collection = await get_collection(db, org_id, collection_id)
    if collection is None:
        return None
    for key, value in fields.items():
        if value is not None:
            setattr(collection, key, value)
    await db.flush()
    return collection


async def add_product(
    db: AsyncSession, collection_id: uuid.UUID, product_id: uuid.UUID, *, created_by: CollectionProductCreatedBy
) -> None:
    existing = await db.execute(
        select(CollectionProduct).where(
            CollectionProduct.collection_id == collection_id, CollectionProduct.product_id == product_id
        )
    )
    if existing.scalar_one_or_none() is not None:
        return
    db.add(CollectionProduct(collection_id=collection_id, product_id=product_id, created_by=created_by))
    await db.flush()


async def remove_product(db: AsyncSession, collection_id: uuid.UUID, product_id: uuid.UUID) -> None:
    result = await db.execute(
        select(CollectionProduct).where(
            CollectionProduct.collection_id == collection_id, CollectionProduct.product_id == product_id
        )
    )
    row = result.scalar_one_or_none()
    if row is not None:
        await db.delete(row)
        await db.flush()
