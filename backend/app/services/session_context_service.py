"""What the merchant is doing right now, as short factual lines for the chat model. Built from rows NOVA already records (audit
log, proposals, store-creation state, storefront diff); no extra model call. It is evidence for the assistant, never instructions,
and everything is scoped to the caller's org."""

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import ProposalStatus
from app.repositories import ai_repo, proposal_repo, store_creation_repo
from app.services import storefront_service

_RECENT_WINDOW = timedelta(minutes=30)
_MAX_ACTIONS = 8
# Client-reported focus: only these keys, short strings, so a page can't smuggle free-form text into the prompt.
_FOCUS_KEYS = ("product", "section", "step")


def _clean_focus(focus: dict | None) -> dict[str, str]:
    if not isinstance(focus, dict):
        return {}
    return {k: str(focus[k])[:80] for k in _FOCUS_KEYS if focus.get(k)}


def _describe(row) -> str:
    who = "AI" if row.actor_type.value == "ai" else "the merchant" if row.actor_type.value == "user" else "system"
    return f"{who}: {row.action.replace('_', ' ')} ({row.entity_type})"


async def build(db: AsyncSession, org_id: uuid.UUID, *, focus: dict | None = None) -> dict:
    session: dict = {}
    cleaned = _clean_focus(focus)
    if cleaned:
        session["focus"] = cleaned

    cutoff = datetime.now(timezone.utc) - _RECENT_WINDOW
    rows = [r for r in await ai_repo.list_recent_audit_logs(db, org_id, limit=_MAX_ACTIONS * 2) if r.created_at >= cutoff]
    if rows:
        session["recent_actions"] = [_describe(r) for r in rows[:_MAX_ACTIONS]]

    in_progress: list[str] = []
    creation = await store_creation_repo.get_current_session(db, org_id)
    if creation is not None:
        in_progress.append(f"Create My Store is unfinished (step: {creation.current_step or creation.status.value})")
    pending = await proposal_repo.list_by_org(db, org_id, status=ProposalStatus.proposed, limit=20)
    if pending:
        in_progress.append(f"{len(pending)} proposal(s) awaiting approval")
    diff = await storefront_service.diff_draft_against_live(db, org_id)
    if diff != ["No changes since last publish"]:
        in_progress.append(f"storefront draft has {len(diff)} unpublished change(s)")
    if in_progress:
        session["in_progress"] = in_progress
    return session
