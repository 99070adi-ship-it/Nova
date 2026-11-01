"""Checkpoint 6 — provider-failure containment. A raised exception from any LLMProvider must never
crash a request or leave application state ambiguous: it must surface as one safe, generic error,
and the AIAgentRun it happened inside of must land in `failed`, never `completed` and never stuck
`running`."""

from sqlalchemy import select

from app.ai.provider import LLMProvider, ProviderFinal, ProviderStepResult
from app.db.models import AgentRunStatus, AIAgentRun
from app.db.session import AsyncSessionLocal


class _ExplodingProvider(LLMProvider):
    """Stands in for a real OpenAI/NVIDIA SDK raising — a timeout, a rate limit, a connection
    error. The exact exception type is deliberately generic (RuntimeError): safe_provider_step
    must catch *any* exception, not just ones from a specific SDK."""

    async def step(self, **kwargs) -> ProviderStepResult:
        raise RuntimeError("simulated OpenAI outage — connection reset")

    async def embed(self, texts: list[str]) -> list[list[float]]:
        return []


class _FlakyProvider(LLMProvider):
    """Succeeds `succeed_calls` times, then raises — for testing partial-progress-then-failure
    inside a loop of independent provider calls (Store Manager's action-plan generation)."""

    def __init__(self, succeed_json: str, succeed_calls: int = 1):
        self._succeed_json = succeed_json
        self._succeed_calls = succeed_calls
        self._call_count = 0

    async def step(self, **kwargs) -> ProviderStepResult:
        self._call_count += 1
        if self._call_count > self._succeed_calls:
            raise RuntimeError("simulated OpenAI outage — connection reset")
        return ProviderStepResult(final=ProviderFinal(text=self._succeed_json))

    async def embed(self, texts: list[str]) -> list[list[float]]:
        return []


async def _auth_headers(client, seeded_owner):
    res = await client.post("/api/v1/auth/login", json={"email": seeded_owner["email"], "password": seeded_owner["password"]})
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def _agent_runs(org_id):
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(AIAgentRun).where(AIAgentRun.org_id == org_id).order_by(AIAgentRun.created_at.desc()))
        return list(result.scalars().all())


def _assert_safe_error(body: dict) -> None:
    assert body["error"]["code"] == "ai_provider_unavailable"
    message = body["error"]["message"]
    assert "AI service is temporarily unavailable" in message
    # Never leak the underlying exception's text, type, or anything implementation-specific.
    assert "RuntimeError" not in message
    assert "outage" not in message
    assert "traceback" not in message.lower()


async def test_conversation_message_provider_failure_is_safe_and_marks_run_failed(client, seeded_owner, monkeypatch):
    import app.services.agent_service as agent_service

    monkeypatch.setattr(agent_service, "build_llm_provider", lambda *_a: _ExplodingProvider())
    headers = await _auth_headers(client, seeded_owner)

    start_res = await client.post("/api/v1/ai/conversations", json={"agent_key": "assistant", "context": {}}, headers=headers)
    conversation_id = start_res.json()["id"]

    msg_res = await client.post(
        f"/api/v1/ai/conversations/{conversation_id}/messages", json={"text": "How is my store doing?"}, headers=headers
    )
    assert msg_res.status_code == 503
    _assert_safe_error(msg_res.json())

    runs = await _agent_runs(seeded_owner["org_id"])
    assert runs[0].status == AgentRunStatus.failed
    assert runs[0].result_json == {"error": "ai_provider_unavailable"}


async def test_conversation_survives_provider_failure_and_recovers_on_retry(client, seeded_owner, monkeypatch):
    import app.services.agent_service as agent_service

    monkeypatch.setattr(agent_service, "build_llm_provider", lambda *_a: _ExplodingProvider())
    headers = await _auth_headers(client, seeded_owner)

    start_res = await client.post("/api/v1/ai/conversations", json={"agent_key": "assistant", "context": {}}, headers=headers)
    conversation_id = start_res.json()["id"]
    await client.post(f"/api/v1/ai/conversations/{conversation_id}/messages", json={"text": "hello?"}, headers=headers)

    # The user's own turn is preserved even though the assistant never replied — no corrupted
    # conversation state, and definitely no assistant message pretending a reply happened.
    messages_res = await client.get(f"/api/v1/ai/conversations/{conversation_id}/messages", headers=headers)
    roles = [m["role"] for m in messages_res.json()]
    assert roles == ["user"]

    # Recovery: a real provider on the next attempt succeeds normally, in the same conversation.
    from app.ai.factory import build_llm_provider as real_build_llm_provider

    monkeypatch.setattr(agent_service, "build_llm_provider", real_build_llm_provider)
    retry_res = await client.post(
        f"/api/v1/ai/conversations/{conversation_id}/messages", json={"text": "hello again"}, headers=headers
    )
    assert retry_res.status_code == 200
    assert retry_res.json()["assistant_text"]

    messages_after = await client.get(f"/api/v1/ai/conversations/{conversation_id}/messages", headers=headers)
    assert [m["role"] for m in messages_after.json()] == ["user", "user", "assistant"]


