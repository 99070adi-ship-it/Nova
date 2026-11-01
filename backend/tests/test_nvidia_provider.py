"""NVIDIA NIM as the real AI provider. Everything here is MOCKED at the OpenAI-SDK boundary (no network, no key): it proves
configuration, request shape, output cleaning, error handling and that every existing safety invariant (registry validation,
tool layer, approvals, draft-only edits, tenant isolation) still holds when a REAL provider class is in the loop. It does not
prove that NVIDIA's model produces good output; that is what scripts/nvidia_verify.py checks with a real key."""

import json
import uuid
from unittest.mock import AsyncMock

import httpx
import openai
import pytest
from sqlalchemy import func, select

import app.services.agent_service as agent_service
import app.services.storefront_element_service as element_service
from app.ai import status as ai_status
from app.ai.factory import UnavailableProvider, build_llm_provider
from app.ai.fake_provider import FakeLLMProvider
from app.ai.json_output import clean_model_text, parse_model_json
from app.ai.openai_compatible_provider import OpenAICompatibleProvider
from app.ai.provider import AssistantMessage
from app.config import get_settings
from app.db.models import ToolProposal
from app.db.session import AsyncSessionLocal
from app.errors import AIProviderError, AIRateLimitedError
from tests.test_openai_provider import _completion, _tool_call
from tests.test_preview_publish_baseline import _demo

SECRET = "nvapi-SUPER-SECRET-KEY-123456"


def _provider(create: AsyncMock, **kw) -> OpenAICompatibleProvider:
    p = OpenAICompatibleProvider(api_key=SECRET, base_url="https://integrate.api.nvidia.com/v1", chat_model="nvidia/test-model", embedding_model=None, **kw)
    p._client.chat.completions.create = create
    return p


@pytest.fixture
def nvidia_settings(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "ai_provider", "nvidia")
    monkeypatch.setattr(s, "nvidia_api_key", SECRET)
    ai_status.reset_probe()
    yield s
    ai_status.reset_probe()


# ---- configuration / factory ----

def test_nvidia_is_built_from_configuration_and_the_model_is_changeable_without_code(nvidia_settings, monkeypatch):
    p = build_llm_provider()
    assert isinstance(p, OpenAICompatibleProvider)
    assert str(p._client.base_url).startswith("https://integrate.api.nvidia.com/v1")
    assert p._chat_model == "nvidia/nemotron-3-super-120b-a12b"  # the documented default
    monkeypatch.setattr(nvidia_settings, "nvidia_model", "nvidia/nemotron-3-ultra-550b-a55b")
    assert build_llm_provider()._chat_model == "nvidia/nemotron-3-ultra-550b-a55b"  # config only


def test_bounds_and_template_kwargs_come_from_settings(nvidia_settings, monkeypatch):
    monkeypatch.setattr(nvidia_settings, "ai_timeout_seconds", 12.0)
    monkeypatch.setattr(nvidia_settings, "ai_processing_timeout_seconds", 77.0)
    monkeypatch.setattr(nvidia_settings, "ai_max_retries", 0)
    monkeypatch.setattr(nvidia_settings, "nvidia_chat_template_kwargs", '{"enable_thinking": false}')
    p = build_llm_provider()
    assert p._client.timeout == 77.0 and p._client.max_retries == 0  # processing (generation/analysis) gets the longer bound
    assert build_llm_provider("chat")._client.timeout == 12.0  # chat fails fast
    assert p._extra_body == {"chat_template_kwargs": {"enable_thinking": False}}
    monkeypatch.setattr(nvidia_settings, "nvidia_chat_template_kwargs", "not json")
    assert build_llm_provider()._extra_body is None  # never send something that isn't a valid object


@pytest.mark.parametrize("which,key_attr", [("nvidia", "nvidia_api_key"), ("openai", "openai_api_key")])
async def test_a_real_provider_without_credentials_never_falls_back_to_the_fake(monkeypatch, which, key_attr):
    s = get_settings()
    monkeypatch.setattr(s, "ai_provider", which)
    monkeypatch.setattr(s, key_attr, None)
    p = build_llm_provider()
    assert isinstance(p, UnavailableProvider) and not isinstance(p, FakeLLMProvider)
    with pytest.raises(AIProviderError):
        await p.step(system_prompt="s", context={}, messages=["hi"], tool_results=[], available_tools=[])


