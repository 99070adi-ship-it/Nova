import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Collection, CollectionProductCreatedBy
from app.errors import NotFoundError
from app.repositories import collection_repo, product_repo


async def list_collections(db: AsyncSession, org_id: uuid.UUID) -> list[tuple[Collection, list[uuid.UUID]]]:
    collections = await collection_repo.list_collections(db, org_id)
    return [(c, await collection_repo.get_product_ids(db, c.id)) for c in collections]


async def get_collection_or_404(db: AsyncSession, org_id: uuid.UUID, collection_id: uuid.UUID) -> tuple[Collection, list[uuid.UUID]]:
    collection = await collection_repo.get_collection(db, org_id, collection_id)
    if collection is None:
        raise NotFoundError("Collection not found")
    return collection, await collection_repo.get_product_ids(db, collection.id)


async def create_collection(db: AsyncSession, org_id: uuid.UUID, payload) -> Collection:
    collection = await collection_repo.create_collection(
        db, org_id, title=payload.title, slug=payload.slug, description=payload.description
    )
    await db.commit()
    return collection


async def update_collection(db: AsyncSession, org_id: uuid.UUID, collection_id: uuid.UUID, payload) -> Collection:
    collection = await collection_repo.update_collection(
        db, org_id, collection_id, **payload.model_dump(exclude_unset=True)
    )
    if collection is None:
        raise NotFoundError("Collection not found")
    await db.commit()
    return collection


async def add_product(db: AsyncSession, org_id: uuid.UUID, collection_id: uuid.UUID, product_id: uuid.UUID) -> None:
    collection = await collection_repo.get_collection(db, org_id, collection_id)
    if collection is None:
        raise NotFoundError("Collection not found")
    product = await product_repo.get_product(db, org_id, product_id)
    if product is None:
        raise NotFoundError("Product not found")
    await collection_repo.add_product(db, collection_id, product_id, created_by=CollectionProductCreatedBy.owner)
    await db.commit()


async def remove_product(db: AsyncSession, org_id: uuid.UUID, collection_id: uuid.UUID, product_id: uuid.UUID) -> None:
    collection = await collection_repo.get_collection(db, org_id, collection_id)
    if collection is None:
        raise NotFoundError("Collection not found")
    await collection_repo.remove_product(db, collection_id, product_id)
    await db.commit()
