from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.security import (
    create_access_token,
    generate_refresh_token,
    hash_refresh_token,
    verify_password,
)
from app.db.base import utcnow
from app.db.models import User
from app.errors import ForbiddenError, NotFoundError
from app.repositories import user_repo

settings = get_settings()


@dataclass(frozen=True)
class LoginResult:
    access_token: str
    refresh_token: str
    expires_in: int
    user: User


async def login(db: AsyncSession, *, email: str, password: str) -> LoginResult:
    user = await user_repo.get_user_by_email(db, email)
    if user is None or not user.is_active or user.deleted_at is not None:
        raise ForbiddenError("Invalid email or password", details={"code": "invalid_credentials"})
    if not verify_password(password, user.password_hash):
        raise ForbiddenError("Invalid email or password", details={"code": "invalid_credentials"})

    access_token = create_access_token(user_id=user.id, org_id=user.org_id, role=user.role.value)
    raw_refresh = generate_refresh_token()
    await user_repo.create_refresh_token(
        db,
        user_id=user.id,
        token_hash=hash_refresh_token(raw_refresh),
        expires_at=utcnow() + timedelta(days=settings.refresh_token_ttl_days),
    )
    await db.commit()
    return LoginResult(
        access_token=access_token,
        refresh_token=raw_refresh,
        expires_in=settings.access_token_ttl_minutes * 60,
        user=user,
    )


async def refresh(db: AsyncSession, *, raw_refresh_token: str) -> LoginResult:
    token_hash = hash_refresh_token(raw_refresh_token)
    token = await user_repo.get_refresh_token_by_hash(db, token_hash)
    if token is None or token.revoked_at is not None or token.expires_at <= utcnow():
        raise ForbiddenError("Invalid or expired refresh token", details={"code": "invalid_refresh_token"})

    # org_id isn't known yet at this point (that's what we're re-deriving) — fetch by user id alone,
    # same as get_current_context does from the access token.
    result = await db.execute(select(User).where(User.id == token.user_id))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active or user.deleted_at is not None:
        raise NotFoundError("User no longer active")

    # Rotate: revoke the presented token, issue a new one — a stolen-then-reused refresh token
    # only works once.
    await user_repo.revoke_refresh_token(db, token, revoked_at=utcnow())
    access_token = create_access_token(user_id=user.id, org_id=user.org_id, role=user.role.value)
    raw_refresh = generate_refresh_token()
    await user_repo.create_refresh_token(
        db,
        user_id=user.id,
        token_hash=hash_refresh_token(raw_refresh),
        expires_at=utcnow() + timedelta(days=settings.refresh_token_ttl_days),
    )
    await db.commit()
    return LoginResult(
        access_token=access_token,
        refresh_token=raw_refresh,
        expires_in=settings.access_token_ttl_minutes * 60,
        user=user,
    )


async def logout(db: AsyncSession, *, raw_refresh_token: str | None) -> None:
    if not raw_refresh_token:
        return
    token = await user_repo.get_refresh_token_by_hash(db, hash_refresh_token(raw_refresh_token))
    if token is not None and token.revoked_at is None:
        await user_repo.revoke_refresh_token(db, token, revoked_at=utcnow())
        await db.commit()
