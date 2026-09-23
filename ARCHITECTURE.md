# NOVA — Architecture

Prototype 1. This document is the single source of truth for schema, contracts, and invariants —
AI agents and future implementation sessions should read this before touching the corresponding
area of code. The full product/architecture plan (including all phase amendments) lives at
`~/.claude/plans/melodic-bouncing-kahn.md`; this file is the living, in-repo distillation of it,
kept in sync as implementation proceeds.

## What NOVA is

An AI-native e-commerce operating system: a real commerce backend (products, inventory, orders,
customers, promotions), a real customer-facing storefront driven by that data, a visual Store
Builder (structured + natural-language editing) with a draft/publish model, real analytics, and a
multi-agent AI layer — specialized agents plus a Store Manager orchestrator — that can analyze the
business and propose or execute changes, gated by human approval for anything sensitive, with every
action audited.

Prototype 1 intentionally keeps the UI plain. It must prove the product concept, the architecture,
and the end-to-end workflows — not look finished. See **Guiding principle** below.

## Guiding principle

Every concept in this document must exist architecturally. Prototype 1 does not need production
depth everywhere. A real, working Create My Store → Storefront → Store Manager → Action Plan →
Approval loop is worth more than many shallow features. When in doubt, build the core loop for real
and leave breadth for later.

## Repository layout

```
nova/
  backend/       FastAPI app — commerce engine, AI orchestration, tools, approvals, audit
  admin/          Vite/React admin app (Operate / Grow / Store / System nav)
  storefront/     Vite/React customer-facing storefront (separate app)
  docker-compose.yml
  ARCHITECTURE.md (this file)
```

Two frontends, one backend. Admin and storefront have different auth models (org/user JWT vs.
anonymous browsing + optional customer session), different information architecture, and would
scale/cache independently in a real deployment.

## Stack

- **Backend**: FastAPI, SQLAlchemy 2.0 (async), asyncpg, Alembic, Pydantic v2 + pydantic-settings,
  argon2-cffi, pyjwt, `pgvector`, `openai` SDK (also used for the NVIDIA client via a different
  `base_url`), structlog.
- **DB**: PostgreSQL + `pgvector` extension.
- **Frontend** (both apps): Vite, React 18, TypeScript, Tailwind, TanStack Query, React Router,
  react-hook-form + zod, Radix UI primitives, a hand-written `api/client.ts` per app.
- **Auth**: JWT access token (short TTL, `Authorization: Bearer`) + httpOnly `SameSite=strict`
  refresh cookie + argon2 password hashing.
- **Local dev**: Docker Compose for Postgres; backend run directly via uvicorn.

## Backend layering

```
api/routes_*.py  (thin — parse request, call one service function, return its result)
     ↓
services/*_service.py  (business rules, transactions, orchestration)
     ↓
repositories/*_repo.py  (raw queries, always org_id-scoped)
     ↓
db/models/*.py  (one file per aggregate)
```

- A shared `DomainError` hierarchy (`NotFoundError`, `ConflictError`, `ValidationDomainError`,
  `ForbiddenError`) maps to one JSON error envelope `{"error": {"code", "message", "details"}}` via
  FastAPI exception handlers. Routes never construct ad hoc error responses.
- `AuthContext` (`user_id`, `org_id`, `role`) is a FastAPI dependency that decodes the JWT, then
  **re-derives `org_id` and `role` from the live `User` row**, never trusting token claims or any
  client-supplied tenant field. Every repository function takes `org_id` explicitly from this
  object — never from a request body, query param, or (for AI tool calls) from anything the model
  supplied.
- `db/base.py`: `Base` (SQLAlchemy `DeclarativeBase` with a naming-convention `MetaData`),
  `UUIDPKMixin`, `TimestampMixin`, `utcnow()`.

## Database schema

All tables carry `org_id` except child rows scoped via a parent FK. UUID primary keys throughout.

