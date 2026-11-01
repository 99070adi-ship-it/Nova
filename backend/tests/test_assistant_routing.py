"""The persistent assistant answers the user's ACTUAL message. These tests go through the real path (HTTP ->
conversation endpoint -> intent router -> prompt/tool assembly -> provider -> tools -> reply), against the
same VELORA-style brand profile that used to hijack every answer.

Root cause being guarded: the assistant had no intent routing. With the default (fake) provider, any message
that was not an exact greeting fell through to "call the first read-only tool", which was get_brand_profile,
so "How are you?" came back as "You're building VELORA" (or "I don't have a brand profile yet")."""

import re

import pytest

from app.ai import assistant_fake
from app.ai.fake_provider import FakeLLMProvider
from app.ai.intent import Intent, classify
from app.ai.product_help import ARTICLES
from app.ai.provider import AssistantMessage
from app.services import agent_service

OFF_TOPIC = re.compile(r"velora|onboarding|brand|you're building|you are building|create my store", re.I)


async def _headers(client, owner):
    res = await client.post("/api/v1/auth/login", json={"email": owner["email"], "password": owner["password"]})
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def _with_velora_brand(client, headers):
    """The setup that used to poison every answer: a saved VELORA brand profile and an active onboarding."""
    await client.post("/api/v1/store-creation/start", headers=headers)
    res = await client.put(
        "/api/v1/store-creation/brand-input",
        json={"name": "Velora", "sells_what": "handbags and leather accessories", "vibe_text": "quiet luxury"},
        headers=headers,
    )
    assert res.status_code == 200


async def _chat(client, headers, agent="assistant"):
    res = await client.post("/api/v1/ai/conversations", json={"agent_key": agent, "context": {}}, headers=headers)
    return res.json()["id"]


async def _say(client, headers, conversation_id, text, **extra):
    res = await client.post(f"/api/v1/ai/conversations/{conversation_id}/messages", json={"text": text, **extra}, headers=headers)
    assert res.status_code == 200, res.text
    return res.json()


# ---- the router itself ----

@pytest.mark.parametrize(
    "message,intent",
    [
        ("Hey NOVA.", Intent.small_talk), ("Hey NOVA, how are you?", Intent.small_talk), ("hi nova how are you doing today", Intent.small_talk), ("hello", Intent.small_talk), ("How are you?", Intent.small_talk),
        ("how are you doing today", Intent.small_talk), ("What's up?", Intent.small_talk), ("Thanks!", Intent.small_talk),
        ("thank you so much", Intent.small_talk), ("Tell me a joke.", Intent.small_talk), ("good night", Intent.small_talk),
        ("lol", Intent.small_talk), ("Who are you?", Intent.small_talk),
        ("What can you help me with?", Intent.product_help), ("How do I edit my homepage?", Intent.product_help),
        ("how do I see my sales", Intent.product_help), ("Where do I approve things?", Intent.product_help),
        ("What is the difference between draft and live?", Intent.product_help),
        ("How many products are low on stock?", Intent.business_query), ("What are my top selling products?", Intent.business_query),
        ("how is my store doing", Intent.business_query), ("Do I have any customers who stopped buying?", Intent.business_query),
        ("Make my homepage more premium", Intent.action_request), ("Publish my store", Intent.action_request),
        ("Write a better description for the tote", Intent.action_request),
        ("My products aren't showing", Intent.troubleshooting), ("I can't see my orders", Intent.troubleshooting),
        ("the page is broken", Intent.troubleshooting), ("blah", Intent.ambiguous),
    ],
)
def test_the_router_classifies_obvious_messages(message, intent):
    assert classify(message).intent is intent


def test_a_greeting_with_a_real_question_is_not_small_talk():
    # Small talk is matched on the WHOLE message, so a question tucked after a greeting still gets its answer.
    assert classify("How are you? Also how many orders do I have?").intent is Intent.business_query
    assert classify("hey, how do I publish?").intent is Intent.product_help


def test_a_short_follow_up_inherits_the_previous_real_question():
    prior = ["How many products are low on stock?"]
    routed = classify("Can you explain that?", prior)
    assert (routed.intent, routed.topic, routed.follow_up) == (Intent.business_query, "low_stock", True)
    # Small talk in between does not become the thing being explained.
    assert classify("what do you mean", ["How do I edit my homepage?", "thanks"]).intent is Intent.product_help
    assert classify("explain that", []).intent is Intent.ambiguous  # nothing to refer to


# ---- the actual failure mode, end to end ----

