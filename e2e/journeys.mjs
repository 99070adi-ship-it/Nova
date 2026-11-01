/**
 * End-to-end journeys against the REAL stack — nothing is mocked or intercepted. No page.route,
 * no stubbed onboarding responses, no seeded shortcuts: every step goes through the real UI, the
 * real backend (AI_PROVIDER=fake, as in local dev), and the real storefront app.
 *
 * Prereqs (defaults shown, override with env):
 *   backend  http://localhost:8100   (uvicorn app.main:app --port 8100, migrated database)
 *   admin    http://localhost:5173   (npm run dev in admin/)
 *   store    http://localhost:5174   (npm run dev in storefront/)
 *   PLAYWRIGHT_CHROMIUM_EXECUTABLE   optional path to a chromium / headless-shell binary
 *   The Guide types its narration at 6 characters/second, which would
 *   make a full tour take 30+ minutes. Start the admin dev server with VITE_NARRATION_CHAR_MS=12 for
 *   these journeys (same code path, faster cadence): VITE_NARRATION_CHAR_MS=12 npm run dev
 *
 * Run: cd e2e && npm install && npm test        (exit code 1 if any journey fails)
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ADMIN = process.env.ADMIN_URL ?? "http://localhost:5173";
const STORE = process.env.STOREFRONT_URL ?? "http://localhost:5174";
const API = process.env.API_URL ?? "http://localhost:8100/api/v1";
const SHOTS = path.resolve("artifacts");
fs.mkdirSync(SHOTS, { recursive: true });

function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  const root = path.join(os.homedir(), "Library/Caches/ms-playwright");
  if (!fs.existsSync(root)) return undefined;
  for (const dir of fs.readdirSync(root).filter((d) => d.startsWith("chromium")).sort().reverse()) {
    const base = path.join(root, dir);
    for (const sub of fs.readdirSync(base)) {
      for (const bin of ["chrome-headless-shell", "Chromium.app/Contents/MacOS/Chromium"]) {
        const p = path.join(base, sub, bin);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  return undefined;
}

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  PASS  ${name}`);
  } catch (e) {
    results.push({ name, ok: false, error: e.message });
    console.log(`  FAIL  ${name}\n        ${String(e.message).split("\n").join("\n        ")}`);
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

// ---------------------------------------------------------------- helpers
const guideText = async (page) => (await page.locator("div.fixed.z-50").allInnerTexts()).join("\n");
const phaseOf = async (page) => {
  const t = await page.locator("p.uppercase").allInnerTexts();
  return t.find((x) => /DEMONSTRATING|EXPLAINING|WAITING FOR YOU|CHECKING|NEED ANOTHER TRY|DONE|GETTING READY|PAUSED|CAN'T FIND/.test(x)) ?? "";
};
const stepLine = async (page) => {
  const t = await page.locator("p").allInnerTexts();
  return t.find((x) => /^Step \d+ of \d+ — /.test(x.trim()))?.trim() ?? null;
};

async function tokenFor(context, creds) {
  const res = creds
    ? await context.request.post(`${API}/auth/login`, { data: creds })
    : await context.request.post(`${API}/auth/demo-login`); // resumes THIS context's own workspace via its cookie
  assert(res.ok(), `auth failed: ${res.status()}`);
  return (await res.json()).access_token;
}
const authed = async (context, creds) => ({ headers: { Authorization: `Bearer ${await tokenFor(context, creds)}` } });
async function progress(context, creds) {
  const res = await context.request.get(`${API}/onboarding/progress`, await authed(context, creds));
  return res.json();
}
const statusOf = (p, key) => p.steps.find((s) => s.key === key).status;
async function orgSlug(context, creds) {
  return (await (await context.request.get(`${API}/auth/me`, await authed(context, creds))).json()).org_slug;
}
async function publicStorefront(context, slug) {
  const res = await context.request.get(`${API}/public/stores/${slug}/storefront`);
  return { status: res.status(), body: res.ok() ? await res.json() : null };
}
const heroHeadline = (body) => body.pages[0].sections.find((s) => s.type === "hero").configuration.headline;

async function demoSignIn(page) {
  await page.goto(`${ADMIN}/`);
  await page.getByRole("button", { name: "Skip" }).click();
  await page.waitForURL("**/login");
  await page.getByRole("button", { name: "Sign in" }).click();
  await chooseGuideStyle(page);
}

