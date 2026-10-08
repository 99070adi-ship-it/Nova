"""Dev-only demo tooling (ARCHITECTURE.md Checkpoint 11). Every route here is gated to
`settings.env == "local"` and 404s otherwise — this must never be reachable in a deployed
environment, since it wipes the entire database. Unauthenticated deliberately: a demo reset can
leave no valid session behind (it deletes every user), so there's no auth context left to check
anyway; the env gate is the only guard, and it must stay that way."""

from fastapi import APIRouter

from app.config import get_settings
from app.errors import NotFoundError
from app.services import demo_service

router = APIRouter()
settings = get_settings()


@router.post("/demo-reset")
async def demo_reset() -> dict:
    if settings.env != "local":
        raise NotFoundError("Not found")
    return await demo_service.reset_demo()