async def test_how_are_you_is_answered_conversationally_with_no_tools_and_no_brand(client, seeded_owner):
    h = await _headers(client, seeded_owner)
    await _with_velora_brand(client, h)  # the old bug answered "You're building Velora..." here
    chat = await _chat(client, h)
    body = await _say(client, h, chat, "How are you?")
    assert body["intent"] == "small_talk"
    assert body["tool_call_log"] == []  # no brand, inventory, sales or any other lookup
    assert not OFF_TOPIC.search(body["assistant_text"]), body["assistant_text"]
    assert "?" in body["assistant_text"]  # it asks how you are, like a person


async def test_the_exact_conversation_from_the_bug_report(client, seeded_owner):
    h = await _headers(client, seeded_owner)
    await _with_velora_brand(client, h)
    chat = await _chat(client, h)
    seen = []
    for text in ["Hey NOVA.", "How are you?", "Tell me a joke.", "What can you help me with?"]:
        body = await _say(client, h, chat, text, screen="create-store")
        seen.append(body["assistant_text"])
        assert not OFF_TOPIC.search(body["assistant_text"].replace("create my store", "")) or text == "What can you help me with?"
        assert body["tool_call_log"] == []
    assert len(set(seen)) == len(seen)  # four different answers, not one repeated reply


async def test_hey_nova_gets_a_greeting(client, seeded_owner):
    h = await _headers(client, seeded_owner)
    body = await _say(client, h, await _chat(client, h), "Hey NOVA")
    assert body["intent"] == "small_talk" and body["tool_call_log"] == []
    assert re.search(r"\bhey\b|\bhi\b|good to see you|hello", body["assistant_text"], re.I)


async def test_thanks_gets_a_natural_acknowledgement(client, seeded_owner):
    h = await _headers(client, seeded_owner)
    body = await _say(client, h, await _chat(client, h), "Thanks!")
    assert body["intent"] == "small_talk" and body["tool_call_log"] == []
    assert re.search(r"anytime|happy to help|you got it", body["assistant_text"], re.I)


async def test_tell_me_a_joke_tells_a_joke_and_does_not_explain_onboarding(client, seeded_owner):
    h = await _headers(client, seeded_owner)
    await _with_velora_brand(client, h)
    body = await _say(client, h, await _chat(client, h), "Tell me a joke")
    assert body["assistant_text"] in assistant_fake._JOKES
    assert body["tool_call_log"] == [] and not OFF_TOPIC.search(body["assistant_text"])


async def test_how_do_i_edit_my_homepage_gives_relevant_product_help(client, seeded_owner):
    h = await _headers(client, seeded_owner)
    body = await _say(client, h, await _chat(client, h), "How do I edit my homepage?")
    assert body["intent"] == "product_help"
    assert body["tool_call_log"] == []  # help comes from the product knowledge, not a data lookup
    text = body["assistant_text"]
    assert "Store Builder" in text and "Propose" in text and "Apply to draft" in text
    assert "live" in text.lower()  # and that nothing goes live until publish


async def test_what_can_you_help_me_with_lists_real_capabilities(client, seeded_owner):
    h = await _headers(client, seeded_owner)
    body = await _say(client, h, await _chat(client, h), "What can you help me with?")
    assert body["intent"] == "product_help" and body["tool_call_log"] == []
    assert "approval" in body["assistant_text"].lower()


async def test_low_stock_question_queries_the_real_tenant_scoped_data(client, seeded_owner):
    from app.db.models import Organization
    from app.db.session import AsyncSessionLocal
    from app.schemas.product import ProductCreate, VariantIn
    from app.services import product_service

    async with AsyncSessionLocal() as db:
        # A new variant starts with no stock, which is at or below its threshold.
        await product_service.create_product(
            db, seeded_owner["org_id"], ProductCreate(title="Structured Tote", slug="structured-tote", variants=[VariantIn(sku="ST-1", price=320)]),
        )
        other = Organization(name="Other Org", slug="other-org-routing")
        db.add(other)
        await db.flush()
        await db.commit()
        await product_service.create_product(
            db, other.id, ProductCreate(title="Someone Else's Clutch", slug="their-clutch", variants=[VariantIn(sku="TH-1", price=99)]),
        )
    h = await _headers(client, seeded_owner)
    body = await _say(client, h, await _chat(client, h), "How many products are low on stock?")
    assert body["intent"] == "business_query"
    names = [t["name"] for t in body["tool_call_log"]]
    assert names == ["get_low_stock_products"] and not body["tool_call_log"][0]["is_mutating"]
    assert "Structured Tote" in body["assistant_text"]
    assert "Someone Else's Clutch" not in body["assistant_text"]  # tenant isolation holds through the assistant


