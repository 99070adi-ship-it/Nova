# NOVA Demo Script

A canonical 8–10 minute walkthrough of Prototype 1. It follows the real Guide journey — every
screen shown is a screen the app actually produces from real backend state, nothing scripted or
faked. Automated coverage for this exact path lives in
`backend/tests/test_golden_path.py::test_golden_path_signup_through_run_business`; if that test
ever fails, this script is broken too and needs to be re-walked before a live demo.

## Before you start

1. Backend running (`uvicorn app.main:app --port 8100`), Postgres up, both frontends running
   (`admin` on `:5173`, `storefront` on `:5174`).
2. Reset to a clean baseline so the walkthrough below matches exactly (dev-only — see
   **Resetting between demos** at the end):
   ```
   curl -X POST http://localhost:8100/api/v1/dev/demo-reset
   ```
   This also restores the VELORA seeded account (`owner@velora.demo` / `changeme123`) used in
   Part 2 below.

---

## Part 1 — A fresh store, built live (~7 min)

This is the core of the demo: a brand-new merchant, no seeded data, built by NOVA end to end.

1. **Landing page** (`:5173/`) — narrate NOVA as an AI-native commerce operating system, not a
   dashboard with a chatbot bolted on. Click **Create my store**.
2. **Sign up** — real name/email/password, a real `Organization` created on the spot.
3. **NOVA Guide takes over** — the Guide panel on Create My Store narrates the journey from here;
   it reads real `StoreCreationSession`/onboarding progress, it doesn't recite a script.
4. **Brand** — fill in name, what you sell, target customer, vibe. Submit. Watch the Guide
   panel's progress rail advance to "Products" the instant this lands — no separate "mark
   complete" step.
5. **Products** — click **Use VELORA Sample Products** instead of typing products by hand. Five
   fully-specified example products appear instantly (say explicitly: this is a convenience
   shortcut, not a parallel "demo mode" — every one of these is a real `ProductDraft` going
   through the same pipeline a hand-entered product would).
6. **Catalog** — click **Generate content** on one draft; point out the Product Agent filling in
   description/SEO/category and marking those fields `suggested` (blue) vs the fields the sample
   data already specified, `known` (green).
7. **Review** — **Accept** all five drafts. They become real `Product` rows with inventory.
8. **Collections** — create one collection (e.g. "Everyday Carry") and add a product to it.
9. **Storefront** — click **Generate storefront**. The Guide hands off to **Store Builder**.
10. **Preview** — open "Preview draft" in a new tab (`:5174/?preview=<draft id>`) — a real
    storefront rendering real products, not a mockup.
11. **NL edit** — in Store Builder's **Ask NOVA** panel, type something like *"make the hero feel
    more premium"*. NOVA proposes a Change Plan — show the plan items *before* anything is
    touched, then **Apply to draft**, then re-open the preview to show the real change.
12. **Publish** — click **Publish**. The storefront is now live at `:5174/`.
13. **Run the business** — back on **Overview**, click **How is my store doing?**. Store Manager
    delegates to Sales/Inventory/Customer agents live — open the "delegation trace" to show
    exactly which tool each one called, not just a paragraph of prose. Click **Fix what you can**
    — anything low-risk executes automatically (system-approved, auditable); anything high-risk
    goes to **Approvals**. Open Approvals and approve one, narrating the plain-English proposal
    card (not raw JSON) before approving.

At this point the new org has gone from nothing to a published, AI-operated store, and every
action taken is a real row in the database — say so, and optionally show the **Activity** page's
audit trail as proof.

## Part 2 — A mature store with real problems (~2 min)

A brand-new org has no history, so Store Manager's findings above were necessarily thin. Log out
and sign in as the seeded VELORA account (`owner@velora.demo` / `changeme123`, restored by the
reset command above) to show what Store Health looks like against 26 products, 12 customers, and
60 days of deliberately seeded history:

- **Analytics** — real revenue, top products, low-stock items, inactive customers.
- **Overview → How is my store doing?** — this time the findings are substantive: low-stock
  bestsellers, a declining collection (Evening Clutches), a churn-risk customer segment. Click
  **Fix what you can** and show a `draft_campaign` proposal land in Approvals with actual copy,
  rendered as a campaign brief, not JSON.

## Resetting between demos

```
curl -X POST http://localhost:8100/api/v1/dev/demo-reset
```

Wipes the database and reseeds VELORA's baseline fresh. **Dev-only** — the route 404s unless
`ENV=local`; never expose it in a deployed environment. Safe to run as many times as needed
between walkthroughs; each call fully replaces the previous state, including anything created
during Part 1 (so re-run Part 1 from signup again after a reset, not mid-way through).
