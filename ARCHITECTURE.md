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
- **System**: Approvals, Activity, Settings

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

## Prototype 1 — Product Experience directive (post-P10)

P0–P10 built the **architecture**: a real commerce backend, agent/tool/approval/audit system, and
an `OpenAICompatibleProvider` already wired for real OpenAI (`AI_PROVIDER=openai` +
`OPENAI_API_KEY` + `OPENAI_MODEL`, selected in `ai/factory.py`) alongside the deterministic
`FakeLLMProvider`. What P0–P10 did **not** build is the *product experience* on top of it — the
admin app today is auth-gated CRUD pages plus one AI Workspace chat page; there is no public
landing page, no signup flow (`LoginPage` only — no register route, backend or frontend), no
first-run introduction, no guided demo, and the AI Workspace/home screen don't yet show NOVA
*working* (operational trace, evidence, artifacts, approvals) the way the architecture underneath
already supports. The risk named by this directive is real: without this layer NOVA reads as a
generic "dashboard + chatbot," even though the backend is not that.

**Principle**: every screen must be backed by the real workflows above — the operational trace,
Store Health findings, Change Plans, and ToolProposals already exist as data; this phase makes them
*visible*, and adds the missing front door (landing → signup → onboarding → guided demo) that lets
a new user reach them. No fake progress bars, no scripted UI disconnected from backend state.

New/changed concepts this phase introduces:
- **Public app shell**: an unauthenticated landing route in the admin app (or a third
  `marketing/` Vite app — TBD in Checkpoint 1) with the product narrative, an embeddable intro
  video asset (config-driven, not hardcoded — a `ProductAsset`-style row or static config pointing
  at a swappable URL), and a `/signup` flow (new backend endpoint + `Organization`/`User` creation,
  reusing the existing auth/JWT mechanism).
- **Post-signup routing (corrected — see "Onboarding — the NOVA Guide" below)**: signup does
  **not** land on a choice screen. First login transitions straight into the guided onboarding
  journey — the journey itself *is* the demo. `CreateMyStorePage` already implements the
  backend-tracked `StoreCreationSession` wizard end to end (§6 above); the Guide narrates that same
  real flow rather than replacing it.
- ~~Demo mode~~ **— superseded.** There is no separate seeded-scenario "demo mode" layered over the
  provider abstraction, and no peer "Explore Demo" choice inside the onboarding flow. VELORA's
  already-seeded data (P10) is used exactly once, as an *optional shortcut inside the "add
  products" onboarding step* ("Use VELORA Sample Products") — never as a parallel experience the
  user picks instead of building their own store. See "Onboarding — the NOVA Guide."
- **AI Workspace redesign**: restructure `AIWorkspacePage` from a chat transcript into
  conversation + evidence + proposed changes + an operational trace panel (agent → tool → result),
  rendering the *existing* `AIAgentRun.result_json` (`StoreHealthReport`, Change Plans) and
  `ToolProposal`/`AgentActionPlan` rows as structured panels instead of prose. No new backend data
  model — this is a rendering/composition change over data that already exists.
- **Home screen redesign**: `OverviewPage` becomes an operating-center view — headline metrics
  (already computed by `SalesMetricDaily`) plus a "needs attention" feed sourced from the latest
  `AIAgentRun` Store Health findings and low-stock/declining-collection conditions, with an "Ask
  NOVA" entry point. Again a composition change over existing read endpoints, not new backend
  concepts.
- **Navigation regrouping**: reorganize the admin sidebar into Home / Commerce / Grow / Store /
  NOVA / Settings (§28) — a routing/IA change, not a new feature.
- **DEMO_SCRIPT.md + golden-demo QA**: a canonical 5–10 minute demo script and an automated test
  suite exercising the full signup → Create My Store → Store Manager → agent delegation → action
  plan → approval → audit path end to end, so the demo can be re-run without breaking.

### Product film

The landing page (Checkpoint 1) needs a 30–60s product film — actual NOVA UI/product visuals, not
generic robot/AI-SaaS imagery — showing the real workflow, not a dramatized one:

1. Business owner enters NOVA → 2. brand/product info provided → 3. product images uploaded →
4. NOVA understands the products → 5. product drafts generated → 6. collections created →
7. storefront generated → 8. storefront preview appears → 9. owner asks Store Manager about
performance → 10. specialized agents analyze the store → 11. NOVA identifies an opportunity →
12. owner requests a change → 13. storefront draft changes → 14. owner approves → 15. result
appears in the storefront → 16. analytics reflects the business.

