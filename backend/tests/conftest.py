import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.security import hash_password
from app.db.models import Organization, User, UserRole
from app.db.session import AsyncSessionLocal, engine
from app.main import app


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
        org = Organization(name="Test Org", slug=f"test-org-{uuid.uuid4().hex[:8]}")
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
        return {"org_id": org.id, "user_id": user.id, "email": user.email, "password": "changeme123"}
