"""Click-to-edit in Store Builder: a validated, reviewable, draft-only change to one element. These go through the real
HTTP path (auth, tenant resolution, registry validation, provider, persistence, audit)."""

import json
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

import app.services.storefront_element_service as svc
from app.ai.fake_provider import FakeLLMProvider
from app.ai.provider import ProviderFinal, ProviderStepResult
from app.db.models import AuditLog
from app.db.session import AsyncSessionLocal
from app.main import app
from app.services.storefront_registry import REGISTRY, SECTION_TYPES, public_registry
from tests.test_preview_publish_baseline import _demo


async def _draft(client, headers):
    return (await client.get("/api/v1/storefront/draft", headers=headers)).json()


def _section(draft, type_, page="home"):
    return next(s for p in draft["pages"] if p["slug"] == page for s in p["sections"] if s["type"] == type_)


async def _propose(client, headers, draft, section, element, instruction, revision=None):
    return await client.post("/api/v1/storefront/element-edit/propose", headers=headers, json={
        "draft_id": draft["id"], "revision": revision or draft["revision"], "section_id": section["id"] if section else None,
        "element": element, "instruction": instruction,
    })


class _Scripted(FakeLLMProvider):
    """A model that answers exactly what the test says (including hostile answers)."""

    answer: str = "{}"

    async def step(self, **kwargs):
        return ProviderStepResult(final=ProviderFinal(text=type(self).answer))


@pytest.fixture
def scripted(monkeypatch):
    def use(payload) -> None:
        _Scripted.answer = payload if isinstance(payload, str) else json.dumps(payload)
        monkeypatch.setattr(svc, "build_llm_provider", lambda *_a: _Scripted())

    return use


async def _live(client, slug):
    return (await client.get(f"/api/v1/public/stores/{slug}/storefront")).json()


# ---- the registry ----

def test_every_registry_element_maps_to_a_real_section_type_and_has_typed_validated_properties():
    assert SECTION_TYPES == ("hero", "product_grid", "collection_grid", "feature_banner", "brand_story")
    for key, el in REGISTRY.items():
        assert key.split(".")[0] in (*SECTION_TYPES, "theme") and el.properties
        assert (el.section_type is None) == key.startswith("theme.")
        for p in el.properties:
            assert p.kind in ("text", "textarea", "link", "enum", "int", "color", "collection_id", "image_url")
            if p.kind == "enum":
                assert p.options
            if p.kind in ("text", "textarea"):
                assert p.max_length


async def test_registry_endpoint_requires_auth_and_matches_the_registry(client):
    headers, _ = await _demo(client)
    assert (await client.get("/api/v1/storefront/editable-elements")).status_code == 401
    served = (await client.get("/api/v1/storefront/editable-elements", headers=headers)).json()
    assert served == json.loads(json.dumps(public_registry()))


# ---- propose / apply / discard ----

async def test_hero_headline_edit_end_to_end_stays_in_the_draft_until_published(client):
    headers, slug = await _demo(client)
    live_before = await _live(client, slug)
    draft = await _draft(client, headers)
    hero = _section(draft, "hero")
    before_config = dict(hero["configuration"])

    res = await _propose(client, headers, draft, hero, "hero.headline", "Make it sound more premium and editorial, but keep it short")
    assert res.status_code == 201, res.text
    proposal = res.json()
    change = proposal["changes"][0]
    assert change["path"] == "headline" and change["current"] == before_config["headline"] and change["proposed"] != change["current"]
    assert proposal["element_label"] == "Hero headline" and proposal["summary"] and proposal["reasoning"] and proposal["state"] == "proposed"
    # Proposing changes nothing at all.
    assert await _draft(client, headers) == draft
    assert await _live(client, slug) == live_before

    applied = await client.post(f"/api/v1/storefront/element-edit/{proposal['proposal_id']}/apply", headers=headers, json={"revision": draft["revision"]})
    assert applied.status_code == 200, applied.text
    new = applied.json()
    new_hero = _section(new, "hero")
    assert new_hero["configuration"]["headline"] == change["proposed"]
    # Only the intended property changed; everything else in this section and the page is untouched.
    assert {k: v for k, v in new_hero["configuration"].items() if k != "headline"} == {k: v for k, v in before_config.items() if k != "headline"}
    for t in ("collection_grid", "product_grid", "feature_banner", "brand_story"):
        assert _section(new, t)["configuration"] == _section(draft, t)["configuration"]
    assert new["theme"] == draft["theme"] and new["revision"] != draft["revision"] and new["id"] == draft["id"]
    assert [s["id"] for s in new["pages"][0]["sections"]] == [s["id"] for s in draft["pages"][0]["sections"]]
    # The live storefront is unchanged until the normal publish workflow runs.
    assert await _live(client, slug) == live_before
    diff = (await client.get("/api/v1/storefront/diff", headers=headers)).json()["changes"]
    assert any("hero" in c for c in diff)
    assert (await client.post("/api/v1/storefront/publish", headers=headers)).status_code == 200
    live_after = await _live(client, slug)
    assert _section(live_after, "hero")["configuration"]["headline"] == change["proposed"]


