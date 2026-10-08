from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import AuthContext, get_current_context
from app.db.session import get_db
from app.repositories import user_repo
from app.schemas.onboarding import OnboardingProgressOut
from app.services import onboarding_service

router = APIRouter()


@router.get("/progress", response_model=OnboardingProgressOut)
async def get_progress(
    ctx: AuthContext = Depends(get_current_context), db: AsyncSession = Depends(get_db)
) -> OnboardingProgressOut:
    user = await user_repo.get_user_by_id(db, org_id=ctx.org_id, user_id=ctx.user_id)
    assert user is not None
    return await onboarding_service.get_progress(db, ctx.org_id, user)


@router.post("/intro-video-seen", response_model=OnboardingProgressOut)
async def mark_intro_video_seen(
    ctx: AuthContext = Depends(get_current_context), db: AsyncSession = Depends(get_db)
) -> OnboardingProgressOut:
    user = await user_repo.get_user_by_id(db, org_id=ctx.org_id, user_id=ctx.user_id)
    assert user is not None
    await onboarding_service.mark_intro_video_seen(db, user)
    return await onboarding_service.get_progress(db, ctx.org_id, user)