def test_the_default_is_the_explicit_rule_based_double(monkeypatch):
    monkeypatch.setattr(get_settings(), "ai_provider", "fake")
    assert isinstance(build_llm_provider(), FakeLLMProvider)


# ---- request shape and output cleaning ----

async def test_the_request_carries_model_bounds_and_roles_and_nothing_secret():
    create = AsyncMock(return_value=_completion(content="Hey there!"))
    p = _provider(create, temperature=0.3, max_output_tokens=900, extra_body={"chat_template_kwargs": {"enable_thinking": False}})
    await p.step(system_prompt="You are NOVA.", context={"intent": "small_talk"}, messages=["Hi", AssistantMessage("Hello!"), "How are you?"], tool_results=[], available_tools=[])
    kw = create.call_args.kwargs
    assert kw["model"] == "nvidia/test-model" and kw["temperature"] == 0.3 and kw["max_tokens"] == 900
    assert kw["extra_body"] == {"chat_template_kwargs": {"enable_thinking": False}}
    assert kw["tools"] is None  # no tools offered for small talk
    assert [m["role"] for m in kw["messages"]] == ["system", "user", "user", "assistant", "user"]
    assert SECRET not in json.dumps(kw["messages"])


async def test_a_reasoning_blocks_and_code_fences_are_not_part_of_the_answer():
    create = AsyncMock(return_value=_completion(content='<think>let me think about the hero</think>\n```json\n{"a": 1}\n```'))
    out = await _provider(create).step(system_prompt="s", context={}, messages=["x"], tool_results=[], available_tools=[])
    assert out.final.text == '{"a": 1}'


@pytest.mark.parametrize("raw,expected", [
    ('{"a": 1}', {"a": 1}),
    ('```json\n{"a": [1, 2]}\n```', {"a": [1, 2]}),
    ('<think>hmm {"a": 99}</think>{"a": 2}', {"a": 2}),
    ('Sure! Here you go: {"a": {"b": "}"}} hope that helps', {"a": {"b": "}"}}),
    ('[{"x": 1}]', [{"x": 1}]),
])
def test_model_json_is_recovered_from_realistic_wrappers(raw, expected):
    assert parse_model_json(raw) == expected


@pytest.mark.parametrize("raw", ["", None, "no json here", "<think>unfinished {", "{broken"])
def test_unrecoverable_model_output_raises(raw):
    with pytest.raises(ValueError):
        parse_model_json(raw)
    assert clean_model_text("<think>never closed") == ""


# ---- failures are safe, classified, and leak nothing ----

def _status_error(cls, code):
    req = httpx.Request("POST", "https://integrate.api.nvidia.com/v1/chat/completions")
    return cls(f"upstream said: bad key {SECRET}", response=httpx.Response(code, request=req), body=None)


async def test_rate_limits_and_outages_become_safe_errors_that_never_contain_the_key():
    from structlog.testing import capture_logs

    from app.ai.reliability import safe_provider_step

    for exc, expected in [(_status_error(openai.RateLimitError, 429), AIRateLimitedError), (_status_error(openai.InternalServerError, 500), AIProviderError),
                          (openai.APITimeoutError(request=httpx.Request("POST", "https://x")), AIProviderError), (RuntimeError(SECRET), AIProviderError)]:
        p = _provider(AsyncMock(side_effect=exc))
        with capture_logs() as logs, pytest.raises(expected) as info:
            await safe_provider_step(p, system_prompt="s", context={}, messages=["x"], tool_results=[], available_tools=[])
        assert SECRET not in str(info.value) and SECRET not in str(logs)
        assert type(info.value) is expected


# ---- click-to-edit with the REAL provider class in the loop ----

def _use(monkeypatch, module, create) -> None:
    monkeypatch.setattr(module, "build_llm_provider", lambda *_a: _provider(create))


async def _hero(client):
    headers, slug = await _demo(client)
    draft = (await client.get("/api/v1/storefront/draft", headers=headers)).json()
    hero = next(s for p in draft["pages"] for s in p["sections"] if s["type"] == "hero")
    return headers, slug, draft, hero