async def test_applying_writes_an_audit_event(client):
    headers, _ = await _demo(client)
    draft = await _draft(client, headers)
    hero = _section(draft, "hero")
    proposal = (await _propose(client, headers, draft, hero, "hero.headline", 'Change it to "Made for keeps"')).json()
    await client.post(f"/api/v1/storefront/element-edit/{proposal['proposal_id']}/apply", headers=headers, json={"revision": draft["revision"]})
    async with AsyncSessionLocal() as db:
        events = (await db.execute(select(AuditLog).where(AuditLog.action == "storefront.element_edit_applied", AuditLog.entity_id == uuid.UUID(draft["id"])))).scalars().all()
    assert len(events) == 1 and events[0].before == {"headline": hero["configuration"]["headline"]} and events[0].after == {"headline": "Made for keeps"}


async def test_discard_changes_nothing_and_the_proposal_can_no_longer_be_applied(client):
    headers, _ = await _demo(client)
    draft = await _draft(client, headers)
    proposal = (await _propose(client, headers, draft, _section(draft, "hero"), "hero.headline", "make it shorter")).json()
    discarded = await client.post(f"/api/v1/storefront/element-edit/{proposal['proposal_id']}/discard", headers=headers)
    assert discarded.status_code == 200 and discarded.json()["state"] == "discarded"
    assert await _draft(client, headers) == draft
    again = await client.post(f"/api/v1/storefront/element-edit/{proposal['proposal_id']}/apply", headers=headers, json={"revision": draft["revision"]})
    assert again.status_code == 409


async def test_a_proposal_cannot_be_applied_twice(client):
    headers, _ = await _demo(client)
    draft = await _draft(client, headers)
    proposal = (await _propose(client, headers, draft, _section(draft, "hero"), "hero.headline", 'Say "Quiet leather"')).json()
    url = f"/api/v1/storefront/element-edit/{proposal['proposal_id']}/apply"
    assert (await client.post(url, headers=headers, json={"revision": draft["revision"]})).status_code == 200
    assert (await client.post(url, headers=headers, json={"revision": draft["revision"]})).status_code == 409


async def test_theme_edit_maps_to_approved_tokens_only(client):
    headers, slug = await _demo(client)
    draft = await _draft(client, headers)
    res = await _propose(client, headers, draft, None, "theme.style", "Make the background a warmer cream, use a classic serif, and rounder corners")
    assert res.status_code == 201, res.text
    changes = {c["path"]: c for c in res.json()["changes"]}
    assert changes["font_family"]["proposed"] == "Cormorant Garamond" or changes["font_family"]["current"] == "Cormorant Garamond"
    applied = (await client.post(f"/api/v1/storefront/element-edit/{res.json()['proposal_id']}/apply", headers=headers, json={"revision": draft["revision"]})).json()
    assert applied["theme"]["border_radius"] == "12px"
    assert applied["theme"]["primary_color"] == draft["theme"]["primary_color"]  # untouched
    if "font_family" in changes and changes["font_family"]["proposed"] == "Cormorant Garamond":
        assert applied["theme"]["font_family"] == "'Cormorant Garamond', Georgia, serif"  # stored as the approved stack
    assert (await _live(client, slug))["theme"]["border_radius"] == draft["theme"]["border_radius"]  # live unchanged


async def test_section_presentation_and_cta_edits(client):
    headers, _ = await _demo(client)
    draft = await _draft(client, headers)
    banner = _section(draft, "feature_banner")
    spacing = (await _propose(client, headers, draft, banner, "feature_banner.section", "give it more breathing room and left align it")).json()
    assert {c["path"]: c["proposed"] for c in spacing["changes"]} == {"align": "left", "spacing": "spacious"}
    cta = (await _propose(client, headers, draft, _section(draft, "hero"), "hero.cta", 'Change the label to "Discover the collection"')).json()
    assert cta["changes"][0] == {"path": "cta_text", "label": "Button label", "current": "Shop the collection", "proposed": "Discover the collection"}


