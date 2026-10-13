import uuid

from app.ai.agents import DELEGATABLE_AGENT_KEYS


async def _auth_headers(client, seeded_owner):
    res = await client.post("/api/v1/auth/login", json={"email": seeded_owner["email"], "password": seeded_owner["password"]})
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def _status_by_key(progress: dict) -> dict:
    return {s["key"]: s["status"] for s in progress["steps"]}


async def _get_progress(client, headers):
    res = await client.get("/api/v1/onboarding/progress", headers=headers)
    return _status_by_key(res.json()), res.json()["current_step"]


async def _advance_to_nl_edit_step(client, headers) -> None:
    """Shared setup for the nl_edit-apply-gating tests below — walks through every prior step
    (already individually verified by test_progress_advances_step_by_step_through_the_real_flow
    above) without re-asserting each one, just to reach "nl_edit available" quickly."""
    await client.post("/api/v1/store-creation/start", headers=headers)
    await client.put("/api/v1/store-creation/brand-input", json={"name": "Aurora Goods"}, headers=headers)
    draft_res = await client.post(
        "/api/v1/store-creation/product-drafts",
        json={"title": "Aurora Tote", "price": 128, "sku": "AUR-TOTE-1"},
        headers=headers,
    )
    draft_id = draft_res.json()["id"]
    await client.post(f"/api/v1/store-creation/product-drafts/{draft_id}/generate", headers=headers)
    await client.post(f"/api/v1/store-creation/product-drafts/{draft_id}/accept", headers=headers)
    await client.post("/api/v1/collections", json={"title": "New Arrivals", "slug": "new-arrivals"}, headers=headers)
    await client.post("/api/v1/store-creation/generate-storefront", headers=headers)
    await _load_draft_preview(client, headers)


async def _load_draft_preview(client, headers) -> str:
    """What the storefront app does once the draft preview has rendered: tell the server."""
    draft_id = (await client.get("/api/v1/storefront/draft", headers=headers)).json()["id"]
    res = await client.post(f"/api/v1/public/preview/{draft_id}/loaded")
    assert res.status_code == 204
    return draft_id


