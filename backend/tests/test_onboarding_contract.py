"""The onboarding sequence is owned by the backend (`onboarding_service.STEP_DEFINITIONS`). These
tests pin the properties that keep that true: the committed cross-app contract matches the server,
the sequence is well-formed, and every step has a real, distinct completion rule. The admin app has
the other half (every server step must have a lesson)."""

import json
from pathlib import Path

from app.schemas.onboarding import OnboardingStepKey
from app.services import onboarding_service as svc
from app.services.onboarding_service import STEP_DEFINITIONS, _Facts
from app.db.models import ProductDraftStatus

CONTRACT_PATH = Path(__file__).resolve().parents[2] / "contracts" / "onboarding-steps.json"

EMPTY = _Facts(
    has_brand=False, draft_statuses=[], has_collection=False, storefront_draft_generated=False,
    storefront_draft_previewed=False, storefront_draft_created_at=None, owner_publish_at=None,
    has_applied_change_plan=False, has_store_health_run=False, has_action_plan=False,
)


def _with(**kw) -> _Facts:
    return _Facts(**{**EMPTY.__dict__, **kw})


# For each step, the smallest set of persisted facts that satisfies exactly that step's rule.
COMPLETING_FACTS = {
    OnboardingStepKey.brand: _with(has_brand=True),
    OnboardingStepKey.products: _with(draft_statuses=[ProductDraftStatus.pending_generation]),
    OnboardingStepKey.catalog: _with(draft_statuses=[ProductDraftStatus.generated]),
    OnboardingStepKey.review: _with(draft_statuses=[ProductDraftStatus.accepted, ProductDraftStatus.rejected]),
    OnboardingStepKey.collections: _with(has_collection=True),
    OnboardingStepKey.storefront: _with(storefront_draft_generated=True),
    OnboardingStepKey.preview: _with(storefront_draft_generated=True, storefront_draft_previewed=True),
    OnboardingStepKey.nl_edit: _with(has_applied_change_plan=True),
    OnboardingStepKey.publish: _with(
        storefront_draft_generated=True, storefront_draft_created_at=1, owner_publish_at=2,
    ),
    OnboardingStepKey.run_business: _with(has_store_health_run=True, has_action_plan=True),
}


def test_committed_contract_matches_the_backend_definition():
    committed = json.loads(CONTRACT_PATH.read_text())
    assert committed == svc.contract_snapshot(), (
        "contracts/onboarding-steps.json is stale. Run: cd backend && python scripts/export_onboarding_contract.py"
    )


def test_every_enum_key_is_defined_exactly_once_in_order():
    keys = [d.key for d in STEP_DEFINITIONS]
    assert len(keys) == len(set(keys))
    assert set(keys) == set(OnboardingStepKey)
    assert keys == list(OnboardingStepKey), "STEP_DEFINITIONS order must follow the OnboardingStepKey enum order"


def test_every_step_has_a_title_and_a_distinct_plain_language_rule():
    titles = [d.title for d in STEP_DEFINITIONS]
    rules = [d.completion_rule for d in STEP_DEFINITIONS]
    assert all(t.strip() for t in titles) and len(set(titles)) == len(titles)
    assert all(r.strip().endswith(".") for r in rules) and len(set(rules)) == len(rules)


def test_no_step_is_complete_on_an_empty_organization():
    for d in STEP_DEFINITIONS:
        assert d.is_complete(EMPTY) is False, f"{d.key} must not be complete with no persisted state"


# Rules that legitimately imply an earlier one (e.g. a reviewed draft necessarily exists).
IMPLIED_BY = {
    OnboardingStepKey.products: {OnboardingStepKey.catalog, OnboardingStepKey.review},
    OnboardingStepKey.catalog: {OnboardingStepKey.review},
    OnboardingStepKey.storefront: {OnboardingStepKey.preview, OnboardingStepKey.publish},
}


def test_each_step_completes_only_from_its_own_facts():
    assert set(COMPLETING_FACTS) == set(OnboardingStepKey), "add completing facts for every new step"
    for d in STEP_DEFINITIONS:
        assert d.is_complete(COMPLETING_FACTS[d.key]) is True, f"{d.key} should complete from its own facts"
        for other_key, facts in COMPLETING_FACTS.items():
            if other_key == d.key or other_key in IMPLIED_BY.get(d.key, set()):
                continue
            assert d.is_complete(facts) is False, f"{d.key} was wrongly completed by {other_key}'s facts"


def test_preview_requires_the_recorded_event_not_just_a_generated_draft():
    d = next(x for x in STEP_DEFINITIONS if x.key == OnboardingStepKey.preview)
    assert d.is_complete(_with(storefront_draft_generated=True)) is False
    assert d.is_complete(_with(storefront_draft_previewed=True)) is False  # a preview of a non-generated draft doesn't count


def test_publish_ignores_publishes_older_than_the_generated_draft():
    d = next(x for x in STEP_DEFINITIONS if x.key == OnboardingStepKey.publish)
    assert d.is_complete(_with(storefront_draft_generated=True, storefront_draft_created_at=5, owner_publish_at=4)) is False
    assert d.is_complete(_with(storefront_draft_generated=False, storefront_draft_created_at=None, owner_publish_at=9)) is False