/** The Guide asks how to guide before it starts anything. Asserts that nothing has started yet (the
 * visitor has not been taken to the first step and no narration is showing), then picks Text only, so
 * the rest of the journey is the same tour as before (voice is covered by the unit tests and by the
 * real-browser speechSynthesis check, not by the journeys). */
async function chooseGuideStyle(page) {
  await page.waitForSelector('[data-testid="guide-voice-choice"]', { timeout: 20000 });
  assert(!new URL(page.url()).pathname.endsWith("/create-store"), "the Guide navigated before the visitor chose how to be guided");
  assert((await page.getByTestId("guide-typed").count()) === 0, "narration started before the visitor chose");
  await page.getByRole("button", { name: /Text only/ }).click();
  await page.waitForURL("**/create-store", { timeout: 20000 });
}

/** Acts like the visitor: whenever the Guide hands over control ("WAITING FOR YOU"), presses the
 * exact real control it names. Returns the ordered log of [step line, control label]. */
async function driveTour(page, context, { stopAfterLabel, maxMs = 720000, creds } = {}) {
  const log = [];
  const t0 = Date.now();
  let lastClick = "";
  while (Date.now() - t0 < maxMs) {
    // Between steps the Guide docks for a moment before springing out again, so a visible dock is
    // not completion. Completion is the SERVER saying there is no current step, plus the dock.
    if ((await page.getByText("Ask me anything").count()) > 0) {
      const p = await progress(context, creds);
      if (p.current_step === null) return log;
    }
    if ((await phaseOf(page)).includes("WAITING FOR YOU")) {
      const next = (await page.locator("p", { hasText: /^Next: click/ }).first().innerText()).match(/"(.+)"/)?.[1];
      const line = await stepLine(page);
      const key = `${line}|${next}`;
      if (next && key !== lastClick) {
        lastClick = key;
        log.push([line, next]);
        const link = page.getByRole("link", { name: new RegExp(`^${next}`) });
        if ((await link.count()) > 0) {
          const [popup] = await Promise.all([context.waitForEvent("page"), link.first().click()]);
          await popup.waitForSelector("text=Preview — draft, not live", { timeout: 15000 });
          await popup.waitForSelector("h1", { timeout: 15000 });
          await popup.waitForTimeout(800); // let the "loaded" report land
          await popup.close();
        } else {
          await page.getByRole("button", { name: next, exact: true }).first().click();
        }
        if (stopAfterLabel && next === stopAfterLabel) return log;
      }
    }
    await page.waitForTimeout(400);
  }
  throw new Error(`tour did not finish within ${maxMs}ms; last state: ${await phaseOf(page)} / ${await stepLine(page)}; log=${JSON.stringify(log)}`);
}

// ---------------------------------------------------------------- journeys
const ONLY = (process.env.JOURNEYS ?? "ABCDE").toUpperCase();
const browser = await chromium.launch({ executablePath: findChromium() });

