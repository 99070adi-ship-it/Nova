import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.schemas.public import PublicCollection, PublicPage, PublicProduct, PublicSection, PublicStorefront, RecordEvent
from app.services import analytics_service, public_service

router = APIRouter()


@router.get("/stores/{org_slug}/storefront", response_model=PublicStorefront)
async def get_storefront(org_slug: str, db: AsyncSession = Depends(get_db)) -> PublicStorefront:
    org = await public_service.get_org_by_slug_or_404(db, org_slug)
    live = await public_service.get_live_storefront(db, org.id)
    return PublicStorefront(
        store_name=org.name,
        theme=live.theme.tokens,
        pages=[
            PublicPage(
                slug=p.slug, title=p.title, order=p.order,
                sections=[PublicSection.model_validate(s) for s in sorted(p.sections, key=lambda s: s.order)],
            )
            for p in sorted(live.pages, key=lambda p: p.order)
        ],
    )


@router.get("/preview/{version_id}", response_model=PublicStorefront)
async def get_storefront_preview(version_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> PublicStorefront:
    org, version = await public_service.get_storefront_by_version_id(db, version_id)
    return PublicStorefront(
        store_name=org.name,
        theme=version.theme.tokens,
        pages=[
            PublicPage(
                slug=p.slug, title=p.title, order=p.order,
                sections=[PublicSection.model_validate(s) for s in sorted(p.sections, key=lambda s: s.order)],
            )
            for p in sorted(version.pages, key=lambda p: p.order)
        ],
    )


@router.post("/preview/{version_id}/loaded", status_code=204)
async def record_preview_loaded(version_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> None:
    await public_service.record_preview_loaded(db, version_id)


@router.get("/stores/{org_slug}/products", response_model=list[PublicProduct])
async def list_products(org_slug: str, db: AsyncSession = Depends(get_db)) -> list[PublicProduct]:
    org = await public_service.get_org_by_slug_or_404(db, org_slug)
    products = await public_service.list_published_products(db, org.id)
    return [PublicProduct.model_validate(p) for p in products]


@router.get("/stores/{org_slug}/products/{product_slug}", response_model=PublicProduct)
async def get_product(org_slug: str, product_slug: str, db: AsyncSession = Depends(get_db)) -> PublicProduct:
    org = await public_service.get_org_by_slug_or_404(db, org_slug)
    product = await public_service.get_published_product_or_404(db, org.id, product_slug)
    return PublicProduct.model_validate(product)


@router.get("/stores/{org_slug}/collections", response_model=list[PublicCollection])
async def list_collections(org_slug: str, db: AsyncSession = Depends(get_db)) -> list[PublicCollection]:
    org = await public_service.get_org_by_slug_or_404(db, org_slug)
    rows = await public_service.list_collections(db, org.id)
    return [PublicCollection(id=c.id, title=c.title, slug=c.slug, description=c.description, product_ids=ids) for c, ids in rows]


@router.get("/stores/{org_slug}/collections/{collection_id}", response_model=PublicCollection)
async def get_collection(org_slug: str, collection_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> PublicCollection:
    org = await public_service.get_org_by_slug_or_404(db, org_slug)
    collection, ids = await public_service.get_collection_or_404(db, org.id, collection_id)
    return PublicCollection(id=collection.id, title=collection.title, slug=collection.slug, description=collection.description, product_ids=ids)


@router.post("/stores/{org_slug}/events", status_code=204)
async def record_event(org_slug: str, payload: RecordEvent, db: AsyncSession = Depends(get_db)) -> None:
    org = await public_service.get_org_by_slug_or_404(db, org_slug)
    await analytics_service.record_public_event(db, org.id, event_type=payload.event_type, product_slug=payload.product_slug)
