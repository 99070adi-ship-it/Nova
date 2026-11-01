import uuid
from collections.abc import Callable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import utcnow
from app.config import get_settings
from app.db.models import Inventory, Organization, Product, ProductImage, StorefrontVersion, StorefrontVersionStatus
from app.schemas.public import PublicImage, PublicProduct, PublicVariant
from app.errors import NotFoundError
from app.repositories import collection_repo, product_repo, storefront_repo
from app.services.checkout_service import available_of


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


async def get_storefront_by_version_id(db: AsyncSession, version_id: uuid.UUID) -> tuple[Organization, StorefrontVersion]:
    """Backs the unauthenticated draft-preview link opened from Store Builder (ARCHITECTURE.md
    "Real store preview") — the version id itself, not a session, is the access key, same
    trade-off an unlisted staging link makes; acceptable for Prototype 1, not for production."""

    version = await storefront_repo.get_by_id(db, version_id)
    if version is None:
        raise NotFoundError("Storefront version not found")
    org = await db.get(Organization, version.org_id)
    if org is None:
        raise NotFoundError("Store not found")
    return org, version


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


async def record_preview_loaded(db: AsyncSession, version_id: uuid.UUID) -> bool:
    """The storefront app calls this only after a draft preview has fetched AND rendered. Records
    the first such load on a draft with real content; anything else is a no-op, never an error the
    previewing page has to handle. Returns whether this call recorded the event.

    Same access model as the preview GET itself: the unguessable version id is the capability.
    Live versions are not recorded — onboarding's `preview` step is about the draft."""

    version = await storefront_repo.get_by_id(db, version_id)
    if version is None:
        raise NotFoundError("Storefront version not found")
    if version.status != StorefrontVersionStatus.draft or not any(p.sections for p in version.pages):
        return False
    recorded = await storefront_repo.mark_preview_loaded(db, version.id, at=utcnow())
    await db.commit()
    return recorded


def absolute_url_builder(base_url: str) -> Callable[[str | None], str | None]:
    """Images are stored as site-relative paths (e.g. /static/velora/tote.svg) or full https URLs. The public API
    always returns absolute URLs, so a storefront on another origin can load them."""
    base = (get_settings().public_base_url or base_url).rstrip("/")

    def absolute(url: str | None) -> str | None:
        if not url:
            return None
        return url if url.startswith(("http://", "https://")) else f"{base}/{url.lstrip('/')}"

    return absolute


async def build_public_products(db: AsyncSession, org_id: uuid.UUID, products: list[Product], absolute) -> list[PublicProduct]:
    """Published products with their images and REAL stock, in three queries (no per-product lookups)."""
    if not products:
        return []
    product_ids = [p.id for p in products]
    variant_ids = [v.id for p in products for v in p.variants]
    image_rows = (await db.execute(select(ProductImage).where(ProductImage.product_id.in_(product_ids)).order_by(ProductImage.created_at))).scalars().all()
    inventory_rows = (await db.execute(select(Inventory).where(Inventory.variant_id.in_(variant_ids)))).scalars().all() if variant_ids else []
    images: dict[uuid.UUID, list[ProductImage]] = {}
    for img in image_rows:
        images.setdefault(img.product_id, []).append(img)
    stock: dict[uuid.UUID, list[Inventory]] = {}
    for inv in inventory_rows:
        stock.setdefault(inv.variant_id, []).append(inv)

    out: list[PublicProduct] = []
    for p in products:
        ordered = sorted(images.get(p.id, []), key=lambda i: (0 if i.role.value == "canonical" else 1))
        variants = []
        for v in sorted(p.variants, key=lambda v: v.sku):
            rows = stock.get(v.id, [])
            avail = available_of(rows)
            threshold = sum(r.low_stock_threshold for r in rows)
            variants.append(PublicVariant(
                id=v.id, sku=v.sku, price=float(v.price), attributes=v.attributes, available=avail, in_stock=avail > 0,
                low_stock=0 < avail <= threshold,
            ))
        out.append(PublicProduct(
            id=p.id, title=p.title, slug=p.slug, category=p.category, description=p.description, seo_title=p.seo_title,
            seo_description=p.seo_description, tags=[t for t in (p.tags or []) if isinstance(t, str)],
            images=[PublicImage(url=absolute(i.url), alt_text=i.alt_text) for i in ordered if absolute(i.url)],
            variants=variants,
        ))
    return out