### Tenancy & identity
- `Organization(id, name, slug)`
- `User(id, org_id, email, password_hash, full_name, role: owner|staff, is_active, deleted_at)`
- `RefreshToken(id, user_id, token_hash, expires_at, revoked_at)` — hashed, rotated on use.

### Brand intelligence
- `Store(id, org_id, name, currency, domain_placeholder)`
- `BrandProfile(id, org_id, name, description, sells_what, target_customer, positioning,
  vibe_text, tone, preferred_visual_direction, preferred_colors: JSONB, typography_preference,
  price_positioning, brand_values: JSONB, content_style, inspiration_reference_text)`

### Store creation / onboarding
- `StoreCreationSession(id, org_id, status: brand_input|product_input|generating_products|
  generating_storefront|ready_for_review|completed, current_step, started_at, completed_at)`

### Commerce
- `Product(id, org_id, title, slug, status: draft|published|archived, category, tags: JSONB,
  seo_title, seo_description)`
- `ProductVariant(id, product_id, sku, price, cost, attributes: JSONB)`
- `ProductDraft(id, org_id, session_id nullable, status: pending_generation|generated|
  owner_reviewing|accepted|rejected, fields: JSONB, field_status: JSONB — per-field
  known|suggested|requires_confirmation, source_image_refs: JSONB)`
- `ProductImage(id, product_id, url, role: canonical|generated, alt_text, is_ai_generated,
  provider, model, prompt_metadata: JSONB, environment, mood, source_image_id nullable FK→self,
  created_at)`
- `Collection(id, org_id, title, slug, description)`
- `CollectionProduct(collection_id, product_id, created_by: ai|owner, rule_json nullable)`

### Inventory
- `InventoryLocation(id, org_id, name)`
- `Inventory(id, variant_id, location_id, on_hand, reserved, low_stock_threshold)`
- `InventoryMovement(id, inventory_id, delta, reason, created_at)` — append-only.

### Customers & orders
- `Customer(id, org_id, email, name, created_at)`
- `Order(id, org_id, customer_id, status, payment_status, total, created_at)`
- `OrderItem(id, order_id, variant_id, quantity, unit_price)`
- `CartEvent(id, org_id, customer_id nullable, variant_id, event: added|removed|abandoned,
  created_at)`

### Promotions
- `Promotion(id, org_id, code, type, value, scope: JSONB, starts_at, ends_at, active)`

### Store Builder / storefront versioning
- `StorefrontVersion(id, org_id, status: draft|live, generated_by: ai|owner|mixed, published_at)`
- `StorePage(id, storefront_version_id, slug, title, order)`
- `StoreSection(id, page_id, type, order, configuration: JSONB)`
- `StoreTheme(id, storefront_version_id, tokens: JSONB)`

### Analytics
- `AnalyticsEvent(id, org_id, event_type, product_id nullable, collection_id nullable,
  page_id nullable, section_id nullable, customer_id nullable, created_at)` — `event_type` enum is
  extensible (`page_view, product_view, collection_view, search, add_to_cart, remove_from_cart,
  checkout_start, purchase, wishlist_add, promotion_click, hero_click, collection_click,
  section_click`); Prototype 1 wires `page_view, product_view, collection_view, add_to_cart,
  checkout_start, purchase, hero_click`.
- `SalesMetricDaily(id, org_id, date, product_id nullable, revenue, orders, units)` —
  pre-aggregated; agents query this, not raw events.

### AI / orchestration
- `AIConversation(id, org_id, agent_key, context: JSONB, created_by_user_id)` — context is
  server-validated on write (see **Scoped AI context**).
- `AIMessage(id, conversation_id, role, content, created_at)`
- `AIAgentRun(id, org_id, agent_key, trigger, status, prompt_tokens, completion_tokens,
  hit_loop_cap, result_json, created_at)` — `result_json` holds structured output (a
  `StoreHealthReport`, a Storefront Change Plan, etc.) for that run.
