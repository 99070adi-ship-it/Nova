import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import AuditActorType, AuditLog


async def write_audit_event(
    db: AsyncSession, *, org_id: uuid.UUID, actor_type: AuditActorType, actor_id: uuid.UUID | None,
    action: str, entity_type: str, entity_id: uuid.UUID, before: dict | None = None, after: dict | None = None,
) -> AuditLog:
    """Writes one audit_logs row. Callers add this to the SAME transaction as the mutation it
    describes (never a separate commit) so the two can never diverge."""

    event = AuditLog(
        org_id=org_id, actor_type=actor_type, actor_id=actor_id, action=action, entity_type=entity_type,
        entity_id=entity_id, before=before, after=after,
    )
    db.add(event)
    await db.flush()
    return event
