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


async def test_me_returns_the_users_own_real_org_slug(client, seeded_owner):
    # Regression for the storefront 404 browser QA found: the admin app's "live site" link needs
    # the signed-in user's own real org slug (lib/storefrontUrl.ts) to point the separate
    # storefront SPA at the right org — not a hardcoded default that only ever matched the one
    # fixed dev fixture before per-visitor demo isolation (Phase 0) existed.
    res = await client.post(
        "/api/v1/auth/login", json={"email": seeded_owner["email"], "password": seeded_owner["password"]}
    )
    headers = {"Authorization": f"Bearer {res.json()['access_token']}"}

    me_res = await client.get("/api/v1/auth/me", headers=headers)
    assert me_res.status_code == 200
    assert me_res.json()["org_slug"] == seeded_owner["org_slug"]


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
    # One click, no form, straight into a real token for a brand-new isolated demo workspace —
    # landing in a store with VELORA's real business history already there (products, customers,
    # orders) but onboarding genuinely incomplete, so NOVA's real Guide tutorial walks the visitor
    # through it rather than dropping them into an already-finished store with nothing left to do.
    demo_res = await client.post("/api/v1/auth/demo-login")
    assert demo_res.status_code == 200
    headers = {"Authorization": f"Bearer {demo_res.json()['access_token']}"}

    me_res = await client.get("/api/v1/auth/me", headers=headers)
    email = me_res.json()["email"]
    assert email.startswith("owner+") and email.endswith("@velora.demo")  # unique per visitor
    assert me_res.json()["role"] == "owner"

    progress_res = await client.get("/api/v1/onboarding/progress", headers=headers)
    assert progress_res.json()["current_step"] == "brand"  # the real tutorial starts from step one

    products_res = await client.get("/api/v1/products", headers=headers)
    assert len(products_res.json()) == 26  # the rich catalog, no review draft accepted yet

    live_res = await client.get("/api/v1/storefront/live", headers=headers)
    assert live_res.status_code == 404  # not generated/published yet — the tutorial does this

    # The same generated identity also works through the ordinary login form.
    login_res = await client.post("/api/v1/auth/login", json={"email": email, "password": "changeme123"})
    assert login_res.status_code == 200


async def test_demo_login_never_affects_another_visitors_workspace():
    # Two separate visitors (separate cookie jars, exactly like two separate browsers) — the
    # second one's demo-login must create its OWN isolated workspace, never touch or reset the
    # first one's, which is the whole point of Phase 0's isolation rework.
    from httpx import ASGITransport, AsyncClient
    from app.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as visitor_a, AsyncClient(
        transport=transport, base_url="http://test"
    ) as visitor_b:
        a_headers = {"Authorization": f"Bearer {(await visitor_a.post('/api/v1/auth/demo-login')).json()['access_token']}"}
        b_headers = {"Authorization": f"Bearer {(await visitor_b.post('/api/v1/auth/demo-login')).json()['access_token']}"}

        a_email = (await visitor_a.get("/api/v1/auth/me", headers=a_headers)).json()["email"]
        b_email = (await visitor_b.get("/api/v1/auth/me", headers=b_headers)).json()["email"]
        assert a_email != b_email  # genuinely different orgs/users, not a shared identity

        await visitor_a.post(
            "/api/v1/products",
            json={"title": "Added By Visitor A", "slug": "added-by-visitor-a", "variants": [{"sku": "VISIT-A-1", "price": 10}]},
            headers=a_headers,
        )
        a_products = await visitor_a.get("/api/v1/products", headers=a_headers)
        assert len(a_products.json()) == 27  # visitor A's own addition landed in visitor A's org

        # Visitor B's workspace was never touched by visitor A's change, or by visitor A's login.
        b_products = await visitor_b.get("/api/v1/products", headers=b_headers)
        assert len(b_products.json()) == 26
        assert all(p["title"] != "Added By Visitor A" for p in b_products.json())

        # A third visitor's fresh demo-login doesn't reset either of the first two.
        async with AsyncClient(transport=transport, base_url="http://test") as visitor_c:
            visitor_c_res = await visitor_c.post("/api/v1/auth/demo-login")
            assert visitor_c_res.status_code == 200

        a_products_after = await visitor_a.get("/api/v1/products", headers=a_headers)
        assert len(a_products_after.json()) == 27  # visitor A's workspace still intact
        b_products_after = await visitor_b.get("/api/v1/products", headers=b_headers)
        assert len(b_products_after.json()) == 26  # visitor B's workspace still intact


async def test_demo_login_resumes_the_same_workspace_for_a_returning_visitor(client):
    # Same client = same cookie jar, exactly like the same browser tab returning later. The
    # second demo-login call automatically carries the refresh cookie the first one set.
    first_res = await client.post("/api/v1/auth/demo-login")
    first_headers = {"Authorization": f"Bearer {first_res.json()['access_token']}"}
    first_email = (await client.get("/api/v1/auth/me", headers=first_headers)).json()["email"]

    await client.post(
        "/api/v1/products",
        json={"title": "Added Before Returning", "slug": "added-before-returning", "variants": [{"sku": "RETURN-1", "price": 10}]},
        headers=first_headers,
    )

    second_res = await client.post("/api/v1/auth/demo-login")
    second_headers = {"Authorization": f"Bearer {second_res.json()['access_token']}"}
    second_email = (await client.get("/api/v1/auth/me", headers=second_headers)).json()["email"]

    assert second_email == first_email  # resumed the same workspace, not a fresh one

    products = await client.get("/api/v1/products", headers=second_headers)
    assert len(products.json()) == 27  # the earlier addition is still there — nothing was reset