async def test_progress_starts_all_locked_except_brand(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    res = await client.get("/api/v1/onboarding/progress", headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert body["current_step"] == "brand"
    assert body["intro_video_seen"] is False
    statuses = _status_by_key(body)
    assert statuses["brand"] == "available"
    assert statuses["products"] == "locked"
    assert statuses["run_business"] == "locked"


async def test_intro_video_seen_is_one_shot_and_persists(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    res = await client.post("/api/v1/onboarding/intro-video-seen", headers=headers)
    assert res.status_code == 200
    assert res.json()["intro_video_seen"] is True

    # A fresh GET (simulating a page refresh) must still show it as seen.
    again = await client.get("/api/v1/onboarding/progress", headers=headers)
    assert again.json()["intro_video_seen"] is True


async def test_progress_advances_step_by_step_through_the_real_flow(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)

    async def progress():
        res = await client.get("/api/v1/onboarding/progress", headers=headers)
        return _status_by_key(res.json()), res.json()["current_step"]

    statuses, current = await progress()
    assert current == "brand"
    assert statuses["brand"] == "available"

    # Step 1 — brand.
    await client.post("/api/v1/store-creation/start", headers=headers)
    await client.put("/api/v1/store-creation/brand-input", json={"name": "Aurora Goods"}, headers=headers)
    statuses, current = await progress()
    assert statuses["brand"] == "completed"
    assert current == "products"

    # Step 2 — products.
    draft_res = await client.post(
        "/api/v1/store-creation/product-drafts",
        json={"title": "Aurora Tote", "price": 128, "sku": "AUR-TOTE-1"},
        headers=headers,
    )
    draft_id = draft_res.json()["id"]
    statuses, current = await progress()
    assert statuses["products"] == "completed"
    assert current == "catalog"

    # Step 3 — NOVA generates content.
    await client.post(f"/api/v1/store-creation/product-drafts/{draft_id}/generate", headers=headers)
    statuses, current = await progress()
    assert statuses["catalog"] == "completed"
    assert current == "review"

    # Step 4 — owner resolves the draft.
    await client.post(f"/api/v1/store-creation/product-drafts/{draft_id}/accept", headers=headers)
    statuses, current = await progress()
    assert statuses["review"] == "completed"
    assert current == "collections"

    # Step 5 — collections.
    await client.post(
        "/api/v1/collections", json={"title": "New Arrivals", "slug": "new-arrivals"}, headers=headers
    )
    statuses, current = await progress()
    assert statuses["collections"] == "completed"
    assert current == "storefront"

    # Step 6 — storefront draft generated. Preview is its own step: generating alone must not complete it.
    await client.post("/api/v1/store-creation/generate-storefront", headers=headers)
    statuses, current = await progress()
    assert statuses["storefront"] == "completed"
    assert statuses["preview"] == "available"
    assert current == "preview"

    # Step 7 — preview: only the recorded "preview loaded" event completes it.
    await _load_draft_preview(client, headers)
    statuses, current = await progress()
    assert statuses["preview"] == "completed"
    assert current == "nl_edit"

    # Step 8 — natural-language change plan: proposing alone must NOT complete this step.
    propose_res = await client.post(
        "/api/v1/storefront/change-plan", json={"instruction": "add a story about us"}, headers=headers
    )
    statuses, current = await progress()
    assert statuses["nl_edit"] == "available"
    assert current == "nl_edit"

    # Only actually applying the plan completes it.
    agent_run_id = propose_res.json()["agent_run_id"]
    await client.post(f"/api/v1/storefront/change-plan/{agent_run_id}/apply", headers=headers)
    statuses, current = await progress()
    assert statuses["nl_edit"] == "completed"
    assert current == "publish"

    # Step 9 — publish.
    await client.post("/api/v1/storefront/publish", headers=headers)
    statuses, current = await progress()
    assert statuses["publish"] == "completed"
    assert current == "run_business"

    # Step 10 — run the business: both a Store Manager health run AND an action plan are required.
    await client.post("/api/v1/store-manager/health", headers=headers)
    statuses, current = await progress()
    assert statuses["run_business"] == "available"
    assert current == "run_business"

    await client.post("/api/v1/store-manager/action-plan", headers=headers)
    statuses, current = await progress()
    assert statuses["run_business"] == "completed"
    assert current is None


async def test_nl_edit_proposing_alone_never_completes_the_step(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    await _advance_to_nl_edit_step(client, headers)

    await client.post(
        "/api/v1/storefront/change-plan", json={"instruction": "make the hero feel more premium"}, headers=headers
    )
    statuses, current = await _get_progress(client, headers)
    assert statuses["nl_edit"] == "available"
    assert current == "nl_edit"

    # Proposing a SECOND time (e.g. the owner revises their instruction) still doesn't complete
    # it — only an actual apply does.
    await client.post(
        "/api/v1/storefront/change-plan", json={"instruction": "try again, warmer tone"}, headers=headers
    )
    statuses, current = await _get_progress(client, headers)
    assert statuses["nl_edit"] == "available"
    assert current == "nl_edit"


async def test_nl_edit_a_failed_apply_leaves_the_step_incomplete(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    await _advance_to_nl_edit_step(client, headers)

    await client.post(
        "/api/v1/storefront/change-plan", json={"instruction": "make the hero feel more premium"}, headers=headers
    )
    statuses, _ = await _get_progress(client, headers)
    assert statuses["nl_edit"] == "available"

    # Applying a run that doesn't exist (or doesn't belong to this org) must fail, not silently
    # count as success.
    bogus_run_id = str(uuid.uuid4())
    fail_res = await client.post(f"/api/v1/storefront/change-plan/{bogus_run_id}/apply", headers=headers)
    assert fail_res.status_code >= 400

    statuses, current = await _get_progress(client, headers)
    assert statuses["nl_edit"] == "available"
    assert current == "nl_edit"


async def test_nl_edit_a_successful_apply_completes_the_step(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)
    await _advance_to_nl_edit_step(client, headers)

    propose_res = await client.post(
        "/api/v1/storefront/change-plan", json={"instruction": "make the hero feel more premium"}, headers=headers
    )
    agent_run_id = propose_res.json()["agent_run_id"]

    apply_res = await client.post(f"/api/v1/storefront/change-plan/{agent_run_id}/apply", headers=headers)
    assert apply_res.status_code == 200

    statuses, current = await _get_progress(client, headers)
    assert statuses["nl_edit"] == "completed"
    assert current == "publish"


async def test_nl_edit_refreshing_or_navigating_away_never_falsely_completes_the_step(client, seeded_owner):
    # Re-querying progress repeatedly (simulating a page refresh / navigating to another page and
    # back) must never advance the step on its own — only the real backend mutation does.
    headers = await _auth_headers(client, seeded_owner)
    await _advance_to_nl_edit_step(client, headers)

    await client.post(
        "/api/v1/storefront/change-plan", json={"instruction": "make the hero feel more premium"}, headers=headers
    )
    for _ in range(5):
        statuses, current = await _get_progress(client, headers)
        assert statuses["nl_edit"] == "available"
        assert current == "nl_edit"


async def test_nova_guide_is_a_real_agent_that_reads_real_progress(client, seeded_owner):
    headers = await _auth_headers(client, seeded_owner)

    start_res = await client.post(
        "/api/v1/ai/conversations", json={"agent_key": "nova_guide", "context": {}}, headers=headers
    )
    assert start_res.status_code == 201
    conversation_id = start_res.json()["id"]

    msg_res = await client.post(
        f"/api/v1/ai/conversations/{conversation_id}/messages",
        json={"text": "What should I do next?"},
        headers=headers,
    )
    assert msg_res.status_code == 200
    body = msg_res.json()
    # A real tool round trip happened — not a hardcoded tooltip engine — and it never mutates.
    assert body["tool_call_log"][0]["name"] == "get_onboarding_progress"
    assert body["tool_call_log"][0]["is_mutating"] is False
    # Deterministic plain-English narration, not a raw dict repr of the tool result — a "Guide"
    # that echoes {'current_step': 'brand', 'steps': [...]} defeats the point of narrating.
    assert "current_step" not in body["assistant_text"]
    assert "Tell NOVA about your business" in body["assistant_text"]


async def test_nova_guide_lesson_narration_prompts_bypass_the_generic_tool_call(client, seeded_owner):
    # The NOVA 2.0 Guide redesign's demo/explain/complete narration calls (FirstProductLesson.tsx)
    # send a fixed prompt per phase and must get phase-appropriate text back — not nova_guide's
    # usual auto-triggered get_onboarding_progress tool call overriding every fresh message.
    headers = await _auth_headers(client, seeded_owner)
    start_res = await client.post(
        "/api/v1/ai/conversations", json={"agent_key": "nova_guide", "context": {}}, headers=headers
    )
    conversation_id = start_res.json()["id"]

    demo_res = await client.post(
        f"/api/v1/ai/conversations/{conversation_id}/messages",
        json={"text": "I'm about to demonstrate adding a product. Narrate what you're about to show me and why, in one or two sentences."},
        headers=headers,
    )
    assert demo_res.status_code == 200
    assert demo_res.json()["tool_call_log"] == []
    assert "Watch me first" in demo_res.json()["assistant_text"]

    explain_res = await client.post(
        f"/api/v1/ai/conversations/{conversation_id}/messages",
        json={"text": "Explain briefly what you just showed me and why NOVA tracks known vs AI-suggested fields separately."},
        headers=headers,
    )
    assert "actually know" in explain_res.json()["assistant_text"].lower()

    complete_res = await client.post(
        f"/api/v1/ai/conversations/{conversation_id}/messages",
        json={"text": "The user just added their own product successfully. Congratulate them briefly and tell them what's next."},
        headers=headers,
    )
    assert "Nicely done" in complete_res.json()["assistant_text"]


async def test_nova_guide_lesson_narration_is_implemented_for_every_lesson_not_just_products(client, seeded_owner):
    # Regression for the bug browser QA found: _synthesize_lesson_narration only ever recognized
    # the "products" lesson's three prompts. Every other lesson's demo/explain/complete call fell
    # through to the generic get_onboarding_progress tool-call path, which answers a completely
    # different question than what the lesson actually asked — the Guide would demonstrate
    # nothing and show no real explanation for 7 of the app's 8 onboarding lessons. Exact prompt
    # text copied from admin/src/lib/novaLessons.ts; "products" itself is covered by
    # test_nova_guide_lesson_narration_prompts_bypass_the_generic_tool_call above.
    headers = await _auth_headers(client, seeded_owner)

    lessons = [
        (
            "I'm about to demonstrate describing a brand. Narrate what you're about to show me and why, in one or two sentences.",
            "Explain briefly what you just showed me and why NOVA needs this to generate a storefront that actually fits the brand.",
            "The user just described their brand successfully. Congratulate them briefly and tell them what's next.",
            "velora", "brand's identity", "brand identity is saved",
        ),
        (
            "I'm about to show the user how to have NOVA generate content for their new product. Narrate it briefly.",
            "Explain briefly what generating content does — NOVA writes a description and SEO copy, but price and SKU stay exactly as the owner typed them.",
            "NOVA just generated content for the user's product. Congratulate them briefly and tell them what's next.",
            "generate content", "price and sku", "generated real content",
        ),
        (
            "I'm about to show the user how to review and accept NOVA's generated content. Narrate it briefly.",
            "Explain briefly why the owner reviews and accepts AI-generated content before it becomes a real product.",
            "The user just accepted their product. Congratulate them briefly and tell them what's next.",
            "accept", "nothing becomes final", "real product in your catalog",
        ),
        (
            "I'm about to show the user how to have NOVA generate their storefront. Narrate it briefly.",
            "Explain briefly that NOVA is about to build a homepage from their brand and accepted products, and that they can still edit everything afterward.",
            "NOVA just generated the user's storefront. Congratulate them briefly and tell them what's next.",
            "generate storefront", "store builder", "storefront draft now exists",
        ),
        (
            "I'm about to show the user how to ask NOVA to change their storefront in plain language. Narrate it briefly.",
            "Explain briefly that NOVA proposes a change plan first — nothing customers see changes until the owner reviews it and explicitly applies it to the draft themselves. Tell them to press Propose, read what NOVA plans to change, then press Apply to draft once they're happy with it.",
            "The user just reviewed and applied NOVA's proposed storefront change. Congratulate them briefly and tell them what's next.",
            "propose", "apply to draft", "change is now on your draft",
        ),
        (
            "I'm about to show the user how to publish their storefront live. Narrate it briefly.",
            "Explain briefly that publishing is the one step that makes the draft visible to real customers.",
            "The user just published their store. Congratulate them briefly and tell them what's next.",
            "publish", "customers only ever see", "velora is live",
        ),
        (
            "I'm about to show the user how NOVA checks on how their store is doing. Narrate it briefly.",
            "Explain briefly that Store Manager delegates to Sales, Inventory, and Customer agents for a real read on the business, and that once results appear, 'Fix what you can' lets NOVA act on what it finds.",
            "The user just saw NOVA analyze their business and act on it. Congratulate them warmly — this is the end of the tour — and tell them NOVA is always available from the chat bubble for anything else.",
            "store manager", "fix what you can", "end of the guided tour",
        ),
    ]

    for demo_prompt, explain_prompt, complete_prompt, demo_substr, explain_substr, complete_substr in lessons:
        start_res = await client.post(
            "/api/v1/ai/conversations", json={"agent_key": "nova_guide", "context": {}}, headers=headers
        )
        conversation_id = start_res.json()["id"]

        demo_res = await client.post(
            f"/api/v1/ai/conversations/{conversation_id}/messages", json={"text": demo_prompt}, headers=headers
        )
        assert demo_res.status_code == 200
        assert demo_res.json()["tool_call_log"] == [], f"demo prompt fell through to a tool call: {demo_prompt!r}"
        assert demo_substr in demo_res.json()["assistant_text"].lower(), demo_res.json()["assistant_text"]

        explain_res = await client.post(
            f"/api/v1/ai/conversations/{conversation_id}/messages", json={"text": explain_prompt}, headers=headers
        )
        assert explain_res.json()["tool_call_log"] == []
        assert explain_substr in explain_res.json()["assistant_text"].lower(), explain_res.json()["assistant_text"]

        complete_res = await client.post(
            f"/api/v1/ai/conversations/{conversation_id}/messages", json={"text": complete_prompt}, headers=headers
        )
        assert complete_res.json()["tool_call_log"] == []
        assert complete_substr in complete_res.json()["assistant_text"].lower(), complete_res.json()["assistant_text"]


async def test_nova_guide_is_not_delegatable_by_store_manager(client, seeded_owner):
    # Store Manager may only delegate to specialists — never to the onboarding guide itself
    # (ARCHITECTURE.md "Onboarding — the NOVA Guide": it narrates, it doesn't get orchestrated).
    assert "nova_guide" not in DELEGATABLE_AGENT_KEYS
