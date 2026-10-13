"""SKUs identify a variant within one store. Two tenants may use the same SKU; one tenant may not
use it twice. (It used to be globally unique: the second visitor to accept the guided demo's product
got a 500, and a tenant could learn another tenant's SKUs.)"""


async def _signup(client, name):
    res = await client.post(
        "/api/v1/auth/signup",
        json={"org_name": name, "full_name": "Owner", "email": f"{name.lower().replace(' ', '')}@sku.demo", "password": "changeme123"},
    )
    assert res.status_code == 201, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def _accept_draft(client, headers, sku):
    await client.post("/api/v1/store-creation/start", headers=headers)
    await client.put("/api/v1/store-creation/brand-input", json={"name": "Brand"}, headers=headers)
    d = (await client.post("/api/v1/store-creation/product-drafts", json={"title": f"Tote {sku}", "price": 10, "sku": sku}, headers=headers)).json()
    await client.post(f"/api/v1/store-creation/product-drafts/{d['id']}/generate", headers=headers)
    return await client.post(f"/api/v1/store-creation/product-drafts/{d['id']}/accept", headers=headers)


async def test_two_tenants_can_use_the_same_sku(client):
    a = await _signup(client, "Tenant A")
    b = await _signup(client, "Tenant B")
    assert (await _accept_draft(client, a, "VEL-QMC")).status_code == 200
    assert (await _accept_draft(client, b, "VEL-QMC")).status_code == 200
    assert len((await client.get("/api/v1/products", headers=a)).json()) == 1
    assert len((await client.get("/api/v1/products", headers=b)).json()) == 1


async def test_the_same_sku_twice_in_one_store_is_a_clean_conflict_not_a_500(client):
    a = await _signup(client, "Tenant C")
    assert (await _accept_draft(client, a, "DUP-1")).status_code == 200
    again = await _accept_draft(client, a, "DUP-1")
    assert again.status_code == 409
    direct = await client.post(
        "/api/v1/products", headers=a,
        json={"title": "Other", "slug": "other", "variants": [{"sku": "DUP-1", "price": 5}]},
    )
    assert direct.status_code == 409
