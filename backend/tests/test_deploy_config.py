import pytest

from app.config import get_settings
from app.main import app


async def test_non_local_environment_refuses_the_public_dev_jwt_secret(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "env", "production")
    monkeypatch.setattr(s, "jwt_secret", "dev-secret-change-me-please-32-bytes-minimum")
    with pytest.raises(RuntimeError, match="JWT_SECRET"):
        async with app.router.lifespan_context(app):
            pass


async def test_non_local_environment_starts_with_a_real_secret(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "env", "production")
    monkeypatch.setattr(s, "jwt_secret", "a-unique-random-secret-of-sufficient-length-1234567890")
    async with app.router.lifespan_context(app):
        pass


async def test_refresh_cookie_samesite_follows_configuration(client, seeded_owner, monkeypatch):
    creds = {"email": seeded_owner["email"], "password": seeded_owner["password"]}
    strict = await client.post("/api/v1/auth/login", json=creds)
    assert "samesite=strict" in strict.headers["set-cookie"].lower()
    monkeypatch.setattr(get_settings(), "cookie_samesite", "none")
    cross = await client.post("/api/v1/auth/login", json=creds)
    assert "samesite=none" in cross.headers["set-cookie"].lower()