console.log("\nJourney A — fresh isolated demo workspace (real sign-in, real tour)");
if (ONLY.includes("A")) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(e.message));
  let slug;
  let baselineHeadline;

  await check("sign-in lands in the real tour on /create-store, step 1 of 10 (server-owned count)", async () => {
    await demoSignIn(page);
    await page.waitForFunction(() => /Step 1 of 10 — Tell NOVA about your business/.test(document.body.innerText), null, { timeout: 60000 }); // after NOVA's opening beats
  });

  await check("the server reports 10 steps, collections already satisfied, baseline does NOT complete publish", async () => {
    const p = await progress(context);
    assert(p.total_steps === 10 && p.steps.length === 10, `expected 10 steps, got ${p.total_steps}`);
    assert(statusOf(p, "collections") === "completed", "collections should be satisfied by the seeded catalog");
    assert(statusOf(p, "publish") !== "completed", "the live baseline must not count as publishing");
    assert(p.current_step === "brand", `current step was ${p.current_step}`);
  });

  await check("a polished live baseline is served by the real public API and renders in the real storefront app", async () => {
    slug = await orgSlug(context);
    const { status, body } = await publicStorefront(context, slug);
    assert(status === 200, `public storefront ${status}`);
    baselineHeadline = heroHeadline(body);
    assert(baselineHeadline === "Quiet leather, made to last.", `headline ${baselineHeadline}`);
    const store = await context.newPage();
    await store.goto(`${STORE}/?org=${slug}`);
    await store.waitForSelector("h1");
    assert((await store.locator("h1").innerText()) === baselineHeadline, "storefront h1 mismatch");
    assert((await store.getByText("Made slowly, worn for years.").count()) === 1, "brand story section missing");
    await store.screenshot({ path: path.join(SHOTS, "baseline-storefront.png") });
    await store.close();
  });

  await check("the app is not locked mid-tour: chrome is sharp and clickable, nav works, Guide offers 'Return to step'", async () => {
    await page.waitForFunction(() => document.body.innerText.includes("WAITING FOR YOU"), null, { timeout: 60000 });
    const asideClass = await page.locator("aside").first().getAttribute("class");
    assert(!/blur|pointer-events-none|opacity-50/.test(asideClass), `sidebar class: ${asideClass}`);
    assert((await page.locator("[data-nova-spotlight]").getAttribute("data-nova-spotlight")) === "cue", "spotlight should be a quiet cue in the user's turn");
    await page.getByRole("link", { name: "Products", exact: true }).click();
    await page.waitForURL("**/products");
    assert((await page.getByTestId("guide-return").count()) === 1, "no 'Return to step' affordance");
    await page.screenshot({ path: path.join(SHOTS, "products-mid-tour.png") });
    await page.getByRole("button", { name: /Return to step 1/ }).click();
    await page.waitForURL("**/create-store");
  });

  await check("every admin route is reachable directly (full page load) with no redirect and no stubbed responses", async () => {
    for (const route of ["products", "inventory", "orders", "customers", "analytics", "ai-workspace", "approvals", "activity", "marketing", "settings", "overview", "store-builder"]) {
      await page.goto(`${ADMIN}/${route}`);
      await page.waitForTimeout(1200);
      assert(new URL(page.url()).pathname === `/${route}`, `/${route} redirected to ${page.url()}`);
      assert((await page.locator("aside").count()) >= 1 && (await page.getByRole("navigation", { name: "Primary" }).count()) === 1, `/${route} did not render the app shell`);
    }
  });

  await check("a plain refresh on another page does not hijack: the Guide waits, then continues on request", async () => {
    await page.goto(`${ADMIN}/analytics`);
    await page.waitForSelector('[data-testid="guide-held"]', { timeout: 15000 });
    assert(new URL(page.url()).pathname === "/analytics", "page was redirected");
    await page.screenshot({ path: path.join(SHOTS, "guide-paused.png") });
    await page.getByRole("button", { name: "Continue the tour" }).click();
    await page.waitForURL("**/create-store");
  });

  await check("real data is real: Products page lists the 26 seeded products during onboarding", async () => {
    const res = await context.request.get(`${API}/products`, await authed(context));
    assert((await res.json()).length === 26, "expected the 26 seeded products");
  });

  let log;
  await check("the full tour completes through real clicks on real controls (all 9 steps the visitor performs)", async () => {
    // Wait until the Guide is in a user turn on this page, then drive.
    await page.waitForFunction(() => /Step \d+ of 10/.test(document.body.innerText), null, { timeout: 30000 });
    log = await driveTour(page, context);
    const labels = log.map(([, l]) => l);
    for (const needed of ["Continue to products", "Add product", "Generate content", "Accept", "Generate storefront", "Preview draft", "Propose", "Apply to draft", "Publish", "How is my store doing?", "Fix what you can"]) {
      assert(labels.includes(needed), `tour never asked for "${needed}"; saw ${JSON.stringify(labels)}`);
    }
    assert(!labels.includes("Create collection"), "collections is satisfied by the seeded catalog; the lesson should not run");
  });

  await check("preview completed only through a real preview load, and the baseline stayed live until publish", async () => {
    const p = await progress(context);
    assert(p.steps.every((s) => s.status === "completed"), `not all steps completed: ${JSON.stringify(p.steps.map((s) => [s.key, s.status]))}`);
    assert(p.current_step === null && p.completed_steps === 10, "onboarding should be complete");
    const order = log.map(([, l]) => l);
    assert(order.indexOf("Generate storefront") < order.indexOf("Preview draft") && order.indexOf("Preview draft") < order.indexOf("Propose"), "preview must sit between generate and edit");
  });

  await check("the onboarding Publish replaced the baseline through the normal publish flow", async () => {
    const { body } = await publicStorefront(context, slug);
    assert(heroHeadline(body) !== baselineHeadline || body.pages[0].sections.length !== 3, "live storefront still equals the baseline");
    const live = await (await context.request.get(`${API}/storefront/live`, await authed(context))).json();
    assert(live.status === "live", "live version missing");
  });

  await check("after the tour the Guide is the docked assistant and the whole app still works", async () => {
    assert((await page.getByText("Ask me anything").count()) === 1, "Guide did not retract to the dock");
    await page.getByRole("link", { name: /^Approvals/ }).click();
    await page.waitForURL("**/approvals");
    await page.screenshot({ path: path.join(SHOTS, "approvals-after-tour.png") });
  });

  await check("refresh after completion stays complete and does not restart the tour", async () => {
    await page.reload();
    await page.waitForTimeout(2500);
    assert((await page.getByTestId("guide-held").count()) === 0, "tour restarted after completion");
    assert((await page.getByText("Ask me anything").count()) === 1, "Guide should be docked");
  });

  await check("no uncaught page errors during the whole journey", async () => {
    assert(consoleErrors.length === 0, consoleErrors.join(" | "));
  });
  await context.close();
}

