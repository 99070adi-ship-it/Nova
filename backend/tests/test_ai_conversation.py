async def _auth_headers(client, seeded_owner):
    res = await client.post("/api/v1/auth/login", json={"email": seeded_owner["email"], "password": seeded_owner["password"]})
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def test_start_conversation_and_post_message_triggers_real_tool_call(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)

    start_res = await client.post("/api/v1/ai/conversations", json={"agent_key": "assistant", "context": {}}, headers=headers)
    assert start_res.status_code == 201
    conversation_id = start_res.json()["id"]

    msg_res = await client.post(
        f"/api/v1/ai/conversations/{conversation_id}/messages", json={"text": "How is my store doing?"}, headers=headers
    )
    assert msg_res.status_code == 200
    body = msg_res.json()
    assert body["hit_loop_cap"] is False
    assert len(body["tool_call_log"]) == 1
    assert body["tool_call_log"][0]["is_mutating"] is False
    assert body["assistant_text"]  # non-empty final answer

    messages_res = await client.get(f"/api/v1/ai/conversations/{conversation_id}/messages", headers=headers)
    roles = [m["role"] for m in messages_res.json()]
    assert roles == ["user", "assistant"]


async def test_conversation_context_drops_product_id_from_a_different_org(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    # A random UUID that doesn't resolve to any product in this (or any) org.
    res = await client.post(
        "/api/v1/ai/conversations",
        json={"agent_key": "assistant", "context": {"product_id": "00000000-0000-0000-0000-000000000000"}},
        headers=headers,
    )
    assert res.status_code == 201
    assert res.json()["context"] == {}  # unresolvable reference silently dropped, not trusted


async def test_unknown_agent_key_rejected(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    res = await client.post("/api/v1/ai/conversations", json={"agent_key": "not_a_real_agent", "context": {}}, headers=headers)
    assert res.status_code == 422