async def test_generate_draft_content_provider_failure_leaves_draft_untouched(client, seeded_owner, monkeypatch):
    import app.services.product_agent_service as product_agent_service

    headers = await _auth_headers(client, seeded_owner)
    await client.post("/api/v1/store-creation/start", headers=headers)
    await client.put("/api/v1/store-creation/brand-input", json={"name": "Test Co"}, headers=headers)
    draft_res = await client.post(
        "/api/v1/store-creation/product-drafts", json={"title": "Widget", "price": 10, "sku": "W-1"}, headers=headers
    )
    draft_id = draft_res.json()["id"]
    fields_before = draft_res.json()["fields"]

    monkeypatch.setattr(product_agent_service, "build_llm_provider", lambda *_a: _ExplodingProvider())
    generate_res = await client.post(f"/api/v1/store-creation/product-drafts/{draft_id}/generate", headers=headers)
    assert generate_res.status_code == 503
    _assert_safe_error(generate_res.json())

    drafts_res = await client.get("/api/v1/store-creation/product-drafts", headers=headers)
    draft = next(d for d in drafts_res.json() if d["id"] == draft_id)
    # Never advanced past its pre-call state — no half-applied "suggested" fields, no status flip.
    assert draft["status"] == "owner_reviewing"
    assert draft["fields"] == fields_before

    runs = await _agent_runs(seeded_owner["org_id"])
    assert runs[0].agent_key == "product_agent"
    assert runs[0].status == AgentRunStatus.failed


async def test_propose_change_plan_provider_failure_does_not_touch_draft(client, seeded_owner, monkeypatch):
    import app.services.storefront_agent_service as storefront_agent_service

    headers = await _auth_headers(client, seeded_owner)
    await client.post("/api/v1/store-creation/start", headers=headers)
    await client.put("/api/v1/store-creation/brand-input", json={"name": "Test Co"}, headers=headers)
    draft_before = await client.get("/api/v1/storefront/draft", headers=headers)
    sections_before = draft_before.json()["pages"][0]["sections"]

    monkeypatch.setattr(storefront_agent_service, "build_llm_provider", lambda *_a: _ExplodingProvider())
    propose_res = await client.post(
        "/api/v1/storefront/change-plan", json={"instruction": "add a story about us"}, headers=headers
    )
    assert propose_res.status_code == 503
    _assert_safe_error(propose_res.json())

    draft_after = await client.get("/api/v1/storefront/draft", headers=headers)
    assert draft_after.json()["pages"][0]["sections"] == sections_before

    runs = await _agent_runs(seeded_owner["org_id"])
    assert runs[0].agent_key == "storefront_agent"
    assert runs[0].status == AgentRunStatus.failed


async def test_store_health_provider_failure_is_safe_and_marks_run_failed(client, seeded_owner, monkeypatch):
    import app.services.store_manager_service as store_manager_service

    monkeypatch.setattr(store_manager_service, "build_llm_provider", lambda *_a: _ExplodingProvider())
    headers = await _auth_headers(client, seeded_owner)

    res = await client.post("/api/v1/store-manager/health", headers=headers)
    assert res.status_code == 503
    _assert_safe_error(res.json())

    runs = await _agent_runs(seeded_owner["org_id"])
    store_manager_runs = [r for r in runs if r.agent_key == "store_manager"]
    assert store_manager_runs[0].status == AgentRunStatus.failed
    # The delegated sales_agent run underneath it is ALSO recorded failed, not silently dropped.
    assert any(r.agent_key == "sales_agent" and r.status == AgentRunStatus.failed for r in runs)


async def test_action_plan_provider_failure_keeps_already_executed_items_but_creates_no_plan(
    client, seeded_owner, monkeypatch
):
    from app.db.session import AsyncSessionLocal
    from app.schemas.product import ProductCreate, VariantIn
    from app.services import product_service

    async def _seed_product_missing_description(org_id, *, title, sku):
        async with AsyncSessionLocal() as db:
            return await product_service.create_product(
                db, org_id, ProductCreate(title=title, slug=sku.lower(), variants=[VariantIn(sku=sku, price=40)]),
            )

    org_id = seeded_owner["org_id"]
    product_a = await _seed_product_missing_description(org_id, title="Flaky Bag A", sku="FB-A")
    await _seed_product_missing_description(org_id, title="Flaky Bag B", sku="FB-B")

    import app.services.store_manager_service as store_manager_service

    # Succeeds once (product A gets a real description + auto-executed proposal), then the
    # provider goes down before product B's call.
    monkeypatch.setattr(
        store_manager_service, "build_llm_provider",
        lambda: _FlakyProvider('{"description": "A lovely bag."}', succeed_calls=1),
    )
    headers = await _auth_headers(client, seeded_owner)

    res = await client.post("/api/v1/store-manager/action-plan", headers=headers)
    assert res.status_code == 503
    _assert_safe_error(res.json())

    # No mutation was bypassed, no partial AgentActionPlan invented for unfinished work.
    from sqlalchemy import select as sa_select

    from app.db.models import AgentActionPlan

    async with AsyncSessionLocal() as db:
        plans = (await db.execute(sa_select(AgentActionPlan).where(AgentActionPlan.org_id == org_id))).scalars().all()
    assert plans == []

    # But product A's already-executed, already-approved change is real and durable — a provider
    # outage on item 2 does not roll back legitimately finished work on item 1.
    product_res = await client.get(f"/api/v1/products/{product_a.id}", headers=headers)
    assert product_res.json()["description"] == "A lovely bag."

    runs = await _agent_runs(org_id)
    assert runs[0].agent_key == "store_manager"
    assert runs[0].status == AgentRunStatus.failed