def _propose(client, headers, draft, hero, element="hero.headline", instruction="make it premium", section=True):
    return client.post("/api/v1/storefront/element-edit/propose", headers=headers, json={
        "draft_id": draft["id"], "revision": draft["revision"], "section_id": hero["id"] if section else None, "element": element, "instruction": instruction})


async def test_a_model_written_proposal_is_validated_and_changes_nothing_until_applied(client, monkeypatch):
    headers, slug, draft, hero = await _hero(client)
    wrapped = '<think>The brand is quiet luxury.</think>```json\n' + json.dumps({
        "summary": "Make the headline more editorial", "reasoning": "Quieter, shorter phrasing.",
        "changes": [{"path": "headline", "value": "Considered leather. Made to last."}], "warnings": [], "unsupported": None, "alternative": None}) + "\n```"
    create = AsyncMock(return_value=_completion(content=wrapped))
    _use(monkeypatch, element_service, create)
    res = await _propose(client, headers, draft, hero)
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["changes"][0]["proposed"] == "Considered leather. Made to last." and body["changes"][0]["current"] == hero["configuration"]["headline"]
    # What the model was given: the selected element, allowed properties and current values, brand and theme; instruction as data.
    sent = json.loads(create.call_args.kwargs["messages"][1]["content"].split("\n", 1)[1])
    assert sent["element"]["key"] == "hero.headline" and sent["properties"][0]["path"] == "headline" and sent["properties"][0]["current"] == hero["configuration"]["headline"]
    assert sent["instruction"] == "make it premium" and "theme" in sent and "brand" in sent
    assert create.call_args.kwargs["tools"] is None  # the model gets no tools and cannot write anything
    # Proposing changed neither the draft nor the live store; applying changes the draft only; publishing changes live.
    assert (await client.get("/api/v1/storefront/draft", headers=headers)).json() == draft
    pub_before = (await client.get(f"/api/v1/public/stores/{slug}/storefront")).json()
    applied = await client.post(f"/api/v1/storefront/element-edit/{body['proposal_id']}/apply", headers=headers, json={"revision": draft["revision"]})
    assert applied.status_code == 200
    assert (await client.get(f"/api/v1/public/stores/{slug}/storefront")).json() == pub_before
    await client.post("/api/v1/storefront/publish", headers=headers)
    live_hero = next(s for s in (await client.get(f"/api/v1/public/stores/{slug}/storefront")).json()["pages"][0]["sections"] if s["type"] == "hero")
    assert live_hero["configuration"]["headline"] == "Considered leather. Made to last."


@pytest.mark.parametrize("content,why", [
    ("I'd love to help! Here is a nicer headline for you.", "prose, not JSON"),
    ("", "empty"),
    ("<think>I got lost", "unterminated reasoning"),
    (json.dumps({"changes": [{"path": "headline", "value": "<img src=x onerror=alert(1)>"}]}), "markup"),
    (json.dumps({"changes": [{"path": "cta_href", "value": "javascript:alert(1)"}]}), "wrong element's property"),
    (json.dumps({"changes": [{"path": "headline", "value": "x" * 400}]}), "too long"),
    (json.dumps({"changes": "headline: new"}), "wrong shape"),
    (json.dumps({"changes": [], "unsupported": None}), "no change"),
])
async def test_malformed_or_unsafe_model_output_leaves_the_draft_unchanged(client, monkeypatch, content, why):
    headers, slug, draft, hero = await _hero(client)
    _use(monkeypatch, element_service, AsyncMock(return_value=_completion(content=content)))
    res = await _propose(client, headers, draft, hero)
    assert res.status_code == 422 and res.json()["error"]["code"] == "unsupported_edit", why
    assert (await client.get("/api/v1/storefront/draft", headers=headers)).json() == draft


@pytest.mark.parametrize("exc,status_code,code", [
    (_status_error(openai.RateLimitError, 429), 429, "ai_rate_limited"),
    (_status_error(openai.InternalServerError, 503), 503, "ai_provider_unavailable"),
    (openai.APITimeoutError(request=httpx.Request("POST", "https://x")), 503, "ai_provider_unavailable"),
    (openai.APIConnectionError(request=httpx.Request("POST", "https://x")), 503, "ai_provider_unavailable"),
])
async def test_provider_failures_during_click_to_edit_are_safe_and_nothing_changes(client, monkeypatch, exc, status_code, code):
    headers, slug, draft, hero = await _hero(client)
    _use(monkeypatch, element_service, AsyncMock(side_effect=exc))
    res = await _propose(client, headers, draft, hero)
    assert res.status_code == status_code and res.json()["error"]["code"] == code
    assert SECRET not in res.text and "upstream said" not in res.text
    assert (await client.get("/api/v1/storefront/draft", headers=headers)).json() == draft
    assert "changed" not in res.json()["error"]["message"].lower().replace("nothing was changed", "")  # never claims success


