"""Storefront generation — takes BrandProfile + accepted products/collections + vibe and produces
a StorefrontVersion draft (ARCHITECTURE.md "Storefront generation workflow"). Invoked by Create My
Store step 4, and standalone later ("regenerate storefront"). Produces only the same structured
StorePage/StoreSection/StoreTheme rows a human editing through Store Builder would produce — no
separate renderer for AI-generated stores."""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import GeneratedBy, StorefrontVersion, StorefrontVersionStatus
from app.errors import ValidationDomainError
from app.repositories import store_creation_repo, storefront_repo
from app.services.storefront_service import DEFAULT_THEME_TOKENS

# A restrained, "premium/minimal" palette used when the brand didn't specify colors — distinct
# from the bare default so a generated store visibly reflects having gone through generation.
_GENERATED_THEME_TOKENS = {**DEFAULT_THEME_TOKENS, "primary_color": "#1c1917", "border_radius": "4px"}


def _build_pages(brand) -> list[dict]:
    sections = [
        {
            "type": "hero",
            "order": 0,
            "configuration": {
                "headline": brand.name,
                "subheadline": brand.vibe_text or brand.positioning or "Shop the collection",
                "cta_text": "Shop now",
                "cta_href": "/shop",
            },
        },
    ]

    story_body = brand.description or brand.positioning
    if story_body:
        sections.append(
            {
                "type": "brand_story",
                "order": 1,
                "configuration": {"heading": "Our story", "body": story_body},
            }
        )

    sections.append(
        {
            "type": "product_grid",
            "order": len(sections),
            "configuration": {"title": "Shop all", "collection_id": None, "limit": 12},
        }
    )

    return [{"slug": "home", "title": "Home", "order": 0, "sections": sections}]


def _theme_from_brand(brand) -> dict:
    tokens = dict(_GENERATED_THEME_TOKENS)
    colors = brand.preferred_colors or []
    if colors:
        tokens["primary_color"] = colors[0]
    if brand.typography_preference:
        tokens["font_family"] = brand.typography_preference
    return tokens


async def generate(db: AsyncSession, org_id: uuid.UUID) -> StorefrontVersion:
    brand = await store_creation_repo.get_brand_profile(db, org_id)
    if brand is None:
        raise ValidationDomainError("Brand profile required before generating a storefront — complete brand input first")

    await storefront_repo.delete_draft(db, org_id)
    draft = await storefront_repo.create_version(
        db, org_id, status=StorefrontVersionStatus.draft, generated_by=GeneratedBy.ai,
        pages=_build_pages(brand), theme_tokens=_theme_from_brand(brand),
    )
    await db.commit()
    return draft
