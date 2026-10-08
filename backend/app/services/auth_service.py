import re
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.security import (
    create_access_token,
    generate_refresh_token,
    hash_password,
    hash_refresh_token,
    verify_password,
)
from app.db.base import utcnow
from app.db.models import Organization, Store, User, UserRole
from app.errors import ConflictError, ForbiddenError, NotFoundError
from app.repositories import storefront_repo, user_repo

settings = get_settings()


@dataclass(frozen=True)
class LoginResult:
    access_token: str
    refresh_token: str
    expires_in: int
    user: User


def _slugify_org_name(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "store"


async def _unique_org_slug(db: AsyncSession, base_slug: str) -> str:
    slug = base_slug
    suffix = 1
    while await storefront_repo.get_org_by_slug(db, slug) is not None:
        suffix += 1
        slug = f"{base_slug}-{suffix}"
    return slug


async def signup(db: AsyncSession, *, org_name: str, email: str, password: str, full_name: str) -> LoginResult:
    """Creates the Organization/Store/User an owner needs to land somewhere real immediately after
    signup (ARCHITECTURE.md "Post-signup routing" — never an empty dashboard). Mirrors the
    Organization/User/Store shape `scripts/seed.py` builds for VELORA; this is the only other place
    those rows are constructed, so it stays a direct model construction rather than a repo layer
    built for a single caller."""

    if await user_repo.get_user_by_email(db, email) is not None:
        raise ConflictError("An account with this email already exists", details={"code": "email_taken"})

    slug = await _unique_org_slug(db, _slugify_org_name(org_name))
    org = Organization(name=org_name, slug=slug)
    db.add(org)
    await db.flush()

    db.add(Store(org_id=org.id, name=org_name, currency="USD"))
    user = User(
        org_id=org.id, email=email, password_hash=hash_password(password), full_name=full_name, role=UserRole.owner,
    )
    db.add(user)
    await db.flush()

    access_token = create_access_token(user_id=user.id, org_id=org.id, role=user.role.value)
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


async def _issue_tokens_for(db: AsyncSession, user: User) -> LoginResult:
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


async def _existing_demo_session_user(db: AsyncSession, raw_refresh_token: str | None) -> User | None:
    """Resolves an incoming demo-login request's existing refresh cookie (if any) back to a user,
    but ONLY if that user's own org is a real demo org (`Organization.is_demo` — a DB-level flag,
    never inferred from slug/email string-matching, which a real signup's chosen name could
    coincidentally collide with). This is the guard that keeps `enter_demo` from ever resuming,
    overwriting, or otherwise touching a genuinely authenticated real user's session — if the
    cookie belongs to a real account, this returns None exactly as if there were no cookie at
    all, and a brand-new isolated demo workspace gets created instead."""
    if not raw_refresh_token:
        return None
    token = await user_repo.get_refresh_token_by_hash(db, hash_refresh_token(raw_refresh_token))
    if token is None or token.revoked_at is not None or token.expires_at <= utcnow():
        return None
    result = await db.execute(
        select(User).join(Organization, User.org_id == Organization.id).where(
            User.id == token.user_id, Organization.is_demo.is_(True)
        )
    )
    user = result.scalar_one_or_none()
    if user is None or not user.is_active or user.deleted_at is not None:
        return None
    # Rotate the presented token now that we're resuming on it — same reuse protection refresh()
    # gives every other session.
    await user_repo.revoke_refresh_token(db, token, revoked_at=utcnow())
    return user


async def enter_demo(db: AsyncSession, raw_refresh_token: str | None = None) -> LoginResult:
    """The one-click, no-signup/no-signin public demo entry. Isolated per visitor
    (demo_service.create_isolated_demo_workspace: a brand-new, uniquely-slugged/emailed org seeded
    with VELORA's rich business history — real products, collections, customers and orders) —
    never a single shared identity that one visitor's login could wipe out from under another.

    If the request's own refresh cookie already identifies a still-valid demo session
    (`_existing_demo_session_user` above), this RESUMES that exact workspace instead of creating
    a new one — issuing a fresh token pair for the same user, no reseed, no lost progress. That is
    what lets a returning visitor refresh or come back later without being forced to replay the
    whole tour from scratch. Onboarding itself starts genuinely incomplete for a brand-new
    workspace, same as a fresh signup, so every first-time visitor gets NOVA's real Guide
    tutorial — demonstrating each step with VELORA's own data and waiting for the visitor to press
    the real button — rather than landing in an already-finished store with nothing left to do."""

    from app.services import demo_service

    existing_user = await _existing_demo_session_user(db, raw_refresh_token)
    if existing_user is not None:
        return await _issue_tokens_for(db, existing_user)

    summary = await demo_service.create_isolated_demo_workspace()
    user = await user_repo.get_user_by_email(db, summary["login_email"])
    assert user is not None  # create_isolated_demo_workspace() just created this exact user
    return await _issue_tokens_for(db, user)


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