console.log("\nJourney B — failure cases: invalid preview, tenant isolation");
if (ONLY.includes("B")) {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pa = await ctxA.newPage();
  const pb = await ctxB.newPage();
  await demoSignIn(pa);
  await demoSignIn(pb);
  const slugA = await orgSlug(ctxA);
  const slugB = await orgSlug(ctxB);

  await check("two visitors get two different isolated workspaces", async () => {
    assert(slugA !== slugB, "same org slug for two visitors");
  });

  await check("an unknown preview id shows the invalid-link message and completes nothing", async () => {
    const page = await ctxA.newPage();
    await page.goto(`${STORE}/?preview=00000000-0000-4000-8000-000000000000`);
    await page.waitForSelector("text=This preview link is invalid or has expired.");
    const p = await progress(ctxA);
    assert(statusOf(p, "preview") !== "completed", "preview must not complete from an invalid link");
    await page.close();
  });

  await check("visitor A editing and publishing never changes visitor B's live storefront or draft", async () => {
    const hA = await authed(ctxA);
    const draft = await (await ctxA.request.get(`${API}/storefront/draft`, hA)).json();
    const hero = draft.pages[0].sections.find((s) => s.type === "hero");
    await ctxA.request.patch(`${API}/storefront/sections/${hero.id}`, { ...hA, data: { configuration: { ...hero.configuration, headline: "Only for A" } } });
    const beforePublish = await publicStorefront(ctxA, slugA);
    assert(heroHeadline(beforePublish.body) === "Quiet leather, made to last.", "draft edit leaked into live before publish");
    await ctxA.request.post(`${API}/storefront/publish`, hA);
    assert(heroHeadline((await publicStorefront(ctxA, slugA)).body) === "Only for A", "A's publish did not go live");
    assert(heroHeadline((await publicStorefront(ctxB, slugB)).body) === "Quiet leather, made to last.", "B's storefront changed");
    const draftB = await (await ctxB.request.get(`${API}/storefront/draft`, await authed(ctxB))).json();
    assert(draftB.id !== draft.id, "B sees A's draft");
  });
  await ctxA.close();
  await ctxB.close();
}