async def test_product_grid_can_feature_a_real_collection_and_limit(client):
    headers, slug = await _demo(client)
    draft = await _draft(client, headers)
    grid = _section(draft, "product_grid")
    res = (await _propose(client, headers, draft, grid, "product_grid.products", "Feature the Evening Clutches collection and show only 4 products")).json()
    by_path = {c["path"]: c["proposed"] for c in res["changes"]}
    cols = (await client.get(f"/api/v1/public/stores/{slug}/collections")).json()
    assert by_path["collection_id"] == next(c["id"] for c in cols if c["title"] == "Evening Clutches") and by_path["limit"] == 4


# ---- validation: hostile or invalid model output is rejected and nothing changes ----

@pytest.mark.parametrize("payload,element,why", [
    ({"changes": [{"path": "headline", "value": "<script>alert(1)</script>"}]}, "hero.headline", "markup"),
    ({"changes": [{"path": "headline", "value": "Hi <b onmouseover=x>there</b>"}]}, "hero.headline", "markup"),
    ({"changes": [{"path": "headline", "value": "javascript:alert(1)"}]}, "hero.headline", "markup"),
    ({"changes": [{"path": "headline", "value": "x" * 500}]}, "hero.headline", "length"),
    ({"changes": [{"path": "headline", "value": 12}]}, "hero.headline", "type"),
    ({"changes": [{"path": "cta_href", "value": "javascript:alert(1)"}]}, "hero.cta", "link scheme"),
    ({"changes": [{"path": "cta_href", "value": "//evil.example/x"}]}, "hero.cta", "protocol-relative"),
    ({"changes": [{"path": "cta_href", "value": "http://insecure.example"}]}, "hero.cta", "not https"),
    ({"changes": [{"path": "onclick", "value": "alert(1)"}]}, "hero.headline", "unknown path"),
    ({"changes": [{"path": "subheadline", "value": "fine"}]}, "hero.headline", "path of a different element"),
    ({"changes": [{"path": "primary_color", "value": "red; background:url(x)"}]}, "theme.style", "css injection"),
    ({"changes": [{"path": "font_family", "value": "Comic Sans, fantasy"}]}, "theme.style", "unapproved font"),
    ({"changes": [{"path": "border_radius", "value": "50%"}]}, "theme.style", "unapproved radius"),
    ({"changes": [{"path": "collection_id", "value": str(uuid.uuid4())}]}, "product_grid.products", "unknown collection"),
    ({"changes": [{"path": "limit", "value": 9999}]}, "product_grid.products", "range"),
    ({"changes": [{"path": "limit", "value": "4; DROP TABLE x"}]}, "product_grid.products", "sql-ish"),
    ({"changes": [{"path": "image_url", "value": "https://evil.example/fake.png"}]}, "hero.image", "fabricated image"),
    ({"changes": [{"path": "spacing", "value": "huge"}]}, "hero.section", "enum"),
    ("this is not json", "hero.headline", "not json"),
    ("[1, 2, 3]", "hero.headline", "wrong shape"),
    ({"changes": "headline"}, "hero.headline", "changes not a list"),
])
async def test_invalid_or_malicious_model_output_is_rejected_and_the_draft_is_untouched(client, scripted, payload, element, why):
    headers, slug = await _demo(client)
    draft = await _draft(client, headers)
    section = None if element.startswith("theme") else _section(draft, element.split(".")[0])
    scripted(payload)
    res = await _propose(client, headers, draft, section, element, "do something")
    assert res.status_code == 422, (why, res.text)
    assert res.json()["error"]["code"] == "unsupported_edit"
    assert await _draft(client, headers) == draft
    assert "<script" not in res.text


async def test_the_model_saying_unsupported_surfaces_the_limitation_and_an_alternative(client, scripted):
    headers, _ = await _demo(client)
    draft = await _draft(client, headers)
    scripted({"changes": [], "unsupported": "I can't add a video here.", "alternative": "Change the hero image to a catalog photo."})
    res = await _propose(client, headers, draft, _section(draft, "hero"), "hero.headline", "put a video behind it")
    assert res.status_code == 422 and "can't add a video" in res.json()["error"]["message"] and "catalog photo" in res.json()["error"]["message"]


async def test_the_default_provider_explains_what_it_could_not_map(client):
    headers, _ = await _demo(client)
    draft = await _draft(client, headers)
    res = await _propose(client, headers, draft, _section(draft, "hero"), "hero.headline", "asdf qwer")
    assert res.status_code == 422 and "Try asking to change its headline" in res.json()["error"]["message"]


