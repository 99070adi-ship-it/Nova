import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import AuthContext, require_any_role
from app.db.session import get_db
from app.schemas.collection import AddProductToCollection, CollectionCreate, CollectionOut, CollectionUpdate
from app.services import collection_service

router = APIRouter()


def _to_out(collection, product_ids) -> CollectionOut:
    out = CollectionOut.model_validate(collection)
    out.product_ids = product_ids
    return out


@router.get("", response_model=list[CollectionOut])
async def list_collections(ctx: AuthContext = Depends(require_any_role), db: AsyncSession = Depends(get_db)) -> list[CollectionOut]:
    rows = await collection_service.list_collections(db, ctx.org_id)
    return [_to_out(c, ids) for c, ids in rows]


@router.get("/{collection_id}", response_model=CollectionOut)
async def get_collection(
    collection_id: uuid.UUID, ctx: AuthContext = Depends(require_any_role), db: AsyncSession = Depends(get_db)
) -> CollectionOut:
    collection, ids = await collection_service.get_collection_or_404(db, ctx.org_id, collection_id)
    return _to_out(collection, ids)


@router.post("", response_model=CollectionOut, status_code=201)
async def create_collection(
    payload: CollectionCreate, ctx: AuthContext = Depends(require_any_role), db: AsyncSession = Depends(get_db)
) -> CollectionOut:
    collection = await collection_service.create_collection(db, ctx.org_id, payload)
    return _to_out(collection, [])


@router.patch("/{collection_id}", response_model=CollectionOut)
async def update_collection(
    collection_id: uuid.UUID, payload: CollectionUpdate, ctx: AuthContext = Depends(require_any_role),
    db: AsyncSession = Depends(get_db),
) -> CollectionOut:
    collection = await collection_service.update_collection(db, ctx.org_id, collection_id, payload)
    _, ids = await collection_service.get_collection_or_404(db, ctx.org_id, collection_id)
    return _to_out(collection, ids)


@router.post("/{collection_id}/products", status_code=204)
async def add_product(
    collection_id: uuid.UUID, payload: AddProductToCollection, ctx: AuthContext = Depends(require_any_role),
    db: AsyncSession = Depends(get_db),
) -> None:
    await collection_service.add_product(db, ctx.org_id, collection_id, payload.product_id)


@router.delete("/{collection_id}/products/{product_id}", status_code=204)
async def remove_product(
    collection_id: uuid.UUID, product_id: uuid.UUID, ctx: AuthContext = Depends(require_any_role),
    db: AsyncSession = Depends(get_db),
) -> None:
    await collection_service.remove_product(db, ctx.org_id, collection_id, product_id)