async def test_the_registry_still_rejects_a_hostile_real_model_theme_edit(client, monkeypatch):
    headers, slug, draft, _ = await _hero(client)
    _use(monkeypatch, element_service, AsyncMock(return_value=_completion(content=json.dumps({"changes": [{"path": "primary_color", "value": "red; background:url(//evil)"}, {"path": "font_family", "value": "Comic Sans"}]}))))
    res = await _propose(client, headers, draft, None, element="theme.style", instruction="go wild", section=False)
    assert res.status_code == 422
    assert (await client.get("/api/v1/storefront/draft", headers=headers)).json() == draft


# ---- the assistant with the REAL provider class in the loop ----

async def _chat(client, headers):
    return (await client.post("/api/v1/ai/conversations", json={"agent_key": "assistant", "context": {}}, headers=headers)).json()["id"]


async def _say(client, headers, chat, text, **extra):
    return (await client.post(f"/api/v1/ai/conversations/{chat}/messages", json={"text": text, **extra}, headers=headers)).json()


async def test_small_talk_goes_to_the_model_with_history_and_no_tools(client, monkeypatch):
    headers, _ = await _demo(client)
    create = AsyncMock(side_effect=[_completion(content="Hey! What's up?"), _completion(content="Doing great, thanks for asking. You?")])
    _use(monkeypatch, agent_service, create)
    chat = await _chat(client, headers)
    first = await _say(client, headers, chat, "Hey NOVA", screen="create-store")
    second = await _say(client, headers, chat, "How are you?")
    assert (first["assistant_text"], second["assistant_text"]) == ("Hey! What's up?", "Doing great, thanks for asking. You?")
    assert first["tool_call_log"] == [] and second["tool_call_log"] == []
    kw = create.call_args_list[1].kwargs
    assert kw["tools"] is None  # a greeting never gets tools
    assert [m["role"] for m in kw["messages"]] == ["system", "user", "user", "assistant", "user"]  # history keeps its roles
    assert kw["messages"][3]["content"] == "Hey! What's up?"
    ctx = json.loads(kw["messages"][1]["content"].split("\n", 1)[1])
    assert ctx["intent"] == "small_talk" and "screen" not in ctx  # page context never leaks into small talk


async def test_a_business_question_runs_the_registered_read_tool_scoped_to_the_tenant(client, monkeypatch):
    headers, _ = await _demo(client)
    create = AsyncMock(side_effect=[
        _completion(content=None, tool_calls=[_tool_call("c1", "get_low_stock_products", "{}")], finish_reason="tool_calls"),
        _completion(content="Three products are running low: Structured Tote, City Crossbody and Bifold Wallet."),
    ])
    _use(monkeypatch, agent_service, create)
    body = await _say(client, headers, await _chat(client, headers), "How many products are low on stock?", screen="inventory")
    assert body["intent"] == "business_query" and [t["name"] for t in body["tool_call_log"]] == ["get_low_stock_products"]
    offered = {t["function"]["name"] for t in create.call_args_list[0].kwargs["tools"]}
    assert offered == {"get_store_summary", "get_low_stock_products", "get_sales_metrics", "get_customer_activity", "get_brand_profile"}  # reading never offers writing
    tool_msg = next(m for m in create.call_args_list[1].kwargs["messages"] if m["role"] == "tool")
    assert {r["title"] for r in json.loads(tool_msg["content"])["low_stock_products"]} == {"Structured Tote", "City Crossbody", "Bifold Wallet"}  # this tenant's real data