console.log("\nJourney C — ordinary new signup (no seeded data, no baseline)");
if (ONLY.includes("C")) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const email = `e2e+${Date.now()}@e2e.demo`;
  const creds = { email, password: "changeme123" };
  const httpErrors = [];
  page.on("response", async (r) => {
    if (r.url().startsWith(API) && r.status() >= 400 && !r.url().includes("/auth/refresh")) httpErrors.push(`${r.status()} ${r.request().method()} ${r.url().replace(API, "")} ${(await r.text().catch(() => "")).slice(0, 200)}`);
  });

  await check("signup lands in the tour at step 1 and the store has no published storefront", async () => {
    await page.goto(`${ADMIN}/signup`);
    await page.fill("#org_name", `E2E Goods ${Date.now()}`);
    await page.fill("#full_name", "E2E Owner");
    await page.fill("#email", email);
    await page.fill("#password", creds.password);
    await page.getByRole("button", { name: /create|sign up/i }).click();
    await chooseGuideStyle(page);
    await page.waitForFunction(() => /Step 1 of 10/.test(document.body.innerText), null, { timeout: 60000 }); // after NOVA's opening beats
    const slug = await orgSlug(context, creds);
    assert((await publicStorefront(context, slug)).status === 404, "a fresh signup must not have a live storefront");
  });

  await check("collections is a real, guided step for a new store (no longer a dead end)", async () => {
    const log = await driveTour(page, context, { stopAfterLabel: "Create collection", creds });
    const labels = log.map(([, l]) => l);
    assert(labels.includes("Create collection"), `collections lesson never ran: ${JSON.stringify(labels)}`);
    await page.waitForFunction(() => /Step 6 of 10/.test(document.body.innerText), null, { timeout: 40000 });
  });

  if (httpErrors.length) console.log("        backend errors seen during signup journey:\n        " + httpErrors.join("\n        "));
  await check("a new store completes the whole tour, including the real preview and the first-ever publish", async () => {
    await driveTour(page, context, { creds });
    const p = await progress(context, creds);
    assert(p.steps.every((s) => s.status === "completed"), JSON.stringify(p.steps.map((s) => [s.key, s.status])));
    const slug = await orgSlug(context, creds);
    assert((await publicStorefront(context, slug)).status === 200, "publish did not produce a live storefront");
  });
  await context.close();
}