async def test_a_change_to_the_same_value_is_not_a_proposal(client, scripted):
    headers, _ = await _demo(client)
    draft = await _draft(client, headers)
    hero = _section(draft, "hero")
    scripted({"changes": [{"path": "headline", "value": hero["configuration"]["headline"]}]})
    assert (await _propose(client, headers, draft, hero, "hero.headline", "keep it")).status_code == 422


async def test_failed_ai_generation_leaves_the_draft_unchanged(client, monkeypatch):
    from tests.test_ai_reliability import _ExplodingProvider, _assert_safe_error

    headers, _ = await _demo(client)
    draft = await _draft(client, headers)
    monkeypatch.setattr(svc, "build_llm_provider", lambda *_a: _ExplodingProvider())
    res = await _propose(client, headers, draft, _section(draft, "hero"), "hero.headline", "make it shorter")
    assert res.status_code == 503
    _assert_safe_error(res.json())
    assert await _draft(client, headers) == draft


async def test_failed_persistence_leaves_the_draft_unchanged_and_the_proposal_pending(client, monkeypatch):
    headers, _ = await _demo(client)
    draft = await _draft(client, headers)
    proposal = (await _propose(client, headers, draft, _section(draft, "hero"), "hero.headline", 'Say "Never applied"')).json()

    async def boom(*args, **kwargs):
        raise RuntimeError("database write failed")

    monkeypatch.setattr(svc, "write_audit_event", boom)
    with pytest.raises(RuntimeError):
        await client.post(f"/api/v1/storefront/element-edit/{proposal['proposal_id']}/apply", headers=headers, json={"revision": draft["revision"]})
    monkeypatch.undo()
    assert await _draft(client, headers) == draft  # nothing half-applied
    retry = await client.post(f"/api/v1/storefront/element-edit/{proposal['proposal_id']}/apply", headers=headers, json={"revision": draft["revision"]})
    assert retry.status_code == 200 and _section(retry.json(), "hero")["configuration"]["headline"] == "Never applied"  # and it can still be applied


# ---- concurrency ----

async def test_a_proposal_made_before_another_edit_is_refused_as_stale(client):
    headers, _ = await _demo(client)
    draft = await _draft(client, headers)
    hero = _section(draft, "hero")
    proposal = (await _propose(client, headers, draft, hero, "hero.headline", 'Say "From the proposal"')).json()
    # Someone else edits the draft in the meantime (a different path entirely).
    story = _section(draft, "brand_story")
    await client.patch(f"/api/v1/storefront/sections/{story['id']}", headers=headers, json={"configuration": {**story["configuration"], "heading": "Edited elsewhere"}})
    res = await client.post(f"/api/v1/storefront/element-edit/{proposal['proposal_id']}/apply", headers=headers, json={"revision": draft["revision"]})
    assert res.status_code == 409 and res.json()["error"]["code"] == "stale_draft"
    after = await _draft(client, headers)
    assert _section(after, "hero")["configuration"] == hero["configuration"]  # the stale proposal wrote nothing
    assert _section(after, "brand_story")["configuration"]["heading"] == "Edited elsewhere"  # and the newer edit survived
    # Proposing from a stale preview is refused too.
    assert (await _propose(client, headers, draft, hero, "hero.headline", "make it shorter")).status_code == 409


async def test_applying_with_the_wrong_revision_is_refused(client):
    headers, _ = await _demo(client)
    draft = await _draft(client, headers)
    proposal = (await _propose(client, headers, draft, _section(draft, "hero"), "hero.headline", 'Say "X marks"')).json()
    res = await client.post(f"/api/v1/storefront/element-edit/{proposal['proposal_id']}/apply", headers=headers, json={"revision": "0" * 20})
    assert res.status_code == 409 and await _draft(client, headers) == draft


async def test_two_simultaneous_applies_of_the_same_proposal_apply_once(client):
    import asyncio

    headers, _ = await _demo(client)
    draft = await _draft(client, headers)
    proposal = (await _propose(client, headers, draft, _section(draft, "hero"), "hero.headline", 'Say "Only once"')).json()
    url = f"/api/v1/storefront/element-edit/{proposal['proposal_id']}/apply"
    results = await asyncio.gather(*[client.post(url, headers=headers, json={"revision": draft["revision"]}) for _ in range(3)])
    assert sorted(r.status_code for r in results) == [200, 409, 409]


# ---- tenant isolation, authorization, resolution ----