async def test_a_model_that_tries_to_act_on_a_greeting_is_stopped_by_the_tool_layer(client, monkeypatch):
    headers, _ = await _demo(client)
    create = AsyncMock(side_effect=[
        _completion(content=None, tool_calls=[_tool_call("c1", "publish_storefront", "{}")], finish_reason="tool_calls"),
        _completion(content="Hello!"),
    ])
    _use(monkeypatch, agent_service, create)
    body = await _say(client, headers, await _chat(client, headers), "hello")
    assert body["intent"] == "small_talk"
    tool_msg = next(m for m in create.call_args_list[1].kwargs["messages"] if m["role"] == "tool")
    assert json.loads(tool_msg["content"]) == {"error": "unknown_or_unauthorized_tool"}  # not offered this turn, so refused
    async with AsyncSessionLocal() as db:
        assert (await db.execute(select(func.count()).select_from(ToolProposal))).scalar_one() == 0  # no proposal was created


async def test_an_action_the_model_proposes_still_only_becomes_a_pending_proposal(client, monkeypatch):
    headers, _ = await _demo(client)
    create = AsyncMock(side_effect=[
        _completion(content=None, tool_calls=[_tool_call("c1", "publish_storefront", "{}")], finish_reason="tool_calls"),
        _completion(content="I've proposed publishing. It's waiting in Approvals."),
    ])
    _use(monkeypatch, agent_service, create)
    body = await _say(client, headers, await _chat(client, headers), "Publish my store")
    assert body["tool_call_log"][0]["is_mutating"] is True
    pending = (await client.get("/api/v1/approvals?status=proposed", headers=headers)).json()
    assert [p["status"] for p in pending if p["tool_name"] == "publish_storefront"] == ["proposed"]
    assert (await client.get("/api/v1/storefront/live", headers=headers)).json()["status"] == "live"  # the baseline is untouched; nothing was published


async def test_a_provider_failure_in_chat_never_claims_an_action_happened(client, monkeypatch):
    headers, _ = await _demo(client)
    _use(monkeypatch, agent_service, AsyncMock(side_effect=_status_error(openai.RateLimitError, 429)))
    res = await client.post(f"/api/v1/ai/conversations/{await _chat(client, headers)}/messages", json={"text": "Publish my store"}, headers=headers)
    assert res.status_code == 429 and res.json()["error"]["code"] == "ai_rate_limited"
    assert SECRET not in res.text
    async with AsyncSessionLocal() as db:
        assert (await db.execute(select(func.count()).select_from(ToolProposal))).scalar_one() == 0


async def test_only_the_most_recent_turns_are_sent_to_the_model(client, monkeypatch):
    headers, _ = await _demo(client)
    monkeypatch.setattr(get_settings(), "ai_history_messages", 4)
    create = AsyncMock(return_value=_completion(content="ok"))
    _use(monkeypatch, agent_service, create)
    chat = await _chat(client, headers)
    for i in range(5):
        await _say(client, headers, chat, f"thanks {i}")
    turns = [m for m in create.call_args.kwargs["messages"] if m["role"] in ("user", "assistant") and not m["content"].startswith("Context")]
    assert len(turns) == 4 and turns[-1]["content"] == "thanks 4"


# ---- status / diagnostics ----

async def test_status_requires_auth_and_says_plainly_when_the_ai_is_the_rule_based_demo(client):
    assert (await client.get("/api/v1/ai/status")).status_code == 401
    headers, _ = await _demo(client)
    body = (await client.get("/api/v1/ai/status", headers=headers)).json()
    assert body["provider"] == "fake" and body["real_ai"] is False and body["mode"] == "rule_based_demo"


async def test_status_for_a_configured_nvidia_never_exposes_the_key(client, nvidia_settings):
    headers, _ = await _demo(client)
    body = (await client.get("/api/v1/ai/status", headers=headers)).json()
    assert body["provider"] == "nvidia" and body["model"] == "nvidia/nemotron-3-super-120b-a12b" and body["real_ai"] is True
    assert body["credentials_configured"] is True and body["ready"] is None and body["endpoint_host"] == "integrate.api.nvidia.com"
    assert SECRET not in json.dumps(body) and "nvapi" not in json.dumps(body)
    ready = (await client.get("/readyz")).json()
    assert ready["ai"]["provider"] == "nvidia" and SECRET not in json.dumps(ready)


async def test_status_without_a_key_is_not_ready_and_says_why(client, monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "ai_provider", "nvidia")
    monkeypatch.setattr(s, "nvidia_api_key", None)
    headers, _ = await _demo(client)
    body = (await client.get("/api/v1/ai/status", headers=headers)).json()
    assert body["ready"] is False and body["reason"] == "credentials_missing" and body["credentials_configured"] is False


