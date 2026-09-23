import asyncio

from app.db.session import AsyncSessionLocal
from app.services import storefront_service


async def test_concurrent_get_or_create_draft_yields_single_draft(seeded_owner):
    """Regression test for the race where the admin UI's simultaneous /storefront/draft and
    /storefront/diff requests on page load both saw "no draft exists" and both tried to create
    one, crashing later reads with MultipleResultsFound. Fixed by a partial unique index
    (org_id WHERE status='draft') plus a race-safe fallback in get_or_create_draft."""

    org_id = seeded_owner["org_id"]

    async def _create_via_own_session():
        async with AsyncSessionLocal() as db:
            draft = await storefront_service.get_or_create_draft(db, org_id)
            return draft.id

    results = await asyncio.gather(_create_via_own_session(), _create_via_own_session(), _create_via_own_session())

    assert len(set(results)) == 1  # all three calls resolved to the SAME draft, not three different ones

    async with AsyncSessionLocal() as db:
        # get_draft itself must not raise MultipleResultsFound.
        final_draft = await storefront_service.get_or_create_draft(db, org_id)
        assert final_draft.id == results[0]
