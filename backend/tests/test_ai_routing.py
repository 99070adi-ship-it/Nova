"""One language-model factory serves text chat AND every processing workflow; speech and images are separate systems.

These tests drive each real API path with AI_PROVIDER=nvidia and the OpenAI SDK mocked, and prove every language-model request goes to the
configured NVIDIA model through the same provider, that fake mode stays deterministic and makes no outbound calls, that a missing key
is visible on every path (never a quiet fall-back to fake), and that voice and images keep their own providers. No network, no key."""

import json
import pathlib
import re

import pytest

from app.ai import speech
from app.ai import status as ai_status
from app.ai.factory import build_image_provider, build_llm_provider
from app.ai.fake_provider import FakePlaceholderImageProvider
from app.config import get_settings
from tests.test_nvidia_provider import SECRET
from tests.test_openai_provider import _completion, _tool_call
from tests.test_preview_publish_baseline import _demo

BACKEND = pathlib.Path(__file__).resolve().parents[1]
MODEL = "nvidia/nemotron-3-super-120b-a12b"


@pytest.fixture
def sdk(monkeypatch):
    """Records every chat-completions request the OpenAI SDK would send (and to which base URL), returning scripted replies."""
    from openai.resources.chat.completions import AsyncCompletions

    calls: list[dict] = []
    replies: list = []

    async def fake_create(self, **kwargs):
        calls.append({"model": kwargs["model"], "base_url": str(self._client.base_url), "tools": bool(kwargs.get("tools"))})
        return replies.pop(0) if replies else _completion(content="ok")

    monkeypatch.setattr(AsyncCompletions, "create", fake_create)
    return calls, replies


def use_nvidia(monkeypatch, key=SECRET):
    s = get_settings()
    monkeypatch.setattr(s, "ai_provider", "nvidia")
    monkeypatch.setattr(s, "nvidia_api_key", key)
    monkeypatch.setattr(s, "nvidia_model", MODEL)


def only_nemotron(calls):
    assert calls, "expected at least one model request"
    assert {(c["model"], c["base_url"]) for c in calls} == {(MODEL, "https://integrate.api.nvidia.com/v1/")}


# ---- the audit, enforced ----

def _call_sites() -> set[str]:
    out = set()
    for f in (BACKEND / "app").rglob("*.py"):
        rel = f.relative_to(BACKEND).as_posix()
        if rel == "app/ai/factory.py":
            continue
        if re.search(r"(?<!def )build_llm_provider\(\)", f.read_text()):
            out.add(rel)
    return out


def test_every_language_model_call_site_goes_through_the_one_factory_and_is_accounted_for():
    assert _call_sites() == set(ai_status.LLM_CALL_SITES), "update app/ai/status.py LLM_CALL_SITES (and the docs) when AI call sites change"


def test_no_service_builds_a_provider_or_sdk_client_by_hand():
    allowed = {"app/ai/factory.py", "app/ai/openai_compatible_provider.py", "app/ai/fake_provider.py"}
    for f in (BACKEND / "app").rglob("*.py"):
        rel = f.relative_to(BACKEND).as_posix()
        if rel in allowed:
            continue
        src = f.read_text()
        assert not re.search(r"(OpenAICompatibleProvider|FakeLLMProvider|AsyncOpenAI|openai\.OpenAI)\(", src), rel


# ---- processing paths, each with AI_PROVIDER=nvidia ----

async def _chat(client, headers, agent="assistant"):
    return (await client.post("/api/v1/ai/conversations", json={"agent_key": agent, "context": {}}, headers=headers)).json()["id"]


async def test_text_chat_uses_nemotron(client, monkeypatch, sdk):
    calls, replies = sdk
    headers, _ = await _demo(client)
    use_nvidia(monkeypatch)
    replies.append(_completion(content="Hi!"))
    res = await client.post(f"/api/v1/ai/conversations/{await _chat(client, headers)}/messages", json={"text": "Hey NOVA"}, headers=headers)
    assert res.json()["assistant_text"] == "Hi!"
    only_nemotron(calls)


async def test_store_manager_health_runs_its_three_delegated_agents_on_nemotron(client, monkeypatch, sdk):
    calls, replies = sdk
    headers, _ = await _demo(client)
    use_nvidia(monkeypatch)
    for text in ("Sales summary.", "Inventory summary.", "Customer summary."):
        replies.append(_completion(content=None, tool_calls=[_tool_call("t", {"Sales summary.": "get_sales_metrics", "Inventory summary.": "get_low_stock_products", "Customer summary.": "get_customer_activity"}[text], "{}")], finish_reason="tool_calls"))
        replies.append(_completion(content=text))
    res = await client.post("/api/v1/store-manager/health", headers=headers)
    assert res.status_code == 200, res.text
    assert res.json()["narrative"] == {"sales_agent": "Sales summary.", "inventory_agent": "Inventory summary.", "customer_agent": "Customer summary."}
    assert len(calls) == 6
    only_nemotron(calls)


