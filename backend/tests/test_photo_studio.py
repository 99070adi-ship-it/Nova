import io
import uuid

import pytest
from PIL import Image
from sqlalchemy import select

from app.ai.studio_provider import StudioProviderError
from app.config import get_settings
from app.core.security import hash_password
from app.db.models import Organization, StudioImage, User, UserRole
from app.db.session import AsyncSessionLocal
from app.services import photo_studio_service


async def _login(client, owner) -> dict:
    r = await client.post("/api/v1/auth/login", json={"email": owner["email"], "password": owner["password"]})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _second_owner() -> dict:
    async with AsyncSessionLocal() as db:
        org = Organization(name="Other Org", slug=f"other-{uuid.uuid4().hex[:8]}")
        db.add(org)
        await db.flush()
        email = f"other-{uuid.uuid4().hex[:8]}@test.demo"
        db.add(User(org_id=org.id, email=email, password_hash=hash_password("changeme123"), full_name="Other", role=UserRole.owner))
        await db.commit()
        return {"email": email, "password": "changeme123"}


def _png(size=(120, 80), color=(200, 60, 60), fmt="PNG") -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, fmt)
    return buf.getvalue()


@pytest.fixture(autouse=True)
def _reset_burst():
    photo_studio_service._burst.clear()


async def test_requires_authentication(client):
    assert (await client.get("/api/v1/photo-studio/status")).status_code == 401
    assert (await client.post("/api/v1/photo-studio/generate", json={"prompt": "a lamp"})).status_code == 401


async def test_status_is_honest_about_what_is_available(client, seeded_owner):
    h = await _login(client, seeded_owner)
    body = (await client.get("/api/v1/photo-studio/status", headers=h)).json()
    assert body["configured"] is True and body["generate"]["available"] and body["edit"]["available"]
    assert body["enhance"]["available"] is False and "Coming soon" in body["enhance"]["note"]
    assert body["daily_limit"] == get_settings().studio_daily_limit


async def test_generate_stores_history_and_serves_bytes_and_download(client, seeded_owner):
    h = await _login(client, seeded_owner)
    r = await client.post("/api/v1/photo-studio/generate", json={"prompt": "a ceramic mug on a table", "style": "studio", "count": 2}, headers=h)
    assert r.status_code == 200, r.text
    imgs = r.json()["images"]
    assert len(imgs) == 2 and r.json()["failed"] == 0
    hist = (await client.get("/api/v1/photo-studio/history", headers=h)).json()
    assert {i["id"] for i in hist} == {i["id"] for i in imgs}
    raw = await client.get(f"/api/v1/photo-studio/images/{imgs[0]['id']}", headers=h)
    assert raw.status_code == 200 and raw.content[:8] == b"\x89PNG\r\n\x1a\n" and raw.headers["x-content-type-options"] == "nosniff"
    dl = await client.get(f"/api/v1/photo-studio/images/{imgs[0]['id']}?download=true", headers=h)
    assert dl.headers["content-disposition"].startswith("attachment")
    assert (await client.get("/api/v1/photo-studio/status", headers=h)).json()["used_today"] == 2


@pytest.mark.parametrize("payload", [{"prompt": "  "}, {"prompt": "hi"}, {"prompt": "x" * 501}, {"prompt": "a lamp", "style": "nope"}, {"prompt": "a lamp", "count": 9}])
async def test_invalid_generate_requests_are_rejected(client, seeded_owner, payload):
    h = await _login(client, seeded_owner)
    assert (await client.post("/api/v1/photo-studio/generate", json=payload, headers=h)).status_code == 422


async def test_daily_limit_blocks_before_calling_the_provider(client, seeded_owner, monkeypatch):
    monkeypatch.setattr(get_settings(), "studio_daily_limit", 2)
    h = await _login(client, seeded_owner)
    assert (await client.post("/api/v1/photo-studio/generate", json={"prompt": "a lamp", "count": 2}, headers=h)).status_code == 200
    r = await client.post("/api/v1/photo-studio/generate", json={"prompt": "another lamp"}, headers=h)
    assert r.status_code == 429 and "daily limit" in r.json()["error"]["message"]


async def test_burst_limit(client, seeded_owner, monkeypatch):
    monkeypatch.setattr(get_settings(), "studio_burst_per_minute", 2)
    h = await _login(client, seeded_owner)
    codes = [(await client.post("/api/v1/photo-studio/generate", json={"prompt": "a lamp"}, headers=h)).status_code for _ in range(3)]
    assert codes == [200, 200, 429]


async def test_demo_workspace_cannot_use_the_provider(client, seeded_owner):
    async with AsyncSessionLocal() as db:
        org = await db.get(Organization, seeded_owner["org_id"])
        org.is_demo = True
        await db.commit()
    h = await _login(client, seeded_owner)
    status = (await client.get("/api/v1/photo-studio/status", headers=h)).json()
    assert status["demo_workspace"] is True and status["generate"]["available"] is False
    assert (await client.post("/api/v1/photo-studio/generate", json={"prompt": "a lamp"}, headers=h)).status_code == 403
    files = {"image": ("a.png", _png(), "image/png")}
    assert (await client.post("/api/v1/photo-studio/edit", data={"prompt": "make it blue"}, files=files, headers=h)).status_code == 403


