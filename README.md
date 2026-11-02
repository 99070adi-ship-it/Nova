# NOVA

AI co-founder for e-commerce: a merchant admin (business dashboard, AI assistant, Store Builder, Create My Store, Photo Studio), a customer storefront, and the API behind both.

| Part | Stack | Dev port |
|---|---|---|
| `backend/` | FastAPI, SQLAlchemy (async), Alembic, Postgres | 8100 |
| `admin/` | React, Vite, TanStack Query, Tailwind | 5173 |
| `storefront/` | React, Vite | 5174 |
| `e2e/` | Playwright journeys against the real stack | n/a |

More detail: [ARCHITECTURE.md](ARCHITECTURE.md), [README-ai.md](README-ai.md) (AI providers), [backend/README-voice.md](backend/README-voice.md) (NOVA's voice), [DEPLOY.md](DEPLOY.md) (production on Vercel).

## What is real, and what is not

- **Real:** auth (argon2 + JWT with a refresh cookie), products / inventory / orders / customers / analytics, the AI assistant and agents (NVIDIA-hosted language model), Store Builder with AI change plans, storefront and checkout, **Photo Studio generation and editing** (Cloudflare Workers AI, FLUX).
- **Not built:** AI image *enhancement* (the tab says "Coming soon"), email verification, password reset, Marketing and Settings screens.
- **Demo:** visitors can enter an isolated demo workspace. It runs on sample data and **cannot** call Photo Studio, so a visitor can't spend the image allowance.

## Run locally

Prerequisites: Docker, Node 20+, Python 3.12.

```bash
# 1. Database (and optionally the API) in Docker
docker compose up -d db

# 2. Backend
cd backend
python3.12 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env          # defaults use the offline fake AI; see "AI keys" below
alembic upgrade head
python scripts/seed.py        # optional: the VELORA demo store (login owner@velora.demo / changeme123)
uvicorn app.main:app --port 8100

# 3. Frontends (separate terminals)
cd admin && cp .env.example .env && npm install && npm run dev        # http://localhost:5173
cd storefront && cp .env.example .env && npm install && npm run dev   # http://localhost:5174
```

Or run the API in Docker too: `docker compose up -d` (API on :8100).

### AI keys (all optional locally)

Set in `backend/.env`; nothing here is ever sent to a browser.

- `AI_PROVIDER=nvidia` + `NVIDIA_API_KEY`: the assistant, Guide and agents (see [README-ai.md](README-ai.md)). Default `fake` is deterministic and offline.
- `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` (token scoped to **Workers AI** only): Photo Studio. Without them the studio says it isn't configured. It never fakes an image outside `ENV=local`.

## Tests

```bash
cd backend && pytest                 # needs the Postgres from step 1
cd admin && npm test && npm run build
cd storefront && npm test && npm run build
cd e2e && npm install && npm test    # needs the whole stack running
```

> **The backend suite truncates the database it points at** (`DATABASE_URL`). Don't run it against data you care about. Afterwards, restore the demo with `python scripts/seed.py` or `POST /api/v1/dev/demo-reset` (local only).

Live provider calls are **not** part of the suite: Photo Studio tests use the fake provider. See the verification notes in [DEPLOY.md](DEPLOY.md#what-has-and-has-not-been-verified).

## Photo Studio

`/photo-studio` in the admin. Generate (FLUX.1 schnell) and Edit (FLUX.2 klein: upload an image, describe the change, compare before/after, download). Results are stored per workspace (in Postgres) and are only retrievable by that workspace. Per-user limits: 20 images per UTC day and 6 requests per minute (`STUDIO_*`). Honest limitations: text rendered inside images is often garbled, an edit sometimes ignores its instruction, and the provider's safety filter occasionally blocks harmless prompts.