- `ToolProposal(id, org_id, requesting_agent_run_id, tool_name, arguments: JSONB,
  canonical_arguments: JSONB, payload_hash, risk_classification: low|high, status: proposed|
  approved|rejected|executing|executed|execution_failed|stale|expired, reviewed_by, reviewed_at,
  rejection_reason, executed_at, execution_result: JSONB, failure_reason, expires_at, created_at)`
- `AgentActionPlan(id, org_id, agent_run_id, created_by: store_manager, items: JSONB — list of
  {tool_name, risk, auto_executable, status, proposal_id?}, created_at)`
- `AuditLog(id, org_id, actor_type: user|ai|system, actor_id nullable, action, entity_type,
  entity_id, before: JSONB, after: JSONB, created_at)`

## Auth

Identical mechanism across NOVA and support-copilot:
- `POST /api/v1/auth/login` — argon2-verify password, issue JWT access token (short TTL) +
  httpOnly `SameSite=strict Secure` refresh cookie scoped to `/api/v1/auth`.
- `POST /api/v1/auth/refresh`, `POST /api/v1/auth/logout`, `GET /api/v1/auth/me`.
- `require_role(*roles)` dependency; `require_owner = require_role(UserRole.owner)`.

## AI provider abstraction

```python
class LLMProvider(ABC):
    async def step(self, *, system_prompt: str, context: dict, messages: list[str],
                    tool_results: list[ToolResultMessage],
                    available_tools: list[dict]) -> ProviderStepResult: ...
    async def embed(self, texts: list[str]) -> list[list[float]]: ...

class ImageProvider(ABC):
    async def generate_image(self, *, kind: Literal["lifestyle","on_model","environment",
                              "promotional","hero","collection"], source_image_url: str | None,
                              environment: str | None, model: str | None, mood: str | None,
                              prompt_hint: str | None) -> GeneratedImage: ...
```

Selected via `AI_PROVIDER` / `IMAGE_PROVIDER` env vars through `ai/factory.py`:
- `FakeLLMProvider` / `FakePlaceholderImageProvider` — deterministic, no external calls.
  **Default.**
- `NvidiaProvider` — NVIDIA NIM's OpenAI-compatible API via the `openai` SDK, different `base_url`.
- `OpenAIProvider` — real OpenAI, same SDK.
- Adding another provider (e.g. Claude) = a new class implementing the ABC. No other code changes.

`ImageProvider` is typed for all six `kind`s; Prototype 1 concretely implements only `lifestyle`.

## Tool system

```python
@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    args_model: type[BaseModel]
    is_mutating: bool
    risk_classification: Literal["low", "high"] | None   # None ⇒ read-only, executes inline
    auto_executable: bool = False   # only for a narrow allowlist of low-risk write tools
```