Every scene should be a real screen this prototype actually produces (Create My Store step
progress, `ProductDraft` known/suggested fields, the generated `StorefrontVersion` preview, the AI
Workspace evidence/trace panel, a Change Plan approval, the updated storefront, `AnalyticsPage`) —
captured as footage/screen recording once those screens exist, not commissioned separately. Stored
as a swappable, config-driven asset (a URL/path the landing page reads, not a hardcoded `<video>`
src) so a Prototype-1 placeholder can be replaced by a professionally produced film later with zero
app changes. Landing page CTAs: **[Watch NOVA]  [Explore Demo]  [Create My Store]**.

### OpenAI provider — structured contract requirement

`OpenAICompatibleProvider` (used for both `AI_PROVIDER=openai` and `=nvidia`) must satisfy the same
structured contract as `FakeLLMProvider` — not a "send prompt → receive text" integration — because
`agent_loop.run_agent` and every calling service are written against `LLMProvider` and never against
a specific vendor. Checked against the current implementation:

- **Bounded multi-turn tool execution** — `run_agent`'s `max_round_trips` loop already applies to
  every provider equally (`agent_loop.py`); not provider-specific code.
- **Tool/function calls + tool results returned to the model** — already implemented: `step()`
  sends `tools_payload` and folds prior `ToolResultMessage`s back in as `role: tool` messages.
- **Schema validation** — already implemented, provider-agnostic: `validate_tool_arguments()` in
  `ai/tools.py` runs every tool call's arguments through its Pydantic `args_model` regardless of
  which provider produced them; `agent_service.py` catches invalid-args/unknown-tool exceptions and
  reports them back to the model as a tool result rather than raising.
- **Structured agent results** — already implemented: `AgentLoopResult`/`ProviderStepResult` are
  the same dataclasses for every provider; downstream services parse the final answer into
  `StoreHealthReport`/Change Plan/etc.
- **Configurable model** — already implemented: `OPENAI_MODEL` / `NVIDIA_CHAT_MODEL` env vars flow
  through `factory.py`; no model name is hardcoded in application code.
- **Token usage tracking** — already implemented: `step()` reads `response.usage` and `run_agent`
  accumulates `prompt_tokens`/`completion_tokens` into `AIAgentRun`.