async def test_a_store_manager_conversation_delegating_to_a_specialist_stays_on_nemotron(client, monkeypatch, sdk):
    calls, replies = sdk
    headers, _ = await _demo(client)
    use_nvidia(monkeypatch)
    replies.extend([
        _completion(content=None, tool_calls=[_tool_call("d", "delegate_to_agent", json.dumps({"agent_key": "sales_agent", "instruction": "Summarize sales."}))], finish_reason="tool_calls"),
        _completion(content="Sales look fine."),  # the delegated specialist's own loop
        _completion(content="Sales look fine, per the Sales Agent."),
    ])
    res = await client.post(f"/api/v1/ai/conversations/{await _chat(client, headers, 'store_manager')}/messages", json={"text": "How are sales?"}, headers=headers)
    assert res.status_code == 200 and res.json()["tool_call_log"][0]["name"] == "delegate_to_agent"
    assert len(calls) == 3
    only_nemotron(calls)


async def test_product_content_storefront_generation_and_change_plans_use_nemotron(client, monkeypatch, sdk):
    calls, replies = sdk
    headers, _ = await _demo(client)
    # Set up under the fake provider, then switch.
    await client.post("/api/v1/store-creation/start", headers=headers)
    await client.put("/api/v1/store-creation/brand-input", json={"name": "Aurora Goods", "description": "Calm goods."}, headers=headers)
    draft = (await client.post("/api/v1/store-creation/product-drafts", json={"title": "Tote", "price": 99, "sku": "T-1"}, headers=headers)).json()
    use_nvidia(monkeypatch)

    replies.append(_completion(content=json.dumps({"description": "A calm tote.", "category": "Totes", "tags": ["tote"], "seo_title": "Tote | Aurora", "seo_description": "A calm tote."})))
    res = await client.post(f"/api/v1/store-creation/product-drafts/{draft['id']}/generate", headers=headers)
    assert res.status_code == 200, res.text
    assert res.json()["fields"]["description"] == "A calm tote."  # the model's words, not the rule-based text
    only_nemotron(calls)

    calls.clear()
    replies.append(_completion(content="{}"))  # a plan the validator will refuse: the request still went to Nemotron
    await client.post("/api/v1/store-creation/generate-storefront", headers=headers)
    only_nemotron(calls)

    calls.clear()
    replies.append(_completion(content=json.dumps([{"action": "none", "description": "Nothing to change."}])))
    res = await client.post("/api/v1/storefront/change-plan", json={"instruction": "make it premium"}, headers=headers)
    assert res.status_code == 201
    only_nemotron(calls)


async def test_click_to_edit_uses_nemotron(client, monkeypatch, sdk):
    calls, replies = sdk
    headers, _ = await _demo(client)
    draft = (await client.get("/api/v1/storefront/draft", headers=headers)).json()
    hero = next(s for p in draft["pages"] for s in p["sections"] if s["type"] == "hero")
    use_nvidia(monkeypatch)
    replies.append(_completion(content=json.dumps({"summary": "s", "reasoning": "r", "changes": [{"path": "headline", "value": "Written by the model"}]})))
    res = await client.post("/api/v1/storefront/element-edit/propose", headers=headers, json={
        "draft_id": draft["id"], "revision": draft["revision"], "section_id": hero["id"], "element": "hero.headline", "instruction": "rewrite"})
    assert res.status_code == 201 and res.json()["changes"][0]["proposed"] == "Written by the model"
    only_nemotron(calls)


async def test_the_status_probe_also_uses_the_configured_nemotron_model(client, monkeypatch, sdk):
    calls, replies = sdk
    headers, _ = await _demo(client)
    use_nvidia(monkeypatch)
    ai_status.reset_probe()
    replies.append(_completion(content="ok"))
    assert (await client.post("/api/v1/ai/status/probe", headers=headers)).json()["ready"] is True
    only_nemotron(calls)
    ai_status.reset_probe()


# ---- failure and fake behaviour are the same on every path ----

PATHS = [
    ("chat", "POST", "/api/v1/ai/conversations/{chat}/messages", {"text": "Hey NOVA"}),
    ("health", "POST", "/api/v1/store-manager/health", None),
    ("change-plan", "POST", "/api/v1/storefront/change-plan", {"instruction": "make it premium"}),
]


@pytest.mark.parametrize("name,method,path,body", PATHS)
async def test_a_missing_key_is_visible_on_every_path_and_never_falls_back_to_fake(client, monkeypatch, sdk, name, method, path, body):
    calls, _ = sdk
    headers, _ = await _demo(client)
    s = get_settings()
    monkeypatch.setattr(s, "ai_provider", "nvidia")
    monkeypatch.setattr(s, "nvidia_api_key", None)
    url = path.format(chat=await _chat(client, headers)) if "{chat}" in path else path
    res = await client.request(method, url, headers=headers, json=body)
    assert res.status_code == 503 and res.json()["error"]["code"] == "ai_not_configured", (name, res.text)
    assert calls == []  # nothing was sent anywhere


