async def test_signup_creates_org_and_logs_in(client):
    res = await client.post(
        "/api/v1/auth/signup",
        json={"org_name": "Aurora Goods", "full_name": "Jamie Rivera", "email": "jamie@aurora.demo", "password": "changeme123"},
    )
    assert res.status_code == 201
    body = res.json()
    assert body["access_token"]
    assert "refresh_token" in res.cookies

    me_res = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert me_res.status_code == 200
    assert me_res.json()["email"] == "jamie@aurora.demo"
    assert me_res.json()["role"] == "owner"


async def test_signup_duplicate_email_conflict(client, seeded_owner):
    res = await client.post(
        "/api/v1/auth/signup",
        json={"org_name": "Another Store", "full_name": "Someone Else", "email": seeded_owner["email"], "password": "changeme123"},
    )
    assert res.status_code == 409
    assert res.json()["error"]["details"]["code"] == "email_taken"


async def test_signup_slug_collision_gets_suffixed(client):
    first = await client.post(
        "/api/v1/auth/signup",
        json={"org_name": "Slug Test", "full_name": "First Owner", "email": "first@slugtest.demo", "password": "changeme123"},
    )
    second = await client.post(
        "/api/v1/auth/signup",
        json={"org_name": "Slug Test", "full_name": "Second Owner", "email": "second@slugtest.demo", "password": "changeme123"},
    )
    assert first.status_code == 201
    assert second.status_code == 201


async def test_signup_password_too_short(client):
    res = await client.post(
        "/api/v1/auth/signup",
        json={"org_name": "Short PW", "full_name": "Someone", "email": "short@pw.demo", "password": "short"},
    )
    assert res.status_code == 422


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


async def test_demo_login_needs_no_signup_or_credentials_and_lands_in_the_real_tutorial(client):
    # One click, no form, straight into a real token for the shared demo identity — landing in a
    # store with VELORA's real business history already there (products, customers, orders) but
    # onboarding genuinely incomplete, so NOVA's real Guide tutorial walks the visitor through it
    # rather than dropping them into an already-finished store with nothing left to do.
    demo_res = await client.post("/api/v1/auth/demo-login")
    assert demo_res.status_code == 200
    headers = {"Authorization": f"Bearer {demo_res.json()['access_token']}"}

    me_res = await client.get("/api/v1/auth/me", headers=headers)
    assert me_res.json()["email"] == "owner@velora.demo"
    assert me_res.json()["role"] == "owner"

    progress_res = await client.get("/api/v1/onboarding/progress", headers=headers)
    assert progress_res.json()["current_step"] == "brand"  # the real tutorial starts from step one

    products_res = await client.get("/api/v1/products", headers=headers)
    assert len(products_res.json()) == 26  # the rich catalog, no review draft accepted yet

    live_res = await client.get("/api/v1/storefront/live", headers=headers)
    assert live_res.status_code == 404  # not generated/published yet — the tutorial does this

    # The same documented credentials also work through the ordinary login form.
    login_res = await client.post(
        "/api/v1/auth/login", json={"email": "owner@velora.demo", "password": "changeme123"}
    )
    assert login_res.status_code == 200


async def test_demo_login_resets_any_changes_made_by_a_previous_demo_visitor(client):
    first_headers = {
        "Authorization": f"Bearer {(await client.post('/api/v1/auth/demo-login')).json()['access_token']}"
    }
    await client.post(
        "/api/v1/products",
        json={"title": "Added By Previous Visitor", "slug": "added-by-previous-visitor", "variants": [{"sku": "VISIT-1", "price": 10}]},
        headers=first_headers,
    )
    products_before_reset = await client.get("/api/v1/products", headers=first_headers)
    assert len(products_before_reset.json()) == 27

    # The next visitor's demo-login resets all the way back to the standard baseline — never
    # inherits a stranger's changes.
    second_res = await client.post("/api/v1/auth/demo-login")
    second_headers = {"Authorization": f"Bearer {second_res.json()['access_token']}"}
    products_after_reset = await client.get("/api/v1/products", headers=second_headers)
    assert len(products_after_reset.json()) == 26
    assert all(p["title"] != "Added By Previous Visitor" for p in products_after_reset.json())
