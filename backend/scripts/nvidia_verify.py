"""Real-inference verification of the NVIDIA NIM provider against a RUNNING NOVA backend.

  1. Start the backend with:  AI_PROVIDER=nvidia NVIDIA_API_KEY=... [NVIDIA_MODEL=...]  uvicorn app.main:app --port 8100
  2. Run (from backend/):      python scripts/nvidia_verify.py [--api http://localhost:8100/api/v1]

It checks that the model id exists in NVIDIA's public catalog, confirms the server really is using NVIDIA (not the rule-based
double), then drives the six scenarios through the real HTTP API in a fresh isolated demo workspace and prints what the model
actually produced. Exits non-zero if anything fails. The key is read by the SERVER only; this script never sees it."""

import argparse
import json
import sys
import urllib.error
import urllib.request

from app.config import get_settings

PASS, FAIL = "PASS", "FAIL"
results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))
    print(f"{PASS if ok else FAIL}  {name}" + (f"\n        {detail}" if detail else ""))


def call(api: str, path: str, method: str = "GET", token: str | None = None, body: dict | None = None):
    req = urllib.request.Request(
        api + path, method=method, data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as res:
            return res.status, json.loads(res.read() or "null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or "null")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", default="http://localhost:8100/api/v1")
    args = parser.parse_args()
    api = args.api

    model = get_settings().nvidia_model
    try:
        with urllib.request.urlopen(f"{get_settings().nvidia_base_url}/models", timeout=30) as res:
            listed = {m["id"] for m in json.loads(res.read())["data"]}
        check(f"model id '{model}' exists in NVIDIA's catalog", model in listed)
    except Exception as exc:  # noqa: BLE001
        check("NVIDIA catalog reachable", False, type(exc).__name__)

    _, demo = call(api, "/auth/demo-login", "POST")
    token = demo["access_token"]
    _, status = call(api, "/ai/status/probe", "POST", token)
    check("server is using NVIDIA (real language model), credentials configured, probe succeeds",
          status.get("provider") == "nvidia" and status.get("real_ai") is True and status.get("ready") is True, json.dumps({k: status.get(k) for k in ("provider", "model", "ready", "last_check")}))
    if status.get("provider") != "nvidia" or not status.get("ready"):
        print("\nThe server is not running real NVIDIA inference (provider/key/probe above), so the scenarios would only exercise the "
              "rule-based double. Stopping: nothing below this line would be real AI.")
        return 1

    _, draft = call(api, "/storefront/draft", token=token)
    me = call(api, "/auth/me", token=token)[1]
    slug = me["org_slug"]
    hero = next(s for p in draft["pages"] for s in p["sections"] if s["type"] == "hero")
    live_headline = lambda: next(s for s in call(api, f"/public/stores/{slug}/storefront")[1]["pages"][0]["sections"] if s["type"] == "hero")["configuration"]["headline"]  # noqa: E731
    before = hero["configuration"]["headline"]

    code, prop = call(api, "/storefront/element-edit/propose", "POST", token, {
        "draft_id": draft["id"], "revision": draft["revision"], "section_id": hero["id"], "element": "hero.headline",
        "instruction": "Make it sound more premium and editorial, but keep it short"})
    ok = code == 201 and prop["changes"] and prop["changes"][0]["proposed"] != before
    check("1. natural-language hero title edit -> a real structured proposal", ok, f"{before!r} -> {prop['changes'][0]['proposed']!r}  ({prop['reasoning']})" if ok else json.dumps(prop)[:300])

    _, after_propose = call(api, "/storefront/draft", token=token)
    check("5. proposing changed nothing (draft headline and live both unchanged)", ok and next(s for p in after_propose["pages"] for s in p["sections"] if s["type"] == "hero")["configuration"]["headline"] == before and live_headline() == before)

    code, theme = call(api, "/storefront/element-edit/propose", "POST", token, {
        "draft_id": draft["id"], "revision": draft["revision"], "section_id": None, "element": "theme.style",
        "instruction": "Use a warmer cream background and a classic serif typeface"})
    check("2. theme edit -> approved tokens only", code == 201 and {c["path"] for c in theme["changes"]} <= {"primary_color", "background_color", "font_family", "border_radius", "button_style"},
          json.dumps([(c["path"], c["proposed"]) for c in theme.get("changes", [])]) if code == 201 else json.dumps(theme)[:300])

    _, conv = call(api, "/ai/conversations", "POST", token, {"agent_key": "assistant", "context": {}})
    _, hi = call(api, f"/ai/conversations/{conv['id']}/messages", "POST", token, {"text": "Hey NOVA, how are you?", "screen": "overview"})
    check("3. natural greeting answered by the model, no tools, no brand/onboarding hijack",
          hi.get("intent") == "small_talk" and hi["tool_call_log"] == [] and hi["assistant_text"].strip() != "" and "velora" not in hi["assistant_text"].lower(), hi.get("assistant_text", "")[:200])
    _, low = call(api, f"/ai/conversations/{conv['id']}/messages", "POST", token, {"text": "How many products are low on stock?", "screen": "inventory"})
    check("4. tenant-scoped low-stock question uses the registered read tool", low.get("intent") == "business_query" and any(t["name"] == "get_low_stock_products" and not t["is_mutating"] for t in low["tool_call_log"]), low.get("assistant_text", "")[:240])

    if ok:
        code, applied = call(api, f"/storefront/element-edit/{prop['proposal_id']}/apply", "POST", token, {"revision": draft["revision"]})
        new = next(s for p in applied["pages"] for s in p["sections"] if s["type"] == "hero")["configuration"]["headline"]
        check("applying changes the DRAFT only", code == 200 and new == prop["changes"][0]["proposed"] and live_headline() == before)
        code, _ = call(api, "/storefront/publish", "POST", token)
        check("6. the live storefront changes only after an explicit publish", code == 200 and live_headline() == new)

    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