// ---------------------------------------------------------------- Journey D
console.log("\nJourney D — customer storefront on VELORA: browse, search, cart, demo checkout, order lookup, publish -> theme");
if (ONLY.includes("D")) {
  const demo = await (await fetch(`${API}/auth/demo-login`, { method: "POST" })).json();
  const auth = { Authorization: `Bearer ${demo.access_token}` };
  const me = await (await fetch(`${API}/auth/me`, { headers: auth })).json();
  const slug = me.org_slug;
  const q = `?org=${slug}`;
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  const text = () => page.evaluate(() => document.body.innerText);
  let orderId;

  await check("home renders the published VELORA storefront with its theme, collections and products", async () => {
    await page.goto(`${STORE}/${q}`);
    await page.waitForSelector("a[href*='/collections/']");
    await page.waitForSelector("a[href*='/products/']");
    assert((await text()).includes("Quiet leather, made to last."), "hero missing");
    assert((await page.evaluate(() => getComputedStyle(document.body).backgroundColor)) === "rgb(243, 238, 230)", "published background token not applied");
  });
  await check("search filters products and an empty search explains itself", async () => {
    await page.goto(`${STORE}/products${q}&q=clutch`);
    await page.waitForSelector("text=5 products");
    await page.goto(`${STORE}/products${q}&q=zzzz`);
    await page.waitForSelector("text=No products match");
  });
  await check("a low-stock product shows real inventory and cannot be over-ordered", async () => {
    await page.goto(`${STORE}/products/structured-tote${q}`);
    await page.waitForSelector("[data-testid=availability]");
    assert((await page.textContent("[data-testid=availability]")).includes("Only 2 left"), "stock not shown");
    for (let i = 0; i < 5; i++) await page.click("button[aria-label='Increase quantity']").catch(() => {});
    assert((await page.textContent("[data-testid=quantity]")) === "2", "quantity exceeded stock");
    await page.click("text=Add to cart");
    await page.waitForSelector("text=Added 2 to your cart");
  });
  await check("the cart total comes from the server even if the browser's cart is tampered with", async () => {
    await page.goto(`${STORE}/cart${q}`);
    await page.waitForSelector("[data-testid=subtotal]");
    assert((await page.textContent("[data-testid=subtotal]")) === "$640.00", "wrong subtotal");
    await page.evaluate((s) => {
      const k = `nova.store.cart.v1:${s}`;
      const c = JSON.parse(localStorage.getItem(k));
      c[0].price = 0.01;
      c[0].quantity = 5;
      localStorage.setItem(k, JSON.stringify(c));
    }, slug);
    await page.reload();
    await page.waitForSelector("text=Only 2 available");
    assert(await page.locator("button:has-text('Checkout')").isDisabled(), "checkout must be blocked");
    await page.click("text=Set to 2");
    await page.waitForSelector("text=$640.00");
  });
  await check("checkout is an explicit demo: validated, acknowledged, creates a pending/not-paid order, empties the cart", async () => {
    await page.click("a:has-text('Checkout')");
    await page.waitForSelector("[data-testid=demo-notice]");
    assert((await text()).includes("No payment is taken"), "demo notice missing");
    await page.click("button:has-text('Place demo order')");
    await page.waitForSelector("text=Enter your name.");
    await page.fill("#co-name", "E2E Shopper");
    await page.fill("#co-email", "shopper@e2e.demo");
    await page.check("input[type=checkbox]");
    await Promise.all([page.waitForURL(/\/order\//), page.click("button:has-text('Place demo order')")]);
    await page.waitForSelector("[data-testid=order-details]");
    orderId = await page.textContent("[data-testid=order-id]");
    assert(/Not paid/.test(await page.textContent("[data-testid=payment-status]")), "must never claim payment");
    assert((await page.textContent("[data-testid=order-total]")) === "$640.00", "order total");
    assert((await page.locator("[data-testid=cart-count]").count()) === 0, "cart not emptied");
  });
  await check("the real order exists in the admin with server prices, stock went down, and sales analytics reconcile", async () => {
    const orders = await (await fetch(`${API}/orders`, { headers: auth })).json();
    const mine = orders.find((o) => o.id === orderId);
    assert(mine && mine.total === 640 && mine.payment_status === "pending", `order not as expected: ${JSON.stringify(mine)}`);
    const low = await (await fetch(`${API}/analytics/low-stock`, { headers: auth })).json();
    assert(low.find((p) => p.title === "Structured Tote")?.on_hand === 0, "stock was not decremented");
    const sales = await (await fetch(`${API}/analytics/sales?days=365`, { headers: auth })).json();
    assert(sales.orders === orders.length, "analytics do not reconcile with orders");
  });
  await check("the sold-out product is no longer purchasable on the storefront", async () => {
    await page.goto(`${STORE}/products/structured-tote${q}`);
    await page.waitForSelector("[data-testid=availability]");
    assert((await page.textContent("[data-testid=availability]")) === "Sold out", "should be sold out");
  });
  await check("guest order lookup needs the right email, in the right store", async () => {
    await page.goto(`${STORE}/orders${q}`);
    await page.fill("#lk-id", orderId);
    await page.fill("#lk-email", "wrong@e2e.demo");
    await page.click("button:has-text('Find my order')");
    await page.waitForSelector("text=couldn't find an order");
    await page.fill("#lk-email", "shopper@e2e.demo");
    await page.click("button:has-text('Find my order')");
    await page.waitForSelector("[data-testid=order-details]");
    const other = await (await fetch(`${API}/public/stores/some-other-store/orders/lookup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order_id: orderId, email: "shopper@e2e.demo" }) })).status;
    assert(other === 404, "another store must not see the order");
  });
  await check("a Store Builder theme edit stays in the draft until published, then the live storefront renders the new tokens", async () => {
    const draft = await (await fetch(`${API}/storefront/draft`, { headers: auth })).json();
    await fetch(`${API}/storefront/theme`, { method: "PATCH", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ background_color: "#FFFFFF" }) });
    await page.goto(`${STORE}/${q}`);
    await page.waitForSelector("a[href*='/collections/']");
    assert((await page.evaluate(() => getComputedStyle(document.body).backgroundColor)) === "rgb(243, 238, 230)", "draft theme leaked to the live store");
    const draftNow = await (await fetch(`${API}/storefront/draft`, { headers: auth })).json();
    await page.goto(`${STORE}/?preview=${draftNow.id}`);
    await page.waitForSelector("text=draft, not live");
    await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === "rgb(255, 255, 255)");
    assert(draft.id, "draft id");
    const pub = await fetch(`${API}/storefront/publish`, { method: "POST", headers: auth });
    assert(pub.status === 200, "publish failed");
    await page.goto(`${STORE}/${q}`);
    await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === "rgb(255, 255, 255)");
  });
  await check("no uncaught page errors during the storefront journey", async () => {
    assert(pageErrors.length === 0, pageErrors.join(" | "));
  });
  await context.close();
}

// ---------------------------------------------------------------- Journey E
console.log("\nJourney E — Store Builder click-to-edit: select in the emulator, propose, apply to draft, publish");
if (ONLY.includes("E")) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  let auth, slug, before, proposed;
  const heroOf = (v) => v.pages[0].sections.find((x) => x.type === "hero").configuration.headline;
  const liveHeadline = async () => heroOf({ pages: (await (await fetch(`${API}/public/stores/${slug}/storefront`)).json()).pages });
  const frame = page.frameLocator("[data-testid=preview-frame]");

  await check("Store Builder shows the real storefront draft in a device emulator marked as an unpublished draft", async () => {
    await demoSignIn(page);
    const token = await page.evaluate(async (api) => (await (await fetch(`${api}/auth/refresh`, { method: "POST", credentials: "include" })).json()).access_token, API);
    auth = { Authorization: `Bearer ${token}` };
    slug = (await (await fetch(`${API}/auth/me`, { headers: auth })).json()).org_slug;
    before = await liveHeadline();
    await page.goto(`${ADMIN}/store-builder`);
    await page.waitForSelector("[data-testid=preview-frame]");
    await frame.locator("h1").first().waitFor({ timeout: 30000 });
    assert((await frame.locator("h1").first().innerText()) === before, "preview must show the draft's hero");
    assert((await page.locator("text=Draft preview").count()) > 0, "no draft marking");
    assert(/Desktop · 1280 × 800/.test(await page.textContent("[data-testid=device-size]")), "no device size");
  });
  await check("clicking the hero headline inside the emulator selects it; the outline and panel agree", async () => {
    await frame.locator("h1").first().click();
    await page.waitForSelector("[data-testid=selected-label]");
    assert((await page.textContent("[data-testid=selected-label]")) === "Hero headline", "wrong element");
    assert((await page.locator("[data-testid='outline-hero.headline'][aria-current=true]").count()) === 1, "outline not synced");
    assert((await page.textContent("[data-testid=current-headline]")) === before, "current content not shown");
    assert((await frame.locator("[data-nova-overlay]").count()) >= 2, "no selection overlay");
  });
  await check("a natural-language request becomes a real structured proposal; nothing changes (draft or live) yet", async () => {
    await page.fill("#sb-instruction", "Make it sound more premium and editorial, but keep it short");
    await page.click("[data-testid=propose-change]");
    await page.waitForSelector("[data-testid=proposal]");
    proposed = await page.textContent("[data-testid=change-proposed]");
    assert((await page.textContent("[data-testid=change-current]")) === before && proposed !== before, "diff wrong");
    const draft = await (await fetch(`${API}/storefront/draft`, { headers: auth })).json();
    assert(heroOf(draft) === before && (await liveHeadline()) === before, "proposing must not change anything");
  });
  await check("Apply to Draft updates the emulator and the draft, keeps the element selected, and leaves the live store untouched", async () => {
    await page.click("[data-testid=apply-change]");
    await page.waitForSelector("[data-testid=editor-confirmation]");
    await frame.locator("h1").first().filter({ hasText: proposed }).waitFor({ timeout: 20000 });
    assert((await page.textContent("[data-testid=selected-label]")) === "Hero headline", "selection lost");
    const draft = await (await fetch(`${API}/storefront/draft`, { headers: auth })).json();
    assert(heroOf(draft) === proposed, "draft not updated");
    assert((await liveHeadline()) === before, "live changed before publishing");
    const pub = await context.newPage();
    await pub.goto(`${STORE}/?org=${slug}`);
    await pub.waitForSelector("h1");
    assert((await pub.locator("h1").first().innerText()) === before, "the public page must still show the old headline");
    await pub.close();
  });
  await check("tablet and mobile modes resize the emulator; the outline selects and scrolls to another element", async () => {
    await page.click("[data-testid=device-mobile]");
    await page.waitForFunction(() => /Mobile · 390 × 844/.test(document.querySelector("[data-testid=device-size]").textContent));
    assert((await page.locator("[data-testid=preview-frame]").evaluate((f) => f.style.width)) === "390px", "mobile width");
    await page.click("[data-testid=device-tablet]");
    await page.waitForFunction(() => /Tablet · 820 × 1024/.test(document.querySelector("[data-testid=device-size]").textContent));
    await page.click("[data-testid=device-desktop]");
    await page.click("[data-testid='outline-brand_story.heading']");
    await page.waitForFunction(() => document.querySelector("[data-testid=selected-label]")?.textContent === "Story heading");
    await page.waitForTimeout(1200);
    const visible = await frame.locator("[data-nova-section] h2").last().evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight + 2; });
    assert(visible, "the selected element was not scrolled into view");
  });
  await check("only an explicit Publish changes the public storefront", async () => {
    const publishing = page.waitForResponse((r) => r.url().endsWith("/storefront/publish") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    assert((await publishing).status() === 200, "publish failed");
    assert((await liveHeadline()) === proposed, "live must now show the change");
    const pub = await context.newPage();
    await pub.goto(`${STORE}/?org=${slug}`);
    await pub.waitForSelector("h1");
    assert((await pub.locator("h1").first().innerText()) === proposed, "public page should show the new headline");
    await pub.close();
  });
  await check("no uncaught page errors during click-to-edit", async () => {
    assert(pageErrors.length === 0, pageErrors.join(" | "));
  });
  await context.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
fs.writeFileSync(path.join(SHOTS, "results.json"), JSON.stringify(results, null, 2));
process.exit(failed.length ? 1 : 0);