async def test_unconfigured_server_says_so_instead_of_faking(client, seeded_owner, monkeypatch):
    monkeypatch.setattr(get_settings(), "studio_provider", "cloudflare")
    h = await _login(client, seeded_owner)
    assert (await client.get("/api/v1/photo-studio/status", headers=h)).json()["configured"] is False
    r = await client.post("/api/v1/photo-studio/generate", json={"prompt": "a lamp"}, headers=h)
    assert r.status_code == 503


async def test_the_fake_provider_is_refused_outside_local(client, seeded_owner, monkeypatch):
    monkeypatch.setattr(get_settings(), "env", "production")
    h = await _login(client, seeded_owner)
    assert (await client.post("/api/v1/photo-studio/generate", json={"prompt": "a lamp"}, headers=h)).status_code == 503


class _Failing:
    async def generate(self, prompt):
        raise StudioProviderError("The image service took too long to respond. Please try again.", kind="timeout")

    async def edit(self, prompt, image, width, height):
        raise StudioProviderError("The image service's safety filter blocked this request.", kind="flagged")


async def test_provider_failure_records_and_counts_nothing(client, seeded_owner, monkeypatch):
    monkeypatch.setattr(photo_studio_service, "build_studio_provider", lambda: _Failing())
    h = await _login(client, seeded_owner)
    r = await client.post("/api/v1/photo-studio/generate", json={"prompt": "a lamp"}, headers=h)
    assert r.status_code == 503 and "took too long" in r.json()["error"]["message"]
    files = {"image": ("a.png", _png(), "image/png")}
    r = await client.post("/api/v1/photo-studio/edit", data={"prompt": "make it blue"}, files=files, headers=h)
    assert r.status_code == 503 and "safety filter" in r.json()["error"]["message"]
    assert (await client.get("/api/v1/photo-studio/history", headers=h)).json() == []
    assert (await client.get("/api/v1/photo-studio/status", headers=h)).json()["used_today"] == 0
    async with AsyncSessionLocal() as db:
        assert (await db.execute(select(StudioImage))).scalars().all() == []


async def test_edit_keeps_the_original_and_returns_a_separate_result(client, seeded_owner):
    h = await _login(client, seeded_owner)
    files = {"image": ("product.png", _png(), "image/png")}
    r = await client.post("/api/v1/photo-studio/edit", data={"prompt": "Change the background to a studio"}, files=files, headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["original"]["kind"] == "upload" and body["edited"]["kind"] == "edited"
    assert body["edited"]["source_image_id"] == body["original"]["id"]
    orig = await client.get(f"/api/v1/photo-studio/images/{body['original']['id']}", headers=h)
    assert orig.content == _png()  # byte-for-byte the upload
    assert [i["kind"] for i in (await client.get("/api/v1/photo-studio/history", headers=h)).json()] == ["edited"]


async def test_edit_rejects_bad_uploads(client, seeded_owner, monkeypatch):
    h = await _login(client, seeded_owner)
    post = lambda name, data, ctype: client.post(  # noqa: E731
        "/api/v1/photo-studio/edit", data={"prompt": "make it blue"}, files={"image": (name, data, ctype)}, headers=h
    )
    assert (await post("notes.png", b"definitely not an image", "image/png")).status_code == 422  # lies about its type
    assert (await post("a.gif", _png(fmt="GIF"), "image/gif")).status_code == 422  # real image, unsupported format
    assert (await post("empty.png", b"", "image/png")).status_code == 422
    monkeypatch.setattr(get_settings(), "studio_max_upload_bytes", 100)
    assert (await post("big.png", _png(size=(300, 300)), "image/png")).status_code == 422
    r = await client.post("/api/v1/photo-studio/edit", data={"prompt": "hi"}, files={"image": ("a.png", _png(), "image/png")}, headers=h)
    assert r.status_code == 422


async def test_another_workspace_cannot_see_or_delete_my_images(client, seeded_owner):
    mine = await _login(client, seeded_owner)
    img = (await client.post("/api/v1/photo-studio/generate", json={"prompt": "a lamp"}, headers=mine)).json()["images"][0]
    theirs = await _login(client, await _second_owner())
    assert (await client.get(f"/api/v1/photo-studio/images/{img['id']}", headers=theirs)).status_code == 404
    assert (await client.delete(f"/api/v1/photo-studio/images/{img['id']}", headers=theirs)).status_code == 404
    assert (await client.get("/api/v1/photo-studio/history", headers=theirs)).json() == []
    assert (await client.get(f"/api/v1/photo-studio/images/{img['id']}", headers=mine)).status_code == 200


async def test_deleting_a_result_also_removes_its_orphaned_original(client, seeded_owner):
    h = await _login(client, seeded_owner)
    files = {"image": ("p.png", _png(), "image/png")}
    body = (await client.post("/api/v1/photo-studio/edit", data={"prompt": "make it blue"}, files=files, headers=h)).json()
    assert (await client.delete(f"/api/v1/photo-studio/images/{body['edited']['id']}", headers=h)).status_code == 204
    assert (await client.get(f"/api/v1/photo-studio/images/{body['original']['id']}", headers=h)).status_code == 404
