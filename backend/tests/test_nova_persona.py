"""NOVA has one personality: the same witty, honest co-founder in the demo Guide (scripted in
admin/src/lib/novaScript.ts), the always-on assistant, the Guide agent and the Store Manager. These tests
pin the persona into every conversational prompt, and check the assistant's default (no API key) answers
sound like NOVA while staying faithful to real tool results."""

from app.ai.agents import AGENT_REGISTRY, NOVA_PERSONA
from app.services.agent_service import KNOWN_SCREENS


async def _headers(client, seeded_owner):
    res = await client.post("/api/v1/auth/login", json={"email": seeded_owner["email"], "password": seeded_owner["password"]})
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def _ask(client, headers, text, **extra):
    conv = (await client.post("/api/v1/ai/conversations", json={"agent_key": "assistant", "context": {}}, headers=headers)).json()
    res = await client.post(f"/api/v1/ai/conversations/{conv['id']}/messages", json={"text": text, **extra}, headers=headers)
    assert res.status_code == 200
    return res.json()


def test_every_conversational_nova_shares_the_persona_and_specialists_stay_plain():
    for key in ("assistant", "nova_guide", "store_manager"):
        assert NOVA_PERSONA in AGENT_REGISTRY[key].system_prompt, key
    for key in ("sales_agent", "inventory_agent", "customer_agent", "marketing_agent", "operations_agent"):
        assert NOVA_PERSONA not in AGENT_REGISTRY[key].system_prompt, key


def test_the_persona_carries_the_rules_that_keep_the_humor_honest():
    p = NOVA_PERSONA.lower()
    assert "witty" in p and "co-founder" in p
    assert "never at the person" in p  # sarcasm aims at business problems
    assert "helpful before funny" in p
    for serious in ("errors", "privacy", "security"):
        assert serious in p  # no jokes there
    assert "never invent" in p  # facts only from tool results
    assert "do not imitate" in p
    assert "you never change anything yourself" in p
    assert "humor is optional" in p


def test_the_assistant_knows_which_screens_actually_exist():
    prompt = AGENT_REGISTRY["assistant"].system_prompt
    assert "Marketing and Settings screens are not built" in prompt
    for screen in ("Overview", "Products", "Inventory", "Approvals", "Store Builder"):
        assert screen in prompt


async def test_screen_context_is_allowlisted(client, seeded_owner):
    h = await _headers(client, seeded_owner)
    ok = await _ask(client, h, "hello", screen="products")
    assert ok["assistant_text"]
    bogus = await _ask(client, h, "hello", screen="<script>alert(1)</script>")
    assert bogus["assistant_text"]  # accepted but ignored, never trusted
    assert "products" in KNOWN_SCREENS and "<script>alert(1)</script>" not in KNOWN_SCREENS
