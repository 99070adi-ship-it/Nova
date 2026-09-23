async def test_login_success(client, seeded_owner):
    res = await client.post(
        "/api/v1/auth/login", json={"email": seeded_owner["email"], "password": seeded_owner["password"]}
    )
    assert res.status_code == 200
    body = res.json()
    assert body["access_token"]
    assert body["expires_in"] > 0
    assert "refresh_token" in res.cookies


async def test_login_wrong_password(client, seeded_owner):
    res = await client.post("/api/v1/auth/login", json={"email": seeded_owner["email"], "password": "wrong"})
    assert res.status_code == 403
    assert res.json()["error"]["details"]["code"] == "invalid_credentials"


async def test_login_unknown_email(client):
    res = await client.post("/api/v1/auth/login", json={"email": "nobody@test.demo", "password": "whatever"})
    assert res.status_code == 403


async def test_me_requires_token(client):
    res = await client.get("/api/v1/auth/me")
    assert res.status_code == 401


async def test_full_auth_flow(client, seeded_owner):
    login_res = await client.post(
        "/api/v1/auth/login", json={"email": seeded_owner["email"], "password": seeded_owner["password"]}
    )
    access_token = login_res.json()["access_token"]
    first_refresh_cookie = login_res.cookies["refresh_token"]

    me_res = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {access_token}"})
    assert me_res.status_code == 200
    assert me_res.json()["email"] == seeded_owner["email"]
    assert me_res.json()["role"] == "owner"

    refresh_res = await client.post("/api/v1/auth/refresh")
    assert refresh_res.status_code == 200
    second_refresh_cookie = refresh_res.cookies["refresh_token"]
    # Rotation: the cookie value changes on every refresh, and the old one no longer works.
    assert second_refresh_cookie != first_refresh_cookie

    # A present-but-revoked/stale cookie is a 403 (invalid_refresh_token), distinct from the 401
    # routes_auth.py raises when no cookie is sent at all.
    client.cookies.set("refresh_token", first_refresh_cookie)
    stale_refresh_res = await client.post("/api/v1/auth/refresh")
    assert stale_refresh_res.status_code == 403

    client.cookies.set("refresh_token", second_refresh_cookie)
    logout_res = await client.post("/api/v1/auth/logout")
    assert logout_res.status_code == 204

    # Refresh after logout must fail — the cookie was revoked.
    post_logout_refresh = await client.post("/api/v1/auth/refresh")
    assert post_logout_refresh.status_code == 403