async def test_a_store_numbers_question_with_nothing_low_says_so_without_inventing_problems(client, seeded_owner):
    h = await _headers(client, seeded_owner)
    body = await _say(client, h, await _chat(client, h), "Which products are running low?")
    assert body["tool_call_log"][0]["name"] == "get_low_stock_products"
    assert "Nothing is at or below" in body["assistant_text"]


async def test_make_my_homepage_more_premium_enters_the_change_plan_workflow_without_changing_anything(client, seeded_owner):
    h = await _headers(client, seeded_owner)
    await _with_velora_brand(client, h)
    before = (await client.get("/api/v1/storefront/draft", headers=h)).json()
    body = await _say(client, h, await _chat(client, h), "Make my homepage more premium")
    assert body["intent"] == "action_request"
    log = body["tool_call_log"]
    assert [t["name"] for t in log] == ["propose_change_plan"] and log[0]["is_mutating"] is False
    text = body["assistant_text"]
    assert "Nothing has changed" in text or "couldn't turn that" in text
    after = (await client.get("/api/v1/storefront/draft", headers=h)).json()
    assert before["pages"][0]["sections"] == after["pages"][0]["sections"]  # approval gate preserved: nothing applied
    # The plan is a real, inspectable change-plan run, and it is not applied.
    plan_id = log[0]["arguments"]["agent_run_id"]
    assert plan_id


async def test_publish_request_becomes_a_proposal_that_waits_for_approval(client, seeded_owner):
    h = await _headers(client, seeded_owner)
    body = await _say(client, h, await _chat(client, h), "Publish my store")
    assert body["intent"] == "action_request"
    assert [t["name"] for t in body["tool_call_log"]] == ["publish_storefront"] and body["tool_call_log"][0]["is_mutating"] is True
    assert "Approvals" in body["assistant_text"] and "until you approve" in body["assistant_text"]
    pending = (await client.get("/api/v1/approvals?status=proposed", headers=h)).json()
    assert any(p["tool_name"] == "publish_storefront" for p in pending)


async def test_follow_up_explain_uses_the_conversation_history(client, seeded_owner):
    h = await _headers(client, seeded_owner)
    chat = await _chat(client, h)
    first = await _say(client, h, chat, "How do I edit my homepage?")
    follow = await _say(client, h, chat, "Can you explain that?")
    assert follow["tool_call_log"] == []
    assert follow["assistant_text"] != first["assistant_text"]
    assert "two safe steps" in follow["assistant_text"]  # the homepage article, in more detail

    data = await _say(client, h, chat, "How many products are low on stock?")
    why = await _say(client, h, chat, "what do you mean")
    assert data["tool_call_log"] and why["tool_call_log"] == []
    assert "low-stock threshold" in why["assistant_text"]


async def test_small_talk_between_questions_does_not_hijack_a_later_follow_up(client, seeded_owner):
    h = await _headers(client, seeded_owner)
    chat = await _chat(client, h)
    await _say(client, h, chat, "How do I publish?")
    await _say(client, h, chat, "thanks")
    follow = await _say(client, h, chat, "explain that more")
    assert "Preview" in follow["assistant_text"] or "draft" in follow["assistant_text"]


async def test_page_context_never_overrides_small_talk(client, seeded_owner):
    h = await _headers(client, seeded_owner)
    await _with_velora_brand(client, h)
    chat = await _chat(client, h)
    for screen in ("create-store", "overview", "products", "store-builder"):
        body = await _say(client, h, chat, "How are you?", screen=screen)
        assert body["intent"] == "small_talk" and body["tool_call_log"] == []
        assert not OFF_TOPIC.search(body["assistant_text"]) and screen not in body["assistant_text"]


async def test_troubleshooting_is_serious_and_practical(client, seeded_owner):
    h = await _headers(client, seeded_owner)
    body = await _say(client, h, await _chat(client, h), "My products aren't showing on the storefront", screen="products")
    assert body["intent"] == "troubleshooting" and body["tool_call_log"] == []
    text = body["assistant_text"]
    assert "What were you doing" in text and "Activity" in text
    assert not re.search(r"joke|haha|😎|lol", text, re.I) and "products" in text  # screen mentioned only as a relevance hint


async def test_unclear_messages_get_one_short_clarifying_question(client, seeded_owner):
    h = await _headers(client, seeded_owner)
    body = await _say(client, h, await _chat(client, h), "blah")
    assert body["intent"] == "ambiguous" and body["tool_call_log"] == []
    assert body["assistant_text"].count("?") == 1


# ---- prompt and tool assembly, as the provider actually receives them ----

