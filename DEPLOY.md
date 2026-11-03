# Deploying NOVA (all on Vercel)

Three Vercel projects from this one repo, plus Postgres from the Vercel Marketplace (Neon):

```
nova-admin       root: admin       Vite SPA
nova-storefront  root: storefront  Vite SPA          ──▶  nova-api (FastAPI on Vercel Functions)  ──▶  Neon Postgres
nova-api         root: backend     Python function
```

Everything below runs on Vercel's free Hobby plan, which is for non-commercial use. Review Vercel's and Neon's current terms and limits before real customers use it.

## 1. Postgres (Neon via the Marketplace)

In the `nova-api` project: Storage / Marketplace, add **Neon**, pick the free plan, and connect it to `nova-api`. Vercel injects `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED`. The app accepts either form: it rewrites `postgresql://…?sslmode=require&channel_binding=require` into what asyncpg understands. Nothing needs the `pgvector` extension.

Create the tables once (and after every schema change), from your machine, with the **unpooled** URL:

```bash
cd backend
DATABASE_URL="<DATABASE_URL_UNPOOLED value>" alembic upgrade head
```

Functions do not run migrations themselves: they are stateless and start in parallel.

## 2. API project (`nova-api`, root directory `backend`)

`backend/vercel.json` sets the entrypoint's `maxDuration` to 300 s (the Hobby maximum). Environment variables:

| Variable | Value |
|---|---|
| `ENV` | `production` (secure cookies, `/dev/*` disabled, refuses the dev JWT secret) |
| `JWT_SECRET` | unique, 32+ chars (`python -c "import secrets; print(secrets.token_urlsafe(48))"`) |
| `DATABASE_URL` | injected by the Neon integration |
| `CORS_ORIGINS` | JSON list of the admin and storefront origins |
| `COOKIE_SAMESITE` | `none`: `*.vercel.app` hosts are different sites, so the refresh cookie must be cross-site (HTTPS only). With one custom domain for all three apps you can use `strict` |
| `AI_PROVIDER`, `NVIDIA_API_KEY`, `NVIDIA_MODEL`, `NVIDIA_CHAT_TEMPLATE_KWARGS` | the assistant (see `backend/.env.example`); mark the key **Sensitive** |
| `STUDIO_PROVIDER`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | Photo Studio. Token scoped to **Workers AI** only |
| `STUDIO_MAX_UPLOAD_BYTES` | `4194304`. Vercel caps a request body at 4.5 MB, so keep uploads under that |
| `TTS_PROVIDER` | leave `kokoro`: the voice model is not installed on the API (it cannot run in a function). NOVA's voice runs in the visitor's browser instead: see `VITE_VOICE_ENGINE` below |

## 3. Frontend projects

| Project | Root | Environment variables |
|---|---|---|
| `nova-admin` | `admin` | `VITE_API_BASE_URL=/api/v1` (same-origin, see below), `VITE_STOREFRONT_ORIGIN=https://<storefront-domain>`, `VITE_VOICE_ENGINE=browser` |
| `nova-storefront` | `storefront` | `VITE_API_BASE_URL=https://<api-domain>/api/v1`, `VITE_ADMIN_ORIGINS=https://<admin-domain>` |

Both projects need "include source files outside the root directory" (the storefront imports `contracts/`). `VITE_*` values are baked in at build time: change one and redeploy. Vercel assigns aliases such as `nova-api-eta.vercel.app`: read the real alias after the first deploy and use it everywhere, including `CORS_ORIGINS`.

### Why the admin calls the API on its own address

`admin/vercel.json` rewrites `/api/v1/*` to the API project, so the browser only ever talks to the admin's own origin. That makes the refresh cookie **first-party**: browsers that block third-party cookies (Safari, Brave, Chrome in some modes) would otherwise drop it and sign people out on every refresh (this was reproduced: with the cookie removed, a refresh lands on /login). It also means the admin needs no CORS. **The rewrite's destination is the API's Vercel address** (`https://nova-api-eta.vercel.app` today): edit it in `admin/vercel.json` if the API's address changes. The storefront is public and cookie-less, so it still calls the API directly (that is what `CORS_ORIGINS` is for).

## 4. First deploy checklist

1. `GET https://<api>/healthz` returns `{"status":"ok"}`.
2. Open the admin, sign in with the demo (or sign up), then refresh: the session must persist (if not, see `COOKIE_SAMESITE`).
3. Photo Studio (real account, not the demo): status says configured; generate and edit one image.
4. Store Builder preview loads inside the admin (this is what `VITE_ADMIN_ORIGINS` allows).

## Serverless trade-offs (read before relying on it)

- **Cold starts:** the first request after idle is slower. The pool is small (3 + 2) and recycled so Neon's connection limits are respected.
- **Burst limit is per instance.** Photo Studio's per-minute limit lives in memory, so concurrent instances each count separately. The **daily** limit is stored in the database and is exact.
- **Voice runs in the browser.** Kokoro (~2 GB with PyTorch) cannot run in a function, so `VITE_VOICE_ENGINE=browser` makes the admin run the same Kokoro model client-side (kokoro-js, ONNX). Nothing is downloaded until someone chooses "Voice + text"; then a progress screen ("Setting up NOVA's voice", about 88 MB from Hugging Face, cached by the browser afterwards) holds the tour until the model is ready, with "Skip and use text only" always available and a plain message if it fails. Speech is synthesised on the visitor's CPU (WebAssembly, the small ~88 MB quantised model in every browser), one sentence at a time and in order, at roughly real time, so expect short pauses between sentences on slower machines. A WebGPU build exists but is a ~330 MB download and stalled in Safari, so it is deliberately not used. The setup screen shows a "Starting the voice…" step once the bytes are in, a "still working" note after 15 s without change, and the loader gives up cleanly after 45 s without a byte (the Guide continues in text). Multi-threaded WebAssembly would need cross-origin isolation headers, which would break the Store Builder preview iframe, so it is not enabled. Where the browser can't run it at all, the Guide stays text-only.
- **Request body cap 4.5 MB** (a larger upload gets a plain-text 413 from Vercel; the UI checks the size first), **300 s** max duration, **no background work** beyond a request. Images are stored in Postgres: fine for a demo, move to object storage (Vercel Blob / S3) before scale.
- **Free-tier limits** (Hobby functions, Neon, Cloudflare Workers AI, NVIDIA developer endpoints) are for prototyping.

## What has and has not been verified

Verified: all three test suites and builds locally; the API's production-style startup, CORS and cookie behavior; the API deploying and answering on Vercel (`/healthz`, CORS, dev route hidden); both frontends deployed and serving; real Cloudflare FLUX generation/editing through a local API.

**Verify after connecting Neon:** the migration against Neon, sign-in through the deployed admin, and Photo Studio from the deployed API.

## Security notes

- Secrets live in each Vercel project's environment (mark them Sensitive). `.env` files are git-ignored; commit only `*.env.example`.
- If a key has ever been pasted into a chat, ticket or log, rotate it.
- `/dev/*` routes (including demo reset) 404 unless `ENV=local`.
- Photo Studio endpoints require sign-in, are scoped to the caller's workspace, validate uploads by decoding them, and are blocked in demo workspaces.