async def test_another_organization_can_neither_propose_on_nor_apply_this_drafts_edits(client):
    headers_a, _ = await _demo(client)
    draft_a = await _draft(client, headers_a)
    hero_a = _section(draft_a, "hero")
    proposal = (await _propose(client, headers_a, draft_a, hero_a, "hero.headline", 'Say "Mine"')).json()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as other:
        headers_b, _ = await _demo(other)
        draft_b = await _draft(other, headers_b)
        # B names A's draft and A's section: not found, never a partial leak.
        attack = await other.post("/api/v1/storefront/element-edit/propose", headers=headers_b, json={
            "draft_id": draft_a["id"], "revision": draft_a["revision"], "section_id": hero_a["id"], "element": "hero.headline", "instruction": "make it shorter"})
        assert attack.status_code == 404
        # B uses its own draft id with A's section id.
        mixed = await other.post("/api/v1/storefront/element-edit/propose", headers=headers_b, json={
            "draft_id": draft_b["id"], "revision": draft_b["revision"], "section_id": hero_a["id"], "element": "hero.headline", "instruction": "make it shorter"})
        assert mixed.status_code == 404
        # B cannot apply or discard A's proposal.
        assert (await other.post(f"/api/v1/storefront/element-edit/{proposal['proposal_id']}/apply", headers=headers_b, json={"revision": draft_a["revision"]})).status_code == 404
        assert (await other.post(f"/api/v1/storefront/element-edit/{proposal['proposal_id']}/discard", headers=headers_b)).status_code == 404
    assert await _draft(client, headers_a) == draft_a


async def test_authentication_is_required(client):
    headers, _ = await _demo(client)
    draft = await _draft(client, headers)
    body = {"draft_id": draft["id"], "revision": draft["revision"], "section_id": None, "element": "theme.style", "instruction": "darker"}
    assert (await client.post("/api/v1/storefront/element-edit/propose", json=body)).status_code == 401
    assert (await client.post(f"/api/v1/storefront/element-edit/{uuid.uuid4()}/apply", json={"revision": "x" * 10})).status_code == 401
    assert (await client.post(f"/api/v1/storefront/element-edit/{uuid.uuid4()}/discard")).status_code == 401


async def test_element_and_section_must_match_and_exist(client):
    headers, _ = await _demo(client)
    draft = await _draft(client, headers)
    hero, grid = _section(draft, "hero"), _section(draft, "product_grid")
    assert (await _propose(client, headers, draft, hero, "nope.element", "x1")).status_code == 422
    assert (await _propose(client, headers, draft, grid, "hero.headline", "make it shorter")).status_code == 422  # element of another section type
    assert (await _propose(client, headers, draft, hero, "theme.style", "darker")).status_code == 422  # theme takes no section
    assert (await _propose(client, headers, draft, None, "hero.headline", "make it shorter")).status_code == 422
    assert (await _propose(client, headers, draft, {"id": str(uuid.uuid4())}, "hero.headline", "make it shorter")).status_code == 404
    gone = dict(draft, id=str(uuid.uuid4()))
    assert (await _propose(client, headers, gone, hero, "hero.headline", "make it shorter")).status_code == 404


async def test_an_element_edit_cannot_reach_the_live_version(client):
    headers, slug = await _demo(client)
    live = (await client.get("/api/v1/storefront/live", headers=headers)).json()
    draft = await _draft(client, headers)
    assert live["id"] != draft["id"]
    attack = await client.post("/api/v1/storefront/element-edit/propose", headers=headers, json={
        "draft_id": live["id"], "revision": live["revision"], "section_id": _section(live, "hero")["id"], "element": "hero.headline", "instruction": "make it shorter"})
    assert attack.status_code == 404  # only the draft is reachable


async def test_the_older_change_plan_apply_refuses_element_edit_proposals(client):
    headers, _ = await _demo(client)
    draft = await _draft(client, headers)
    proposal = (await _propose(client, headers, draft, _section(draft, "hero"), "hero.headline", 'Say "Wrong door"')).json()
    res = await client.post(f"/api/v1/storefront/change-plan/{proposal['proposal_id']}/apply", headers=headers)
    assert res.status_code == 409
    assert await _draft(client, headers) == draft


async def test_public_storefront_sections_carry_stable_ids_the_preview_bridge_uses(client):
    headers, slug = await _demo(client)
    draft = await _draft(client, headers)
    live = await _live(client, slug)
    assert all("id" in s for p in live["pages"] for s in p["sections"])
    preview = (await client.get(f"/api/v1/public/preview/{draft['id']}")).json()
    assert [s["id"] for s in preview["pages"][0]["sections"]] == [s["id"] for s in draft["pages"][0]["sections"]]


def test_the_committed_editable_elements_contract_is_current():
    import pathlib

    committed = json.loads((pathlib.Path(__file__).resolve().parents[2] / "contracts" / "editable-elements.json").read_text())
    assert committed == json.loads(json.dumps(public_registry())), "run: python scripts/export_editable_elements.py"
