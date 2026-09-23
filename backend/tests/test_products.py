async def _auth_headers(client, seeded_owner):
    res = await client.post("/api/v1/auth/login", json={"email": seeded_owner["email"], "password": seeded_owner["password"]})
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def test_create_product_provisions_inventory(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    res = await client.post(
        "/api/v1/products",
        json={"title": "Test Bag", "slug": "test-bag", "variants": [{"sku": "TB-001", "price": 100}]},
        headers=headers,
    )
    assert res.status_code == 201
    body = res.json()
    assert body["status"] == "draft"
    assert len(body["variants"]) == 1

    inv_res = await client.get("/api/v1/inventory", headers=headers)
    assert inv_res.status_code == 200
    rows = inv_res.json()
    assert any(r["sku"] == "TB-001" and r["on_hand"] == 0 for r in rows)


async def test_adjust_inventory_rejects_negative(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    await client.post(
        "/api/v1/products",
        json={"title": "Test Bag 2", "slug": "test-bag-2", "variants": [{"sku": "TB-002", "price": 50}]},
        headers=headers,
    )
    inv_id = (await client.get("/api/v1/inventory", headers=headers)).json()[0]["id"]

    over_deduct = await client.post(f"/api/v1/inventory/{inv_id}/adjust", json={"delta": -5, "reason": "test"}, headers=headers)
    assert over_deduct.status_code == 422

    add = await client.post(f"/api/v1/inventory/{inv_id}/adjust", json={"delta": 10, "reason": "restock"}, headers=headers)
    assert add.status_code == 200
    assert add.json()["on_hand"] == 10


async def test_collection_product_membership(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    product = (
        await client.post(
            "/api/v1/products",
            json={"title": "Test Bag 3", "slug": "test-bag-3", "variants": [{"sku": "TB-003", "price": 75}]},
            headers=headers,
        )
    ).json()
    collection = (await client.post("/api/v1/collections", json={"title": "Test Collection", "slug": "test-collection"}, headers=headers)).json()

    add_res = await client.post(f"/api/v1/collections/{collection['id']}/products", json={"product_id": product["id"]}, headers=headers)
    assert add_res.status_code == 204

    get_res = await client.get(f"/api/v1/collections/{collection['id']}", headers=headers)
    assert product["id"] in get_res.json()["product_ids"]

    remove_res = await client.delete(f"/api/v1/collections/{collection['id']}/products/{product['id']}", headers=headers)
    assert remove_res.status_code == 204
    get_res_2 = await client.get(f"/api/v1/collections/{collection['id']}", headers=headers)
    assert product["id"] not in get_res_2.json()["product_ids"]
