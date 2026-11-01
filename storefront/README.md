# NOVA storefront (customer-facing)

A separate, anonymous SPA that renders a store's **published** theme and sections (or, with `?preview=<version id>`, its unpublished
draft, clearly marked). Run: `npm run dev` (port 5174). Tests: `npm test`. Build: `npm run build`.

- **Which store:** `?org=<slug>` (remembered for the session). There is no default store.
- **Pages:** home and extra published pages (`/pages/:slug`), shop with search/sort/category (`/products`), collections, product
  detail with variants and real stock, cart, demo checkout, order confirmation, guest order lookup (`/orders`), saved items.
- **Theme:** the published tokens (primary/background colour, font, radius) become CSS variables on the whole site.
- **Cart:** variant ids and quantities in this browser only. Every price, stock figure and total is read from the server
  (`POST /public/stores/{slug}/cart/validate`); nothing the browser sends is trusted.
- **Checkout is a labelled DEMO.** No payment provider is connected: no card details are collected, no payment is taken, and the
  order stays "payment pending". Shipping and tax are not configured, so none is calculated. An idempotency key prevents duplicate orders;
  stock rows are locked so the last unit cannot be oversold.
- **No customer accounts exist**, so orders are found with the order number plus the email used, and saved items live in the browser.
- **Not implemented** (and not faked): customer login, real payments, shipping/tax, discount codes, newsletter, reviews, rollback of a
  published storefront.

## Click-to-edit (Store Builder's visual editor)
Store Builder frames this app (`?preview=<draft id>&editor=1`) as a device emulator. The selection bridge (`src/editor/`) is active only when
the page is framed by an allow-listed admin origin (`VITE_ADMIN_ORIGINS`, default `http://localhost:5173`); anywhere else it registers
nothing. Renderer elements carry `data-nova-el="<key>"` tags that must match `contracts/editable-elements.json`, generated from the backend
registry (`backend/app/services/storefront_registry.py`; `python scripts/export_editable_elements.py`). Only identifiers cross the
boundary (see `src/editor/protocol.ts`). The embedded emulator does not count as the onboarding "preview loaded" event.
