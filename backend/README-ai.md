# NOVA's AI provider

NOVA talks to language models only through `app/ai/provider.py` (`LLMProvider`). Which one is chosen by `AI_PROVIDER`:

| `AI_PROVIDER` | What it is |
|---|---|
| `fake` (default) | A deterministic, **rule-based** double used by the automated tests and the no-key demo. It is not a language model. The app says so (`GET /api/v1/ai/status` → `mode: "rule_based_demo"`; a note in the chat bubble and Store Builder). |
| `nvidia` | NVIDIA NIM through its OpenAI-compatible endpoint (`NVIDIA_BASE_URL`, default `https://integrate.api.nvidia.com/v1`). |
| `openai` | OpenAI, same class. |

A real provider without credentials is **never** replaced by the double: every AI call fails with a safe error and the status shows
`ready: false, reason: credentials_missing`.

## Configure NVIDIA
```
AI_PROVIDER=nvidia
NVIDIA_API_KEY=nvapi-...                 # server-side only; never sent to the frontend, logged, or returned in errors
NVIDIA_MODEL=nvidia/nemotron-3-super-120b-a12b   # change the model here; no code names one
AI_TIMEOUT_SECONDS=45  AI_MAX_RETRIES=1  AI_TEMPERATURE=0.4  AI_MAX_OUTPUT_TOKENS=1500  AI_HISTORY_MESSAGES=20
# NVIDIA_CHAT_TEMPLATE_KWARGS={"enable_thinking": false}   # optional; only if the endpoint accepts it for your model
```
Reasoning models may wrap answers in `<think>…</think>` or a code fence; that is stripped before the answer is used.

## What the model can and cannot do
- **Click-to-edit** (`/storefront/element-edit/*`): the model receives the selected element, its allowed properties and current values, the
  brand profile and theme tokens, and the instruction, and returns JSON. Every change is validated against the editable-element registry
  (types, lengths, enums, existing catalog ids), bound to the draft revision, applied only on an explicit Apply, to the draft only, with an audit event.
  A model failure, malformed output or rate limit leaves the draft untouched.
- **Assistant chat**: messages are routed by a rule-based intent router first (no extra model call). Small talk/help/troubleshooting get **no tools**;
  business questions get read-only tools scoped to the caller's organization; action requests can only create proposals that wait for approval.
  The model's tool calls go through the registered tool layer, which refuses anything not offered for that turn.
- Provider failures return a safe envelope (`ai_provider_unavailable` 503, or `ai_rate_limited` 429) and never claim an action happened.

## Check that it works
- `GET /api/v1/ai/status` (signed in): provider, model, whether credentials exist, last probe. `POST /api/v1/ai/status/probe`: one tiny real request (cached 60 s).
- `GET /readyz` includes an `ai` section (no secrets).
- `python scripts/nvidia_verify.py` runs the six real-inference scenarios (hero edit, theme edit, greeting, tenant-scoped low-stock question,
  nothing changes until Apply, live unchanged until Publish) against a server started with the key. It stops, saying so, if the server isn't really using NVIDIA.

## Deployment boundary
NVIDIA's free developer endpoints (build.nvidia.com) are intended for prototyping, research, development and testing. Do not assume they are
licensed or sized for serving real end users in production. Review NVIDIA's terms, or point `NVIDIA_BASE_URL`/`NVIDIA_MODEL` at a self-hosted or
licensed NIM deployment, or switch `AI_PROVIDER`; nothing else in NOVA changes.

## Turn the real text AI on (local) and check it is really selected
1. Edit **`backend/.env`** (the only file the backend reads; it is git-ignored). Set exactly:
   ```
   AI_PROVIDER=nvidia
   NVIDIA_API_KEY=<your key from build.nvidia.com, starts with nvapi->
   NVIDIA_MODEL=nvidia/nemotron-3-super-120b-a12b
   NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1      # optional; this is the default
   ```
   Leave `TTS_PROVIDER` / `KOKORO_*` alone: voice is a separate system (speech output only) and is unaffected.
2. **Restart the backend.** A `.env` edit is only read at process start. Stop the old one (`Ctrl+C`, or `kill $(lsof -ti tcp:8100)`) and run:
   `cd backend && .venv/bin/uvicorn app.main:app --port 8100 --reload --reload-include ".env"`
   (the `--reload-include` makes future `.env` edits restart it automatically). With Docker: `docker compose up -d --force-recreate backend` (it reads `backend/.env`).
3. Check: `curl -s localhost:8100/readyz` shows `"ai":{"provider":"nvidia","mode":"language_model",...}`; signed in, `GET /api/v1/ai/status` also lists
   `config.restart_required` (true if `.env` changed since the server started) and `config.overridden_by_environment` (variables in your shell that beat the file).
4. Browser: the chat bubble footer reads "Text AI: nvidia/nemotron-3-super-120b-a12b." (not "Demo mode").
5. Real smoke test (read-only): `cd backend && .venv/bin/python scripts/nvidia_smoke.py`.

If it still says Demo mode: `AI_PROVIDER` is exported in your shell (`env | grep AI_PROVIDER`), or the server wasn't restarted, or you edited a different `.env`.
