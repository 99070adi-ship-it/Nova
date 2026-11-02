# Deploying NOVA

NOVA is three deployables. **Vercel hosts the two static frontends; it cannot host the backend** (a long-running FastAPI app that needs Postgres and optionally a ~2 GB voice model). Use a container host for the API.

```
Vercel project 1  admin/       ──┐
Vercel project 2  storefront/  ──┼──▶  API (any container host)  ──▶  Postgres
```

## 1. Database

Any Postgres 15+ (Neon, Supabase, Render, Railway, RDS). No extensions are needed: nothing in the app or its migrations uses `pgvector`. Set `DATABASE_URL` (`postgresql+asyncpg://…` or plain `postgresql://…`, both accepted). Migrations run on container start (`alembic upgrade head`).

## 2. API (container host: Render, Railway, Fly.io, Cloud Run…)

**Render:** the repo has a `render.yaml` Blueprint (API service + Postgres, free plans, voice off). In Render choose New > Blueprint, select this repo, and fill in the prompted secrets (`NVIDIA_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`). `JWT_SECRET` is generated for you. Then follow step 3 below with the API's `https://….onrender.com` address. The Blueprint is untested until it has been run once.

Build `backend/Dockerfile`. For a small image without the voice model use `--build-arg WITH_VOICE=0` and leave `TTS_PROVIDER=kokoro` (with no voice installed the Guide is simply text-only; `fake` would play a test tone). Start command (already the image default in compose): `sh -c "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port $PORT"`. Health check: `GET /healthz`.

| Variable | Value |
|---|---|
| `ENV` | `production` (turns on secure cookies, disables `/dev/*`, refuses the dev JWT secret) |
| `JWT_SECRET` | unique, 32+ chars: `python -c "import secrets; print(secrets.token_urlsafe(48))"` |
| `DATABASE_URL` | your Postgres URL |
| `CORS_ORIGINS` | JSON list of the two Vercel origins, e.g. `["https://nova-admin.vercel.app","https://nova-store.vercel.app"]` |
| `COOKIE_SAMESITE` | `strict` if admin and API share a registrable domain (e.g. `app.x.com` + `api.x.com`). `none` if they are on different sites (e.g. `*.vercel.app` + another host); needs HTTPS |
| `AI_PROVIDER`, `NVIDIA_API_KEY`, `NVIDIA_MODEL`, `NVIDIA_CHAT_TEMPLATE_KWARGS` | the assistant (see `backend/.env.example`) |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | Photo Studio. Token scoped to **Workers AI** only |
| `STUDIO_DAILY_LIMIT`, `STUDIO_BURST_PER_MINUTE` | per-user caps (default 20/day, 6/min) |
| `TTS_PROVIDER` | `kokoro` (needs ~2 GB RAM) or `fake` |

Put the API behind HTTPS. Prefer a custom domain on the same registrable domain as the admin so the refresh cookie can stay `SameSite=Strict`.

## 3. Frontends on Vercel

Create **two** Vercel projects from the same repo. `vercel.json` in each folder already sets the build, SPA rewrites, security headers and long-cache for the film.

| | Root Directory | Environment variables |
|---|---|---|
| Admin | `admin` | `VITE_API_BASE_URL=https://<api>/api/v1`, `VITE_STOREFRONT_ORIGIN=https://<storefront-domain>` |
| Storefront | `storefront` | `VITE_API_BASE_URL=https://<api>/api/v1`, `VITE_ADMIN_ORIGINS=https://<admin-domain>` |

`VITE_*` values are baked in at build time: change one and redeploy. Deploy the API first, then add its URL, then add the Vercel origins to `CORS_ORIGINS`.

## 4. First deploy checklist

1. `GET https://<api>/healthz` returns `{"status":"ok"}`.
2. Open the admin, sign up, sign in, refresh the page (the session must persist: if it doesn't, see `COOKIE_SAMESITE`).
3. Photo Studio: status says configured; generate one image; edit one image.
4. Store Builder preview loads inside the admin (this is what `VITE_ADMIN_ORIGINS` allows).

## What has and has not been verified

Verified locally (2026-11-02): backend, admin and storefront test suites; both frontend production builds; real Cloudflare FLUX generation and editing through the running API with a non-demo account; sign-in, landing and login film playback in Chromium.

**Not verified:** an actual Vercel deployment, a hosted API, Safari playback, email (not built), and behavior under real traffic. Free-tier provider limits (Cloudflare Workers AI daily allowance, NVIDIA developer endpoints) are for prototyping: review their terms before real customers use it. Images are stored in Postgres, which is fine at demo scale; move to object storage (S3/R2) before scaling.

## Security notes

- Secrets live only in the API's environment. `.env` files are git-ignored; commit only `*.env.example`.
- If a key has ever been pasted into a chat, ticket or log, rotate it.
- `/dev/*` routes (including demo reset) 404 unless `ENV=local`.
- Photo Studio endpoints require sign-in, are scoped to the caller's workspace (another workspace's image id returns 404), validate uploads by decoding them, and are blocked in demo workspaces.