async def test_the_probe_reports_success_and_failure_kinds_only_and_is_cached(client, nvidia_settings, monkeypatch):
    headers, _ = await _demo(client)
    ok = AsyncMock(return_value=_completion(content="ok"))
    import app.ai.status as status_module

    monkeypatch.setattr(status_module, "build_llm_provider", lambda *_a: _provider(ok))
    first = (await client.post("/api/v1/ai/status/probe", headers=headers)).json()
    again = (await client.post("/api/v1/ai/status/probe", headers=headers)).json()
    assert first["ready"] is True and again["ready"] is True and ok.await_count == 1  # cached: it can't be used to burn quota
    ai_status.reset_probe()
    bad = AsyncMock(side_effect=_status_error(openai.AuthenticationError, 401))
    monkeypatch.setattr(status_module, "build_llm_provider", lambda *_a: _provider(bad))
    failed = (await client.post("/api/v1/ai/status/probe", headers=headers)).json()
    assert failed["ready"] is False and failed["last_check"]["error"] == "authentication_failed"
    assert SECRET not in json.dumps(failed) and "upstream said" not in json.dumps(failed)


# ---- actionable errors, validated tool calls, no duplicate mutations ----

async def test_a_missing_key_is_a_visible_actionable_error_not_a_silent_fallback(client, monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "ai_provider", "nvidia")
    monkeypatch.setattr(s, "nvidia_api_key", None)
    headers, _ = await _demo(client)
    res = await client.post(f"/api/v1/ai/conversations/{await _chat(client, headers)}/messages", json={"text": "hello"}, headers=headers)
    assert res.status_code == 503 and res.json()["error"]["code"] == "ai_not_configured"
    assert "NVIDIA_API_KEY" in res.json()["error"]["message"] and "Nothing was changed" in res.json()["error"]["message"]


@pytest.mark.parametrize("code", [401, 403])
async def test_rejected_credentials_are_reported_distinctly_without_leaking_the_key(client, monkeypatch, code):
    headers, _ = await _demo(client)
    _use(monkeypatch, agent_service, AsyncMock(side_effect=_status_error(openai.AuthenticationError if code == 401 else openai.PermissionDeniedError, code)))
    res = await client.post(f"/api/v1/ai/conversations/{await _chat(client, headers)}/messages", json={"text": "hello"}, headers=headers)
    assert res.status_code == 503 and res.json()["error"]["code"] == "ai_credentials_invalid"
    assert SECRET not in res.text and "upstream said" not in res.text


async def test_a_malformed_provider_response_is_a_safe_error(client, monkeypatch):
    headers, _ = await _demo(client)
    broken = _completion(content=None, tool_calls=[_tool_call("c1", "get_store_summary", "{not json")], finish_reason="tool_calls")
    _use(monkeypatch, agent_service, AsyncMock(return_value=broken))
    res = await client.post(f"/api/v1/ai/conversations/{await _chat(client, headers)}/messages", json={"text": "How many products do I have?"}, headers=headers)
    assert res.status_code == 503 and res.json()["error"]["code"] == "ai_provider_unavailable"


async def test_tool_arguments_written_by_the_model_are_validated_before_anything_runs(client, monkeypatch):
    headers, _ = await _demo(client)
    create = AsyncMock(side_effect=[
        _completion(content=None, tool_calls=[_tool_call("c1", "get_sales_metrics", '{"days": "30; DROP TABLE orders"}')], finish_reason="tool_calls"),
        _completion(content="I couldn't read that."),
    ])
    _use(monkeypatch, agent_service, create)
    body = await _say(client, headers, await _chat(client, headers), "How are my sales?")
    tool_msg = next(m for m in create.call_args_list[1].kwargs["messages"] if m["role"] == "tool")
    assert json.loads(tool_msg["content"]) == {"error": "invalid_arguments", "fields": ["days"]}  # refused, not executed, no data returned
    assert body["intent"] == "business_query"