- **Graceful provider/API failure handling — closed (Checkpoint 6).** Every provider call —
  `agent_loop.run_agent`'s tool-calling loop and each service's single-shot structured-output call
  (Product Agent, Storefront Agent, Store Manager's missing-description generation) — now goes
  through `app/ai/reliability.safe_provider_step`, which catches any exception the provider raises
  (vendor SDK error, timeout, network failure) and re-raises it as the one type callers handle:
  `AIProviderError`. Every service function that owns an `AIAgentRun` wraps its body in
  `reliability.guard_agent_run`, which finalizes that run as `failed` (never `completed`, never
  left `running`) before re-raising for the route layer's existing `DomainError` handler to turn
  into a `503 ai_provider_unavailable` envelope carrying only the safe, generic user-facing message
  — no vendor exception text, stack trace, or API key ever reaches the response. Covered by
  `backend/tests/test_ai_reliability.py`: a raised provider exception on the conversational
  assistant, Product Agent draft generation, Storefront Agent change-plan proposal, Store Manager
  health check, and Store Manager action-plan generation each leave their respective mutation
  untouched (draft fields, storefront draft, `AgentActionPlan`) and the run recorded `failed`.

The provider abstraction itself needs no interface change for any of this — `LLMProvider` already
has the right shape; the gap is exception handling in the loop that every provider shares, not
something to special-case per vendor.

### Onboarding — the NOVA Guide (correction, supersedes the earlier "guided demo" concept)

**This corrects and replaces Checkpoint 1's post-signup "Welcome to NOVA" choice screen.** The
earlier design (Create My Store / Explore Demo / Start with Existing Store as three peer choices)
was wrong: it turns onboarding into a menu the user picks from instead of NOVA actually guiding
them. The corrected principle:

```
sign in → (first login only) auto-playing intro video, skippable → NOVA Guide agent takes over
→ user actually builds a real store, step by step → NOVA teaches store management using that
real store → final summary
```

**The onboarding is the demo.** There is no parallel "explore a fake environment" mode inside it.
If VELORA's seeded catalog is useful, it's an optional shortcut *inside* the "add products" step
only (§11 of the correction) — never a top-level choice that bypasses building a real store. (The
public, pre-signup landing page's "Explore demo" link is a *different* use case — a prospect
previewing NOVA before creating an account — and is unaffected by this correction, which is scoped
to what happens after sign-in.)

**Journey → real backend state.** Ten narrative steps, each backed by data that already exists
(P2–P9) rather than a new parallel progress flag table — completion is *derived*, per the
correction's §24, not separately tracked:

| Step | What the user does | Completion derived from |
|---|---|---|
| 1. Brand | Tell NOVA what the business sells | `BrandProfile` exists (`name` is the only required field) |
| 2. Products | Add products (or "Use VELORA Sample Products" shortcut) | ≥1 `ProductDraft` exists |
| 3. Catalog | NOVA generates content | Product Agent run completed → drafts have `status=generated` |
| 4. Review | Owner accepts/edits/rejects suggestions | All drafts resolved (`accepted`/`rejected`) |
| 5. Collections | NOVA suggests, owner approves | ≥1 `Collection` exists |
| 6. Storefront | NOVA generates the store | A `StorefrontVersion(status=draft)` exists that was **generated** (`generated_by != owner`) — the blank draft Store Builder auto-creates never counts |
| 7. Preview | Owner previews the real storefront | The generated draft's `preview_loaded_at` is set — recorded by `POST /public/preview/{id}/loaded`, which the storefront app calls only after the preview sections have rendered (first load wins; live versions and empty drafts are ignored) |
| 8. NL edit | Owner asks NOVA to change something | ≥1 Storefront Change Plan `AIAgentRun` exists |
| 9. Publish | Owner publishes | A non-baseline `live` version was published at/after the generated draft was created. The seeded demo baseline (`is_seed_baseline`) never counts |
| 10. Run the business | "How is my store doing?" → "Fix what you can" | Store Manager `AIAgentRun` **and** ≥1 `AgentActionPlan` exist |

**The backend is the single canonical definition of this sequence.** `onboarding_service.STEP_DEFINITIONS`
fixes each step's key, order, title, plain-language completion rule and predicate;
`/onboarding/progress` returns all of it (plus `total_steps`/`completed_steps`) and the admin Guide
renders "Step N of M" from that response, never from its own list. `contracts/onboarding-steps.json`
is generated from the definitions (`backend/scripts/export_onboarding_contract.py`); a backend test
fails if it is stale and an admin test fails if any server step lacks a lesson or a title differs.
Steps already satisfied by seeded data (e.g. `collections` in a demo workspace) show as completed
from the start — the list never changes shape.

**No route gate.** Every authenticated page is always reachable. The Guide is a persistent companion:
it navigates to a step's page right after sign-in and after each completed step, but on a plain
refresh elsewhere it waits ("Continue the tour"), and mid-step it offers "Return to step". NOVA's
spotlight dims and blurs only while demonstrating; in the user's turn it is a click-through cue.
Completion only ever comes from the server-derived state above, and every data endpoint still
enforces auth and tenant isolation.

**Demo baseline.** Every demo workspace (isolated per visitor, and the dev fixture) is seeded with a
polished published VELORA storefront: a real `live` `StorefrontVersion` in the same tables, served by
the same public API and rendered by the same storefront app. It is flagged `is_seed_baseline`. There
is no draft until onboarding generates one (or Store Builder opens, which then copies what is live).
The baseline stays live while the visitor builds; onboarding's Publish step publishes the draft
through the normal validated, idempotent publish flow.

**Known follow-ups (deliberately not in this change):**
- `preview` trust model: the storefront app reports the load and the server only checks the version is a non-empty draft; a caller who knows the (unguessable) version id could record it. Tighten if previews ever become sensitive.
- The storefront renderer does not yet apply `StoreTheme` tokens, so the VELORA baseline's colours/fonts are stored but not visible. Belongs with the storefront visual phase.
- Regenerating the storefront after publishing makes `publish` incomplete again (the rule is tied to the current generated draft).

A new `onboarding_service.get_progress(org_id) -> OnboardingProgress` computes each step's
`locked \| available \| in_progress \| completed` status from these queries every time it's asked —
survives a page refresh for free, requires no new mutable state machine, and can never drift from
what the store actually contains. The **only** new persisted field this needs is a one-shot
"has this org's owner seen the intro video" flag (a nullable timestamp on `User`, set the first time
the video is shown) — everything else in the table above already exists.

**The NOVA Guide is a real agent, not a scripted tooltip engine.** A new `AgentSpec("nova_guide",
...)` runs through the same `agent_loop.run_agent` every other agent uses, with a scoped **read-only**
tool set (`get_onboarding_progress`, plus the existing `get_brand_profile`/`get_product_context`-style
context tools) — it narrates what happened, why, and what's next, and reacts to real state, but it
does not itself call mutating tools. The actual mutations (submit brand input, create a product
draft, generate storefront, publish, propose a Change Plan) continue to happen through the existing,
already-tested Create My Store / Storefront / Store Manager REST endpoints that the UI calls
directly — the Guide sits alongside that flow as commentary grounded in real tool reads, not a
replacement plumbing layer, and it never bypasses the proposal/approval gate any mutating action
already goes through. This keeps the blast radius of this feature to "a new agent + a progress
query," not "re-route Create My Store through the tool-calling loop."

**UI**: a persistent "NOVA Guide" panel (not a modal wizard) showing the current step, a short
explanation in the Guide's voice, a progress rail (`✓ Brand  ✓ Products  → Catalog  ○ Collections
...`), and the one action the user needs to take next — driven by `get_progress`, so it updates the
moment the underlying state changes (e.g. the panel advances to "Catalog" the instant a
`ProductDraft` is created, with no separate "mark step complete" click).

**Intro video**: opens automatically on first login only (gated by the new `User` flag), inside the
app (dimmed background, not a page navigation), muted-autoplay with `[Mute/Unmute]` and `[Skip]`
only — no "Watch Later," no other choices. Finishing or skipping transitions directly into the
Guide panel; there is no intermediate screen.

### Checkpoints

Each checkpoint below stops for review before the next starts (no silent continuation through the
list) and reports: what was implemented, files changed, tests added/passed, known limitations, and
what's next.

1. **Foundation** *(amended)* — product/architecture spec update (this section) + product shell
   scaffolding: landing route, signup endpoint + form, nav-only regrouping, and the landing page's
   `[Watch NOVA] [Explore Demo] [Create My Store]` CTAs with a config-driven (swappable) slot for
   the product film asset. The post-signup screen is a single "Hi, I'm NOVA" transition into
   Create My Store — **not** a three-choice screen — pending the real Guide panel from Checkpoint 4.
2. **Commerce + demo store + storefront** — verify/harden VELORA data and the storefront renderer;
   no schema changes expected (P10 already seeded this).
3. **Onboarding progress model** — `onboarding_service.get_progress(org_id)` deriving the ten-step
   table above from real state (no new state-machine table); the one new field (`User` intro-video-
   seen flag); wire `CreateMyStorePage`'s "building your store" display to real
   `StoreCreationSession`/agent-run progress instead of a static checklist.
4. **NOVA Guide agent + guided UI** — the `nova_guide` `AgentSpec` (scoped read tools only), the
   persistent Guide panel replacing the old wizard checklist, and the auto-playing/skippable
   first-login intro video modal.
5. **Store Builder + preview/publish** — verify ADMIN/PREVIEW/LIVE switch and Change-Plan
   preview/approve UI meet §22–23; likely UI-only, since `diff_storefront_versions` and the
   approval pipeline already exist. This is Guide steps 7–9 (preview, NL edit, publish).
6. **OpenAI provider + AI foundation** — largely done (`OpenAICompatibleProvider`, config-driven
   `OPENAI_MODEL`, tool calls, schema validation, token tracking — see **OpenAI provider —
   structured contract requirement** above); this checkpoint closes the one real gap (provider/API
   failures aren't caught in `agent_loop.run_agent`, so they crash instead of failing the
   `AIAgentRun` closed) plus docs and `.env.example`.
7. **Product Agent + Storefront Agent UI** — surface known/suggested/requires_confirmation and
   Change Plan preview/approve per §24–26; backend already supports this (P6, P8). This is Guide
   steps 3–4 (catalog generation, review).
8. **Analytics + Sales/Inventory/Customer agents UI** — surface their findings in the redesigned
   AI Workspace and home screen "needs attention" feed; backend already supports this (P7).
9. **Operations + Marketing agents UI** — same treatment for Marketing Agent's `draft_campaign`
   proposals (P8).
10. **Store Manager orchestration UI** — operational-trace rendering for `delegate_to_agent` runs
    and `AgentActionPlan` review (P9 backend already supports this). This is Guide step 10 ("how is
    my store doing?" / "fix what you can") — the point where onboarding hands off to normal NOVA.
11. **DEMO_SCRIPT.md + demo reset + golden-path QA** — the canonical demo script now documents
    walking a fresh signup through the real Guide journey (using the VELORA sample-products
    shortcut at step 2, not a separate demo mode); a `demo reset` endpoint (dev-only, gated) restores
    VELORA's seeded baseline for repeat demos; automated test coverage for the full path (§34).