@pytest.mark.parametrize("name,method,path,body", PATHS)
async def test_fake_mode_is_deterministic_and_makes_no_outbound_model_calls(client, monkeypatch, sdk, name, method, path, body):
    calls, _ = sdk
    headers, _ = await _demo(client)
    monkeypatch.setattr(get_settings(), "ai_provider", "fake")
    url = path.format(chat=await _chat(client, headers)) if "{chat}" in path else path
    first = await client.request(method, url, headers=headers, json=body)
    assert first.status_code in (200, 201), (name, first.text)
    assert calls == []
    if name == "health":
        second = await client.request(method, url, headers=headers, json=body)
        assert first.json()["narrative"] == second.json()["narrative"]  # the double answers identically every time


# ---- voice and images are independent ----

async def test_selecting_nemotron_leaves_speech_and_images_on_their_own_providers(client, monkeypatch, sdk):
    headers, _ = await _demo(client)
    use_nvidia(monkeypatch)
    s = get_settings()
    monkeypatch.setattr(s, "tts_provider", "fake")
    monkeypatch.setattr(s, "image_provider", "fake")
    monkeypatch.setattr(speech, "_provider", None)
    body = (await client.get("/api/v1/ai/status", headers=headers)).json()
    caps = body["capabilities"]
    assert caps["text_chat"]["provider"] == caps["processing"]["provider"] == "nvidia" and caps["text_chat"]["model"] == MODEL == caps["processing"]["model"]
    assert caps["speech_output"]["provider"] == "fake" and caps["speech_output"]["setting"] == "TTS_PROVIDER"
    assert caps["image_generation"]["provider"] == "fake" and caps["image_generation"]["setting"] == "IMAGE_PROVIDER"
    assert caps["transcription"] == {"provider": None, "implemented": False, "note": caps["transcription"]["note"]}
    assert SECRET not in json.dumps(body)
    speech_res = await client.post("/api/v1/ai/speech", json={"text": "Hello."}, headers=headers)
    assert speech_res.status_code == 200 and speech_res.headers["content-type"] == "audio/wav"  # voice output works on its own
    assert isinstance(build_image_provider(), FakePlaceholderImageProvider)
    monkeypatch.setattr(speech, "_provider", None)


def test_a_selected_real_image_provider_is_reported_as_not_implemented_rather_than_hidden(monkeypatch):
    monkeypatch.setattr(get_settings(), "image_provider", "nvidia")
    caps = ai_status.capabilities()
    assert caps["image_generation"]["implemented"] is False and "placeholders are produced" in caps["image_generation"]["note"]
    assert isinstance(build_image_provider(), FakePlaceholderImageProvider)
    assert type(build_llm_provider()).__name__ == "FakeLLMProvider"  # the image setting never changes the text AI


def test_changing_the_text_ai_never_changes_voice_or_image_settings(monkeypatch):
    s = get_settings()
    before = (s.tts_provider, s.image_provider)
    monkeypatch.setattr(s, "ai_provider", "nvidia")
    monkeypatch.setattr(s, "nvidia_api_key", "placeholder")
    build_llm_provider()
    assert (s.tts_provider, s.image_provider) == before


def test_chat_can_use_its_own_nvidia_key_and_model_while_processing_keeps_nemotron_super(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "ai_provider", "nvidia")
    monkeypatch.setattr(s, "nvidia_api_key", "processing-key")
    monkeypatch.setattr(s, "nvidia_chat_api_key", "chat-key")
    monkeypatch.setattr(s, "nvidia_chat_model", "vendor/voice-agent")
    chat, processing = build_llm_provider("chat"), build_llm_provider()
    assert chat._chat_model == "vendor/voice-agent" and processing._chat_model == s.nvidia_model
    assert chat._client.api_key == "chat-key" and processing._client.api_key == "processing-key"
    caps = ai_status.capabilities()
    assert caps["text_chat"]["model"] == "vendor/voice-agent" and caps["text_chat"]["separate_from_processing"] is True
    assert caps["processing"]["model"] == s.nvidia_model


def test_chat_inherits_the_processing_settings_when_no_chat_overrides_are_set(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "ai_provider", "nvidia")
    monkeypatch.setattr(s, "nvidia_api_key", "k")
    for name in ("nvidia_chat_api_key", "nvidia_chat_model", "nvidia_chat_base_url"):
        monkeypatch.setattr(s, name, None)
    assert build_llm_provider("chat")._chat_model == s.nvidia_model
    assert ai_status.capabilities()["text_chat"]["separate_from_processing"] is False
