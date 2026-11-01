import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.security import hash_password
from app.db.models import Organization, User, UserRole
from app.db.session import AsyncSessionLocal, engine
from app.main import app


@pytest.fixture(autouse=True)
def _deterministic_ai(monkeypatch):
    """backend/.env selects the real provider for local use; tests must never read it and spend real NVIDIA quota. Tests that
    exercise a real provider set ai_provider/keys themselves (with the SDK stubbed)."""
    from app.config import get_settings

    s = get_settings()
    monkeypatch.setattr(s, "ai_provider", "fake")
    monkeypatch.setattr(s, "image_provider", "fake")
    monkeypatch.setattr(s, "studio_provider", "fake")  # Photo Studio must never reach Cloudflare from the test suite
    monkeypatch.setattr(s, "cloudflare_api_token", None)
    monkeypatch.setattr(s, "cloudflare_account_id", None)
    # Model choice is per-deployment (backend/.env): tests assert the code's documented defaults, never a developer's local override.
    for name in ("nvidia_model", "nvidia_chat_template_kwargs"):
        monkeypatch.setattr(s, name, type(s).model_fields[name].default)
    for name in ("nvidia_api_key", "nvidia_chat_api_key", "nvidia_chat_model", "nvidia_chat_base_url", "openai_api_key"):
        monkeypatch.setattr(s, name, None)


@pytest.fixture(autouse=True)
async def _clean_db():
    # Simple truncate-between-tests strategy — fine at this table count; revisit if it gets slow.
    yield
    async with engine.begin() as conn:
        await conn.execute(text("TRUNCATE refresh_tokens, users, brand_profiles, stores, organizations CASCADE"))


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.fixture
async def seeded_owner():
    async with AsyncSessionLocal() as db:
        org_slug = f"test-org-{uuid.uuid4().hex[:8]}"
        org = Organization(name="Test Org", slug=org_slug)
        db.add(org)
        await db.flush()
        user = User(
            org_id=org.id,
            email=f"owner-{uuid.uuid4().hex[:8]}@test.demo",
            password_hash=hash_password("changeme123"),
            full_name="Test Owner",
            role=UserRole.owner,
        )
        db.add(user)
        await db.commit()
        return {
            "org_id": org.id, "org_slug": org_slug, "user_id": user.id, "email": user.email, "password": "changeme123",
        }
