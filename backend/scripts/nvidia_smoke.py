"""Safe, READ-ONLY smoke test of the real NVIDIA integration against a running NOVA backend.

  AI_PROVIDER=nvidia NVIDIA_API_KEY=... uvicorn app.main:app --port 8100      (or set them in the ignored backend/.env)
  python scripts/nvidia_smoke.py [--api http://localhost:8100/api/v1] [--email you@x.com --password ...]

Checks: configuration (no model call) -> authentication to NVIDIA (one tiny request) -> a real conversational reply -> a read-only
business question answered through the real orchestrator and registered tool. It makes NO store changes: no drafts, publishes, proposals or
approvals. With no --email it signs in as the isolated demo visitor (which creates that visitor's own demo workspace and nothing else).
The API key is read by the server only; this script never sees it."""

import argparse
import json
import sys
import urllib.error
import urllib.request

ok_all = True


def check(name: str, ok: bool, detail: str = "") -> None:
    global ok_all
    ok_all &= ok
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"\n        {detail}" if detail else ""))


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
    except urllib.error.URLError:
        return 0, None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="http://localhost:8100/api/v1")
    ap.add_argument("--email")
    ap.add_argument("--password")
    args = ap.parse_args()
    api = args.api
    root = api.rsplit("/api/v1", 1)[0]

    try:
        with urllib.request.urlopen(root + "/readyz", timeout=10) as res:
            ready = json.loads(res.read())
    except Exception:  # noqa: BLE001
        check("backend reachable", False, f"nothing answered at {root}. Start the backend first.")
        return 1
    ai = ready.get("ai", {})
    check("configuration (no model call): AI_PROVIDER=nvidia and a key is set", ai.get("provider") == "nvidia" and ai.get("credentials_configured") is True, json.dumps(ai))
    if ai.get("provider") != "nvidia":
        print("\nThe server is using the rule-based demo AI. Set AI_PROVIDER=nvidia and NVIDIA_API_KEY in backend/.env and restart.")
        return 1
    if not ai.get("credentials_configured"):
        print("\nNVIDIA_API_KEY is not set on the server. Add it to the ignored backend/.env and restart.")
        return 1

    if args.email:
        code, tok = call(api, "/auth/login", "POST", None, {"email": args.email, "password": args.password})
    else:
        code, tok = call(api, "/auth/demo-login", "POST")
    token = tok["access_token"] if code == 200 else None
    check("signed in", bool(token))
    if not token:
        return 1

    _, status = call(api, "/ai/status/probe", "POST", token)
    err = (status.get("last_check") or {}).get("error")
    hints = {"authentication_failed": "NVIDIA rejected the key (keys start with nvapi-).", "model_not_found": "The model id isn't available to this key.",
             "access_denied": "This key has no access to the model.", "rate_limited": "Rate limited; wait and retry.", "timeout": "The request timed out."}
    check("1. authenticates to NVIDIA with the server's key (one tiny request)", status.get("ready") is True, hints.get(err, err or json.dumps(status))
          if status.get("ready") is not True else f"model {status.get('model')}, {status['last_check']['latency_ms']} ms")
    if status.get("ready") is not True:
        return 1

    _, conv = call(api, "/ai/conversations", "POST", token, {"agent_key": "assistant", "context": {}})
    code, hi = call(api, f"/ai/conversations/{conv['id']}/messages", "POST", token, {"text": "Hey NOVA, how are you?", "screen": "overview"})
    check("2. Nemotron returns a real assistant reply (no tools for small talk)", code == 200 and bool(hi.get("assistant_text", "").strip()) and hi["tool_call_log"] == [], hi.get("assistant_text", "")[:240])
    code, low = call(api, f"/ai/conversations/{conv['id']}/messages", "POST", token, {"text": "How many products are low on stock?", "screen": "inventory"})
    tools = [t["name"] for t in low.get("tool_call_log", [])]
    check("3. a read-only business question runs through the orchestrator and a registered tool", code == 200 and "get_low_stock_products" in tools and not any(t["is_mutating"] for t in low["tool_call_log"]), f"tools={tools}  reply={low.get('assistant_text', '')[:240]!r}")
    print("\nNo store changes were made. Now open the app and check the chat bubble shows the same kind of replies (see the checklist).")
    return 0 if ok_all else 1


if __name__ == "__main__":
    sys.exit(main())