async def test_the_same_mutation_asked_for_twice_in_one_turn_is_one_proposal(client, monkeypatch):
    headers, _ = await _demo(client)
    twice = _completion(content=None, tool_calls=[_tool_call("c1", "publish_storefront", "{}"), _tool_call("c2", "publish_storefront", "{}")], finish_reason="tool_calls")
    create = AsyncMock(side_effect=[twice, _completion(content="Proposed once.")])
    _use(monkeypatch, agent_service, create)
    await _say(client, headers, await _chat(client, headers), "Publish my store")
    async with AsyncSessionLocal() as db:
        assert (await db.execute(select(func.count()).select_from(ToolProposal).where(ToolProposal.tool_name == "publish_storefront"))).scalar_one() == 1
    second = [m for m in create.call_args_list[1].kwargs["messages"] if m["role"] == "tool"][1]
    assert json.loads(second["content"])["note"] == "duplicate_call_ignored"


async def test_multiple_tool_rounds_work_and_the_iteration_limit_stops_a_runaway_model(client, monkeypatch):
    headers, _ = await _demo(client)
    monkeypatch.setattr(agent_service.settings, "tool_loop_max_round_trips", 3)
    loop = AsyncMock(return_value=_completion(content=None, tool_calls=[_tool_call("c", "get_store_summary", "{}")], finish_reason="tool_calls"))
    _use(monkeypatch, agent_service, loop)
    body = await _say(client, headers, await _chat(client, headers), "How many products do I have?")
    assert body["hit_loop_cap"] is True and len(body["tool_call_log"]) == 3 and loop.await_count == 3  # bounded, and says it gave up
    two_rounds = AsyncMock(side_effect=[
        _completion(content=None, tool_calls=[_tool_call("a", "get_store_summary", "{}")], finish_reason="tool_calls"),
        _completion(content=None, tool_calls=[_tool_call("b", "get_low_stock_products", "{}")], finish_reason="tool_calls"),
        _completion(content="Done."),
    ])
    _use(monkeypatch, agent_service, two_rounds)
    ok = await _say(client, headers, await _chat(client, headers), "How many products do I have, and how many are low?")
    assert ok["hit_loop_cap"] is False and [t["name"] for t in ok["tool_call_log"]] == ["get_store_summary", "get_low_stock_products"] and ok["assistant_text"] == "Done."


async def test_the_model_cannot_name_another_tenant_the_tools_take_no_org_argument(client, monkeypatch):
    headers, _ = await _demo(client)
    create = AsyncMock(side_effect=[
        _completion(content=None, tool_calls=[_tool_call("c1", "get_low_stock_products", json.dumps({"org_id": str(uuid.uuid4())}))], finish_reason="tool_calls"),
        _completion(content="Here you go."),
    ])
    _use(monkeypatch, agent_service, create)
    await _say(client, headers, await _chat(client, headers), "How many products are low on stock?")
    tool_msg = next(m for m in create.call_args_list[1].kwargs["messages"] if m["role"] == "tool")
    titles = {r["title"] for r in json.loads(tool_msg["content"])["low_stock_products"]}
    assert titles == {"Structured Tote", "City Crossbody", "Bifold Wallet"}  # the caller's own tenant, whatever the model wrote
    schemas = {t["function"]["name"]: t["function"]["parameters"] for t in create.call_args_list[0].kwargs["tools"]}
    assert "org_id" not in json.dumps(schemas)  # tenant identity is not even part of what the model is shown


async def test_logs_for_a_real_provider_request_carry_metadata_only(monkeypatch):
    from structlog.testing import capture_logs

    p = _provider(AsyncMock(return_value=_completion(content="Confidential reply text")))
    with capture_logs() as logs:
        await p.step(system_prompt="SECRET SYSTEM PROMPT", context={"k": "v"}, messages=["private customer message"], tool_results=[], available_tools=[])
    blob = json.dumps(logs, default=str)
    assert "ai.request" in blob and "nvidia/test-model" in blob
    for private in ("SECRET SYSTEM PROMPT", "private customer message", "Confidential reply text", SECRET):
        assert private not in blob


def test_the_fake_provider_stays_deterministic():
    import asyncio

    async def run():
        out = []
        for _ in range(2):
            r = await FakeLLMProvider().step(system_prompt="always-available assistant", context={"intent": "small_talk"}, messages=["Hey NOVA"], tool_results=[], available_tools=[])
            out.append(r.final.text)
        return out

    a, b = asyncio.run(run())
    assert a == b and a