One global `TOOL_REGISTRY: dict[str, ToolSpec]`. Read tools execute inline. Write/sensitive tools
always create a `ToolProposal` — **never** execute directly, regardless of which agent calls them.
`auto_executable=True` is reserved for a small, explicit allowlist (e.g. "improve product
description") that never touches price, inventory, publishing, or money; an `AgentActionPlan` may
run these without a human click, but everything else always requires approval.

Each specialized agent is an `AgentSpec(key, system_prompt, tool_names: list[str])` — a named
subset of the global registry. Tool schemas never include `org_id`/`user_id` — nothing for the
model to forge; tenant scope is always injected server-side from `AuthContext`.

## Approval / proposal pipeline

State machine: `proposed → approved|rejected → executing → executed|execution_failed|stale`, plus
lazy `expired`.

1. Schema-validate arguments against the tool's Pydantic model.
2. Re-authorize the requesting agent/user server-side.
3. Canonicalize arguments + compute a payload hash at proposal time.
4. Persist the immutable proposal + write an audit event, same transaction.
5. On approval: optimistic-concurrency `try_transition(from_statuses=[...])` guards every step
   (blocks double-approval/double-execution races); re-verify the payload hash before executing;
   execute via a per-`tool_name` executor function; verify the result; write an audit event.
6. Any failure at any step fails closed (`execution_failed` / `stale`) — never silently succeeds.

## Audit system

`write_audit_event(db, *, org_id, actor_type, actor_id, action, entity_type, entity_id, before,
after)` — called in the **same transaction** as the mutation it describes, so the two can never
diverge. Rendered on the Activity page as an operational trace: agent → tool → action → entity →
result, timestamped. No hidden chain-of-thought is ever surfaced.

## Brand intelligence & context building

`BrandProfile` is never passed whole into a model call. `build_context(agent_key, *, scope: dict)
-> dict` assembles only the fields a given agent/task needs, implemented as scoped read tools
(`get_brand_profile(fields: list[str] | None)`, `get_product_context(product_id)`, …) — same
controlled-access principle as the rest of the tool system.

## Scoped AI context on conversations

`AIConversation.context` can carry `{product_id?, order_id?, customer_id?, collection_id?,
storefront_version_id?, page_id?, section_id?}`. The frontend proposes this (e.g. "Optimize with
NOVA" on a product page attaches `product_id`); the backend validates it on conversation creation —
re-fetches every referenced entity scoped to `AuthContext.org_id`, drops anything that doesn't
resolve in-tenant. Context steers which read tools/system-prompt framing get used; it is never a
trust boundary — every tool call inside the conversation still goes through normal org_id-scoped
authorization regardless of what the context claims.

## "Create My Store" — onboarding workflow

Backend-tracked via `StoreCreationSession`, not just UI wizard state — resumable, auditable,
re-triggerable.

1. **brand_input** — owner enters name/what-they-sell/target customer/positioning/vibe/inspiration
   → `BrandProfile`.
2. **product_input** — owner uploads photos + any known info (all optional) → one `ProductDraft`
   per product; `field_status` starts `known` for anything typed, `requires_confirmation`
   otherwise.
3. **generating_products** (Product Agent) — generate title/description/SEO/category/tags/alt-text
   as `suggested`; never touch a `known` field. Owner reviews (accept/edit/reject); accepted drafts
   become real `Product` rows.
4. **generating_storefront** (Storefront Agent / storefront generation service) — finished
   `BrandProfile` + accepted `Product`s/`Collection`s + generated imagery → new
   `StorefrontVersion(status=draft)`.
5. **ready_for_review** — owner previews (shared renderer), hand-edits or asks NOVA for changes,
   publishes.
6. **completed** — session closes; the resulting store is what the rest of NOVA operates on.

## Product ingestion & AI product content workflow

```
Product Input → Product Understanding → Information Validation → Content Generation
→ SEO Generation → Categorization → Collection Suggestions → Image/Asset Suggestions
→ Product Draft (owner review) → Accept → Product
```

Implemented as one Product Agent tool-loop run per product, but the **structured output is written
field-by-field** into `ProductDraft.fields`/`field_status` — these are real data states, not
prompt-engineering steps that vanish after the call. The model never fabricates a factual spec
(material, dimensions, etc.) that wasn't supplied; category/tags/SEO/description are fair game to
suggest, physical specifications are not unless the owner provided them.

## AI image system

Lifestyle/product imagery only in Prototype 1. Generation runs off an accepted product's canonical
`ProductImage`; the result is stored as a new `ProductImage(role=generated, is_ai_generated=True,
source_image_id=<canonical>.id, provider, model, prompt_metadata, environment, mood)`. The
canonical image is immutable with respect to AI generation — only an explicit owner upload can
replace it. Generated images are selectable assets in Store Builder like any other image.

## Storefront generation workflow

`storefront_generation_service.py`, invoked by Create My Store step 4 and standalone later
("regenerate storefront"). Input: `BrandProfile` + accepted products/collections + available
lifestyle imagery + vibe. Output: `StorefrontVersion(status=draft)` with homepage (hero, featured
collection, product grid, brand story, promo area), nav, footer — built from the **same**
`StorePage`/`StoreSection`/`StoreTheme` rows a human editing through Store Builder would produce.
No separate renderer for AI-generated stores.

## Store Builder

Two editing modes over the same draft:
- **Structured**: admin forms → direct CRUD on `StoreSection`/`StoreTheme` on the current draft.
- **Natural language**: Storefront Agent reads draft structure + brand context + relevant
  products/collections → produces an explicit **Storefront Change Plan** (ordered list of intended
  edits, stored in that run's `AIAgentRun.result_json`) → shown to the owner before anything is
  touched → on confirmation, applied as the same structured mutations the manual path would make →
  always against the draft, never live.
- **Change awareness**: `diff_storefront_versions(before_id, after_id)` — structural comparison of
  two versions' section trees, computed on demand (publishing already snapshots draft→live as an
  immutable new version, so there's always a before/after pair to diff).

Publishing is always a separate, explicit operation from any draft edit.

## Store Manager

NOVA's high-level operator — understands products, inventory, orders, customers, sales, marketing,
storefront, promotions; delegates analysis/action planning to specialists. Structurally an
`AgentSpec` whose tool registry contains only store-wide read tools plus one meta-tool,
`delegate_to_agent(agent_key, instruction)`, which runs one specialized agent's own bounded loop.
Recursion is capped at exactly one level (Store Manager → one specialized agent → tools; a
specialized agent never itself delegates); both loops have independent round-trip caps.

**Store Health model** — structured, not prose:
```python
class StoreHealthFinding(BaseModel):
    category: Literal["sales","inventory","products","customers","storefront","marketing","operations"]
    metric: str
    status: Literal["good","watch","at_risk"]
    finding: str
    severity: Literal["low","medium","high"]
    evidence: dict
    suggested_action: str | None
```
Aggregated across delegated agents into a `StoreHealthReport(findings: list[StoreHealthFinding])`,
persisted in `AIAgentRun.result_json`.

**AI Action Plans** ("fix what you can"):
```
Analyze → Delegate → Collect findings → Create Action Plan → Classify by risk
→ auto-execute auto_executable items → create ToolProposals for everything else
→ owner approval → execute → verify → audit
```
Persisted as one `AgentActionPlan` row so the UI renders one reviewable unit; each sensitive item
still resolves through its own `ToolProposal`.

## Marketing Agent

Read access to products/inventory/sales/customers, plus `draft_campaign` (mutating, high-risk —
always a `ToolProposal`). No external send integration in Prototype 1 — drafting only.

## Frontend navigation (admin)

- **Operate**: Overview, Products, Inventory, Orders, Customers, Marketing
- **Grow**: Analytics, AI Workspace
- **Store**: Store Builder, Storefront (preview link)
- **System**: Activity, Settings

Every domain page has one contextual AI entry point that opens the AI Workspace with the relevant
`AIConversation.context` pre-attached (server-validated).

## Demo data — VELORA

One seeded org, premium handbags/accessories brand. ~25 products, 4–5 collections, variants,
inventory with deliberately seeded problems (low-stock bestsellers, dead stock, a declining
collection, high-traffic/low-conversion products, a churn-risk segment, abandoned carts). A few
`ProductDraft`s seeded with deliberately incomplete input to exercise the known/suggested/
requires_confirmation distinction. `SalesMetricDaily` + `AnalyticsEvent` rows (including
`hero_click`) pre-computed so Store Manager's findings have real evidence.

## Implementation phases

See the plan doc for the full table; summary: P0 scaffold → P1 auth → P2 commerce + Create My Store
foundation → P3 storefront renderer → P4 Store Builder (structured) → P5 AI foundation → P6 Product
Agent + images → P7 analytics + Sales/Inventory/Customer agents → P8 storefront generation +
Storefront/Marketing/Operations agents → P9 Store Manager orchestration → P10 VELORA seed + golden
demo wiring → P11 QA against the final product test.