class _Recorder(FakeLLMProvider):
    calls: list[dict] = []

    async def step(self, *, system_prompt, context, messages, tool_results, available_tools):
        type(self).calls.append({"context": dict(context), "messages": list(messages), "tools": [t["name"] for t in available_tools]})
        return await super().step(
            system_prompt=system_prompt, context=context, messages=messages, tool_results=tool_results, available_tools=available_tools,
        )


@pytest.fixture
def recorder(monkeypatch):
    _Recorder.calls = []
    monkeypatch.setattr(agent_service, "build_llm_provider", lambda *_a: _Recorder())
    return _Recorder


async def test_what_the_provider_receives_leads_with_intent_and_hides_page_context_from_small_talk(client, seeded_owner, recorder):
    h = await _headers(client, seeded_owner)
    chat = await _chat(client, h)
    await _say(client, h, chat, "How are you?", screen="create-store")
    small = recorder.calls[-1]
    assert small["context"]["intent"] == "small_talk" and small["tools"] == []
    assert "screen" not in small["context"] and "help_articles" not in small["context"]  # nothing to steer it back to the store

    await _say(client, h, chat, "How many products are low on stock?", screen="inventory")
    data = recorder.calls[-1]
    assert data["context"]["intent"] == "business_query" and data["context"]["screen"] == "inventory"  # a hint, for real questions
    assert set(data["tools"]) == {"get_store_summary", "get_low_stock_products", "get_sales_metrics", "get_customer_activity", "get_brand_profile"}
    assert not any(t in data["tools"] for t in ("publish_storefront", "update_product_content"))  # reading never offers writing

    await _say(client, h, chat, "Publish my store")
    act = recorder.calls[-1]
    assert act["context"]["intent"] == "action_request" and set(act["tools"]) == {"update_product_content", "publish_storefront"}


async def test_history_reaches_the_provider_with_roles_and_help_articles_are_evidence(client, seeded_owner, recorder):
    h = await _headers(client, seeded_owner)
    chat = await _chat(client, h)
    await _say(client, h, chat, "How do I edit my homepage?")
    help_call = recorder.calls[-1]
    assert help_call["context"]["help_articles"][0]["title"] == "Editing your homepage"
    await _say(client, h, chat, "Can you explain that?")
    follow = recorder.calls[-1]
    assert follow["context"]["follow_up"] is True and "Store Builder" in follow["context"]["previous_reply"]
    roles = ["assistant" if isinstance(m, AssistantMessage) else "user" for m in follow["messages"]]
    assert roles == ["user", "assistant", "user"]  # prior replies are assistant turns, not user turns


async def test_the_real_provider_maps_assistant_turns_to_the_assistant_role():
    from unittest.mock import AsyncMock

    from openai.types.chat import ChatCompletion, ChatCompletionMessage
    from openai.types.chat.chat_completion import Choice

    from app.ai.openai_compatible_provider import OpenAICompatibleProvider

    provider = OpenAICompatibleProvider(api_key="sk-test", base_url=None, chat_model="m")
    done = ChatCompletion(
        id="c", object="chat.completion", created=1, model="m",
        choices=[Choice(index=0, finish_reason="stop", message=ChatCompletionMessage(role="assistant", content="ok"))],
    )
    provider._client.chat.completions.create = AsyncMock(return_value=done)
    await provider.step(
        system_prompt="s", context={"intent": "product_help"},
        messages=["How do I publish?", AssistantMessage("Use Store Builder."), "Can you explain that?"],
        tool_results=[], available_tools=[],
    )
    roles = [m["role"] for m in provider._client.chat.completions.create.call_args.kwargs["messages"]]
    assert roles == ["system", "user", "user", "assistant", "user"]  # system, context, then the real turns


# ---- the tutorial is unaffected ----

async def test_the_guide_agent_is_not_routed_and_still_reads_onboarding_progress(client, seeded_owner):
    h = await _headers(client, seeded_owner)
    chat = await _chat(client, h, agent="nova_guide")
    body = await _say(client, h, chat, "Where am I in the tour?")
    assert body["intent"] is None  # routing is the persistent assistant's, not the tutorial's
    assert body["tool_call_log"][0]["name"] == "get_onboarding_progress"
    assert "Tell NOVA about your business" in body["assistant_text"]


def test_every_help_article_is_reachable_and_carries_a_short_and_a_detailed_version():
    assert len({a.id for a in ARTICLES}) == len(ARTICLES)
    for a in ARTICLES:
        assert 40 < len(a.short) < 400 and len(a.detail) > len(a.short) * 0.6 and "velora" not in (a.short + a.detail).lower()
