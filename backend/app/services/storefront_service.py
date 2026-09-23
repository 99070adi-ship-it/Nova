import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import utcnow
from app.db.models import GeneratedBy, StorefrontVersion, StorefrontVersionStatus
from app.errors import NotFoundError
from app.repositories import storefront_repo, store_creation_repo

DEFAULT_THEME_TOKENS = {
    "primary_color": "#171717",
    "background_color": "#fafafa",
    "font_family": "system-ui, sans-serif",
    "border_radius": "8px",
}


def _default_homepage(brand_name: str) -> list[dict]:
    return [
        {
            "slug": "home",
            "title": "Home",
            "order": 0,
            "sections": [
                {
                    "type": "hero",
                    "order": 0,
                    "configuration": {
                        "headline": brand_name,
                        "subheadline": "Shop the collection",
                        "cta_text": "Shop now",
                        "cta_href": "/shop",
                    },
                },
                {
                    "type": "product_grid",
                    "order": 1,
                    "configuration": {"title": "Shop all", "collection_id": None, "limit": 12},
                },
            ],
        }
    ]


async def get_or_create_draft(db: AsyncSession, org_id: uuid.UUID) -> StorefrontVersion:
    draft = await storefront_repo.get_draft(db, org_id)
    if draft is not None:
        return draft

    brand = await store_creation_repo.get_brand_profile(db, org_id)
    brand_name = brand.name if brand is not None else "My Store"
    draft = await storefront_repo.create_version(
        db, org_id, status=StorefrontVersionStatus.draft, generated_by=GeneratedBy.owner,
        pages=_default_homepage(brand_name), theme_tokens=DEFAULT_THEME_TOKENS,
    )
    await db.commit()
    return draft


async def get_live_or_404(db: AsyncSession, org_id: uuid.UUID) -> StorefrontVersion:
    live = await storefront_repo.get_live(db, org_id)
    if live is None:
        raise NotFoundError("No published storefront yet")
    return live


def _snapshot_pages(draft: StorefrontVersion) -> list[dict]:
    return [
        {
            "slug": page.slug,
            "title": page.title,
            "order": page.order,
            "sections": [
                {"type": s.type, "order": s.order, "configuration": s.configuration}
                for s in sorted(page.sections, key=lambda s: s.order)
            ],
        }
        for page in sorted(draft.pages, key=lambda p: p.order)
    ]


async def publish(db: AsyncSession, org_id: uuid.UUID) -> StorefrontVersion:
    """Copies the current draft's section tree into a new immutable `live` version — the draft
    itself is untouched, so it keeps evolving independently of what's published
    (ARCHITECTURE.md "Storefront live/draft/publish model")."""

    draft = await get_or_create_draft(db, org_id)
    live = await storefront_repo.create_version(
        db, org_id, status=StorefrontVersionStatus.live, generated_by=draft.generated_by,
        pages=_snapshot_pages(draft), theme_tokens=draft.theme.tokens, published_at=utcnow(),
    )
    await db.commit()
    return live
