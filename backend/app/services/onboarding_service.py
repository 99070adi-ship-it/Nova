"""Onboarding progress derivation (ARCHITECTURE.md "Onboarding — the NOVA Guide"). Deliberately has
no parallel state-machine table for step completion — each step's status is computed from the real
rows the rest of NOVA already produces (BrandProfile, ProductDraft, Collection, StorefrontVersion,
AIAgentRun, AgentActionPlan), so it can never drift from what the store actually contains and
survives a page refresh for free. The only persisted onboarding-specific state is the one-shot
intro-video-seen flag on User, which has no natural backing data of its own."""

import uuid
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import ProductDraftStatus, User
from app.repositories import ai_repo, collection_repo, storefront_repo, store_creation_repo, user_repo
from app.schemas.onboarding import OnboardingProgressOut, OnboardingStepKey, OnboardingStepOut, OnboardingStepStatus

_STEP_TITLES: dict[OnboardingStepKey, str] = {
    OnboardingStepKey.brand: "Tell NOVA about your business",
    OnboardingStepKey.products: "Add your products",
    OnboardingStepKey.catalog: "NOVA builds your catalog",
    OnboardingStepKey.review: "Review AI-generated content",
    OnboardingStepKey.collections: "Organize into collections",
    OnboardingStepKey.storefront: "Build your storefront",
    OnboardingStepKey.preview: "Preview your storefront",
    OnboardingStepKey.nl_edit: "Ask NOVA to improve it",
    OnboardingStepKey.publish: "Publish your store",
    OnboardingStepKey.run_business: "Learn how NOVA runs your business",
}

_STEP_ORDER: list[OnboardingStepKey] = list(_STEP_TITLES.keys())

_RESOLVED_DRAFT_STATUSES = (ProductDraftStatus.generated, ProductDraftStatus.accepted, ProductDraftStatus.rejected)
_FINAL_DRAFT_STATUSES = (ProductDraftStatus.accepted, ProductDraftStatus.rejected)


async def _step_completions(db: AsyncSession, org_id: uuid.UUID) -> dict[OnboardingStepKey, bool]:
    brand = await store_creation_repo.get_brand_profile(db, org_id)
    drafts = await store_creation_repo.list_product_drafts_by_org(db, org_id)
    collections = await collection_repo.list_collections(db, org_id)
    storefront_draft = await storefront_repo.get_draft(db, org_id)
    storefront_live = await storefront_repo.get_live(db, org_id)
    has_change_plan = await ai_repo.has_completed_agent_run(
        db, org_id, agent_key="storefront_agent", trigger="propose_change_plan"
    )
    has_store_health_run = await ai_repo.has_completed_agent_run(db, org_id, agent_key="store_manager", trigger="store_health")
    has_action_plan = await ai_repo.has_action_plan(db, org_id)

    catalog_done = any(d.status in _RESOLVED_DRAFT_STATUSES for d in drafts)
    review_done = len(drafts) > 0 and all(d.status in _FINAL_DRAFT_STATUSES for d in drafts)

    return {
        OnboardingStepKey.brand: brand is not None,
        OnboardingStepKey.products: len(drafts) > 0,
        OnboardingStepKey.catalog: catalog_done,
        OnboardingStepKey.review: review_done,
        OnboardingStepKey.collections: len(collections) > 0,
        OnboardingStepKey.storefront: storefront_draft is not None,
        # No state of its own — previewing is just viewing the draft step 6 already produced.
        OnboardingStepKey.preview: storefront_draft is not None,
        OnboardingStepKey.nl_edit: has_change_plan,
        OnboardingStepKey.publish: storefront_live is not None,
        OnboardingStepKey.run_business: has_store_health_run and has_action_plan,
    }


async def get_step_statuses(db: AsyncSession, org_id: uuid.UUID) -> tuple[list[OnboardingStepOut], OnboardingStepKey | None]:
    """Split out from `get_progress` so the `get_onboarding_progress` tool (app/ai/tools.py) can
    call this directly — it has no `User` in scope, only `org_id`, and doesn't need the
    intro-video flag anyway (that's a UI concern, not something the Guide narrates)."""

    completions = await _step_completions(db, org_id)

    steps: list[OnboardingStepOut] = []
    current_step: OnboardingStepKey | None = None
    first_incomplete_seen = False
    for key in _STEP_ORDER:
        if completions[key]:
            status = OnboardingStepStatus.completed
        elif not first_incomplete_seen:
            status = OnboardingStepStatus.available
            current_step = key
            first_incomplete_seen = True
        else:
            status = OnboardingStepStatus.locked
        steps.append(OnboardingStepOut(key=key, title=_STEP_TITLES[key], status=status))

    return steps, current_step


async def get_progress(db: AsyncSession, org_id: uuid.UUID, user: User) -> OnboardingProgressOut:
    steps, current_step = await get_step_statuses(db, org_id)
    return OnboardingProgressOut(
        steps=steps, current_step=current_step, intro_video_seen=user.onboarding_intro_seen_at is not None
    )


async def mark_intro_video_seen(db: AsyncSession, user: User) -> None:
    await user_repo.mark_intro_video_seen(db, user, seen_at=datetime.now(timezone.utc))
    await db.commit()
