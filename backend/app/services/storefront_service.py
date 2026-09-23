import uuid

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import utcnow
from app.db.models import GeneratedBy, StorePage, StoreSection, StorefrontVersion, StorefrontVersionStatus
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
    try:
        draft = await storefront_repo.create_version(
            db, org_id, status=StorefrontVersionStatus.draft, generated_by=GeneratedBy.owner,
            pages=_default_homepage(brand_name), theme_tokens=DEFAULT_THEME_TOKENS,
        )
        await db.commit()
    except IntegrityError:
        # A concurrent request created the draft between our check and this create (the admin UI
        # fires /storefront/draft and /storefront/diff in parallel on page load) — the partial
        # unique index caught it. Roll back our attempt and use the one that won the race.
        await db.rollback()
        draft = await storefront_repo.get_draft(db, org_id)
        assert draft is not None
    return draft


async def get_live_or_404(db: AsyncSession, org_id: uuid.UUID) -> StorefrontVersion:
    live = await storefront_repo.get_live(db, org_id)
    if live is None:
        raise NotFoundError("No published storefront yet")
    return live


def snapshot_pages(draft: StorefrontVersion) -> list[dict]:
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
        pages=snapshot_pages(draft), theme_tokens=draft.theme.tokens, published_at=utcnow(),
    )
    await db.commit()
    return live


async def add_section(db: AsyncSession, org_id: uuid.UUID, page_id: uuid.UUID, *, type: str, order: int, configuration: dict) -> StoreSection:
    page = await storefront_repo.get_page_in_draft(db, org_id, page_id)
    if page is None:
        raise NotFoundError("Page not found in the current draft")
    section = await storefront_repo.add_section(db, page_id, type=type, order=order, configuration=configuration)
    await db.commit()
    return section


async def update_section(db: AsyncSession, org_id: uuid.UUID, section_id: uuid.UUID, *, order: int | None, configuration: dict | None) -> StoreSection:
    section = await storefront_repo.get_section_in_draft(db, org_id, section_id)
    if section is None:
        raise NotFoundError("Section not found in the current draft")
    section = await storefront_repo.update_section(db, section, order=order, configuration=configuration)
    await db.commit()
    return section


async def delete_section(db: AsyncSession, org_id: uuid.UUID, section_id: uuid.UUID) -> None:
    section = await storefront_repo.get_section_in_draft(db, org_id, section_id)
    if section is None:
        raise NotFoundError("Section not found in the current draft")
    await storefront_repo.delete_section(db, section)
    await db.commit()


async def update_theme(db: AsyncSession, org_id: uuid.UUID, tokens: dict) -> StorefrontVersion:
    draft = await get_or_create_draft(db, org_id)
    await storefront_repo.update_theme(db, draft.id, tokens)
    await db.commit()
    return await get_or_create_draft(db, org_id)


def _page_signature(page: StorePage) -> list[tuple[str, dict]]:
    return [(s.type, s.configuration) for s in sorted(page.sections, key=lambda s: s.order)]


def diff_versions(before: StorefrontVersion | None, after: StorefrontVersion) -> list[str]:
    """Structural comparison of two versions' section trees, computed on demand — publishing
    already snapshots draft→live as an immutable new version, so there's always a before/after
    pair to diff (ARCHITECTURE.md "Store Builder — change awareness"). No extra table: this reads
    two already-persisted versions, it doesn't store anything new."""

    if before is None:
        return ["Initial storefront published"]

    changes: list[str] = []
    before_pages = {p.slug: p for p in before.pages}
    after_pages = {p.slug: p for p in after.pages}

    for slug in after_pages.keys() - before_pages.keys():
        changes.append(f"Added page '{after_pages[slug].title}'")
    for slug in before_pages.keys() - after_pages.keys():
        changes.append(f"Removed page '{before_pages[slug].title}'")

    for slug in before_pages.keys() & after_pages.keys():
        before_sig = _page_signature(before_pages[slug])
        after_sig = _page_signature(after_pages[slug])
        before_types = [t for t, _ in before_sig]
        after_types = [t for t, _ in after_sig]
        if before_types != after_types:
            changes.append(f"Changed section layout on '{slug}': {before_types} → {after_types}")
        else:
            for (b_type, b_config), (a_type, a_config) in zip(before_sig, after_sig):
                if b_config != a_config:
                    changes.append(f"Updated '{b_type}' section content on '{slug}'")

    if before.theme.tokens != after.theme.tokens:
        changes.append("Updated theme")

    return changes or ["No changes since last publish"]


async def diff_draft_against_live(db: AsyncSession, org_id: uuid.UUID) -> list[str]:
    draft = await get_or_create_draft(db, org_id)
    live = await storefront_repo.get_live(db, org_id)
    return diff_versions(live, draft)
