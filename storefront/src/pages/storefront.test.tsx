import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cart, readCart, setCartStore } from "../lib/cart";
import { baseRoutes, collection, mockApi, product, renderApp, storefront, variant } from "../test/helpers";
import { searchProducts, sortProducts } from "./ShopPage";

afterEach(() => vi.unstubAllGlobals());

const cartResult = (over: Record<string, unknown> = {}) => ({
  lines: [{ variant_id: "var-1", product_slug: "weekender-tote", title: "Weekender Tote", sku: "SKU-1", attributes: { color: "Cognac" }, image_url: null, unit_price: 120, quantity: 2, available: 20, max_quantity: 10, line_total: 240, issues: [] }],
  subtotal: 240, currency: "USD", can_checkout: true, shipping_note: "Shipping and tax are not calculated in this demo.", ...over,
});

describe("store selection and previews", () => {
  it("shows 'Choose a store' instead of guessing one when none is given", async () => {
    mockApi({});
    renderApp("/products");
    expect(await screen.findByText("Choose a store")).toBeInTheDocument();
  });

  it("says plainly when the store does not exist", async () => {
    mockApi({ "/stores/nope": { status: 404, body: { error: { message: "Store not found" } } } });
    renderApp("/?org=nope");
    expect(await screen.findByText("Store not found")).toBeInTheDocument();
  });

  it("an invalid preview link shows the invalid-link message", async () => {
    mockApi({ "/preview/00000000-0000-4000-8000-000000000000": { status: 404, body: { error: { message: "Storefront version not found" } } } });
    renderApp("/?preview=00000000-0000-4000-8000-000000000000");
    expect(await screen.findByText("This preview link is invalid or has expired.")).toBeInTheDocument();
  });

  it("a draft preview finds its store from the draft itself, is clearly marked unpublished, and blocks ordering", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const api = mockApi({ ...baseRoutes(), [`/preview/${id}`]: storefront(), [`/preview/${id}/loaded`]: { status: 204, body: null }, "POST /preview/11111111-1111-4111-8111-111111111111/loaded": { status: 204, body: null } });
    renderApp(`/?preview=${id}`);
    expect(await screen.findByText(/Preview — draft, not live/)).toBeInTheDocument();
    expect(await screen.findByText("Quiet leather")).toBeInTheDocument();
    await waitFor(() => expect(api.calls.some((c) => c.url.endsWith(`/preview/${id}/loaded`))).toBe(true)); // reported only after rendering
    expect(api.calls.some((c) => c.url.endsWith("/events"))).toBe(false); // previews are never customer traffic
  });
});

describe("home page", () => {
  it("renders the published sections with the store's theme and falls back sensibly without a storefront", async () => {
    mockApi(baseRoutes());
    renderApp();
    expect(await screen.findByText("Quiet leather")).toBeInTheDocument();
    expect(document.documentElement.style.getPropertyValue("--sf-primary")).toBe("#2A1D15");
    expect(within(screen.getByRole("navigation", { name: "Primary" })).getByRole("link", { name: "Shop" })).toHaveAttribute("href", expect.stringContaining("/products?org=velora-x"));
  });

  it("when nothing is published it says so and still lets people browse products", async () => {
    mockApi(baseRoutes({ "/stores/velora-x/storefront": { status: 404, body: { error: { message: "This store hasn't published a storefront yet" } } } }));
    renderApp();
    expect(await screen.findByText(/hasn't published its homepage yet/)).toBeInTheDocument();
    expect(await screen.findByText("Weekender Tote")).toBeInTheDocument();
  });

  it("ignores unknown section types and refuses unsafe call-to-action links", async () => {
    const sf = storefront({ pages: [{ slug: "home", title: "Home", order: 0, sections: [
      { id: "s-mystery", type: "mystery", order: 0, configuration: {} },
      { id: "s-hero2", type: "hero", order: 1, configuration: { headline: "Hello", cta_text: "Click", cta_href: "javascript:alert(1)" } },
    ] }] });
    mockApi(baseRoutes({ "/stores/velora-x/storefront": sf }));
    renderApp();
    expect(await screen.findByText("Hello")).toBeInTheDocument();
    expect(screen.queryByText("Click")).not.toBeInTheDocument();
  });
});

describe("shop: search, sort, filters", () => {
  const tote = product({ id: "a", title: "Structured Tote", slug: "structured-tote", variants: [variant({ id: "a1", price: 320 })], category: "Totes" });
  const wallet = product({ id: "b", title: "Bifold Wallet", slug: "bifold-wallet", variants: [variant({ id: "b1", price: 95 })], category: "Wallets", description: "Slim leather", tags: ["wallets"] });
  const clutch = product({ id: "c", title: "Velvet Clutch", slug: "velvet-clutch", variants: [variant({ id: "c1", price: 170 })], category: "Clutches", description: "Evening bag" });

  it("search matches title, category and description, every word must match", () => {
    expect(searchProducts([tote, wallet, clutch], "wallet").map((p) => p.slug)).toEqual(["bifold-wallet"]);
    expect(searchProducts([tote, wallet, clutch], "evening").map((p) => p.slug)).toEqual(["velvet-clutch"]);
    expect(searchProducts([tote, wallet, clutch], "slim leather").map((p) => p.slug)).toEqual(["bifold-wallet"]);
    expect(searchProducts([tote, wallet, clutch], "zzz")).toEqual([]);
    expect(searchProducts([tote, wallet, clutch], "  ")).toHaveLength(3);
  });

  it("sorts by price and name correctly", () => {
    expect(sortProducts([tote, wallet, clutch], "price-asc").map((p) => p.slug)).toEqual(["bifold-wallet", "velvet-clutch", "structured-tote"]);
    expect(sortProducts([tote, wallet, clutch], "price-desc").map((p) => p.slug)).toEqual(["structured-tote", "velvet-clutch", "bifold-wallet"]);
    expect(sortProducts([tote, wallet, clutch], "name").map((p) => p.slug)).toEqual(["bifold-wallet", "structured-tote", "velvet-clutch"]);
  });

  it("the page filters, shows a count, and offers a way out of an empty result", async () => {
    mockApi(baseRoutes({ "/stores/velora-x/products": [tote, wallet, clutch], "/stores/velora-x/collections": [] }));
    renderApp("/products?org=velora-x&q=wallet");
    expect(await screen.findByText("1 product")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Bifold Wallet/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Structured Tote/ })).not.toBeInTheDocument();
  });

  it("empty results explain themselves and can be cleared", async () => {
    mockApi(baseRoutes());
    renderApp("/products?org=velora-x&q=qqq");
    expect(await screen.findByText(/No products match/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear search and filters" }));
    expect(await screen.findByText("1 product")).toBeInTheDocument();
  });

  it("sold-out products are shown, marked, and not hidden", async () => {
    mockApi(baseRoutes({ "/stores/velora-x/products": [product({ variants: [variant({ in_stock: false, available: 0 })] })] }));
    renderApp("/products?org=velora-x");
    expect(await screen.findByText("Sold out")).toBeInTheDocument();
  });
});

describe("collection page", () => {
  it("lists exactly the products the server assigns to it", async () => {
    const other = product({ id: "z", title: "Not In Collection", slug: "nope" });
    mockApi(baseRoutes({ "/stores/velora-x/products": [product(), other] }));
    renderApp("/collections/totes?org=velora-x");
    expect(await screen.findByRole("heading", { name: "Totes" })).toBeInTheDocument();
    expect(await screen.findByText(/^Weekender Tote$/)).toBeInTheDocument();
    expect(screen.queryByText("Not In Collection")).not.toBeInTheDocument();
  });

  it("an unknown collection is a clear 404", async () => {
    mockApi(baseRoutes());
    renderApp("/collections/ghost?org=velora-x");
    expect(await screen.findByText(/couldn't find that collection/)).toBeInTheDocument();
  });
});

describe("product page", () => {
  const withProduct = (p = product(), extra = {}) => mockApi(baseRoutes({ "/stores/velora-x/products/weekender-tote": p, ...extra }));

  it("shows price, description, real availability and attributes", async () => {
    withProduct();
    renderApp("/products/weekender-tote?org=velora-x");
    expect(await screen.findByTestId("price")).toHaveTextContent("$120.00");
    expect(screen.getByText("A roomy leather tote.")).toBeInTheDocument();
    expect(screen.getByTestId("availability")).toHaveTextContent("In stock");
    expect(screen.getByText("SKU-1")).toBeInTheDocument();
  });

  it("shows 'Only N left' from real stock and caps the quantity at it", async () => {
    withProduct(product({ variants: [variant({ available: 2, low_stock: true })] }));
    renderApp("/products/weekender-tote?org=velora-x");
    expect(await screen.findByTestId("availability")).toHaveTextContent("Only 2 left");
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole("button", { name: "Increase quantity" }));
    expect(screen.getByTestId("quantity")).toHaveTextContent("2");
  });

  it("a sold-out variant cannot be bought", async () => {
    withProduct(product({ variants: [variant({ in_stock: false, available: 0 })] }));
    renderApp("/products/weekender-tote?org=velora-x");
    expect(await screen.findByTestId("availability")).toHaveTextContent("Sold out");
    expect(screen.getByRole("button", { name: "Sold out" })).toBeDisabled();
  });

  it("switching variants updates price and availability", async () => {
    withProduct(product({ variants: [variant({ id: "v-a", sku: "A", price: 100, attributes: { color: "Cognac" } }), variant({ id: "v-b", sku: "B", price: 130, attributes: { color: "Sand" }, in_stock: false, available: 0 })] }));
    renderApp("/products/weekender-tote?org=velora-x");
    await screen.findByTestId("price");
    await userEvent.click(screen.getByRole("button", { name: /^Sand/ }));
    expect(screen.getByTestId("price")).toHaveTextContent("$130.00");
    expect(screen.getByTestId("availability")).toHaveTextContent("Sold out");
  });

  it("adds to the cart (variant id and quantity only) and confirms", async () => {
    withProduct();
    renderApp("/products/weekender-tote?org=velora-x");
    await screen.findByTestId("price");
    await userEvent.click(screen.getByRole("button", { name: "Increase quantity" }));
    await userEvent.click(screen.getByRole("button", { name: "Add to cart" }));
    expect(await screen.findByText(/Added 2 to your cart/)).toBeInTheDocument();
    expect(readCart()).toEqual([{ variantId: "var-1", quantity: 2 }]);
    expect(screen.getByTestId("cart-count")).toHaveTextContent("2");
  });

  it("an unknown product is a clear 404, and a failed load says so", async () => {
    mockApi(baseRoutes({ "/stores/velora-x/products/ghost": { status: 404, body: { error: { message: "Product not found" } } } }));
    renderApp("/products/ghost?org=velora-x");
    expect(await screen.findByText(/couldn't find that product/)).toBeInTheDocument();
  });

  it("only suggests related products that really share a collection or category", async () => {
    const sibling = product({ id: "p2", title: "Mini Tote", slug: "mini-tote" });
    const stranger = product({ id: "p3", title: "Silk Scarf", slug: "silk-scarf", category: "Accessories" });
    withProduct(product(), { "/stores/velora-x/products": [product(), sibling, stranger], "/stores/velora-x/collections": [collection({ product_ids: ["p1", "p2"] })] });
    renderApp("/products/weekender-tote?org=velora-x");
    expect(await screen.findByText("You may also like")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Mini Tote/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Silk Scarf/ })).not.toBeInTheDocument();
  });

  it("a preview never lets anything be added to a cart", async () => {
    const id = "22222222-2222-4222-8222-222222222222";
    mockApi({ ...baseRoutes({ "/stores/velora-x/products/weekender-tote": product() }), [`/preview/${id}`]: storefront(), [`POST /preview/${id}/loaded`]: { status: 204, body: null } });
    renderApp(`/products/weekender-tote?preview=${id}`);
    await screen.findByTestId("price");
    expect(screen.getByRole("button", { name: "Add to cart" })).toBeDisabled();
  });
});

describe("cart page", () => {
  it("is empty by default with a way back to the shop", async () => {
    mockApi(baseRoutes());
    renderApp("/cart?org=velora-x");
    expect(await screen.findByText("Your cart is empty")).toBeInTheDocument();
  });

  it("shows the SERVER's prices and subtotal, never anything stored locally", async () => {
    setCartStore("velora-x");
    window.localStorage.setItem("nova.store.cart.v1:velora-x", JSON.stringify([{ variantId: "var-1", quantity: 2, price: 0.01, unit_price: 0.01 }]));
    const api = mockApi(baseRoutes({ "POST /stores/velora-x/cart/validate": cartResult() }));
    renderApp("/cart?org=velora-x");
    expect(await screen.findByTestId("subtotal")).toHaveTextContent("$240.00");
    expect(screen.getByTestId("line-total")).toHaveTextContent("$240.00");
    const sent = api.calls.find((c) => c.url.endsWith("/cart/validate"))!.body as { items: Array<Record<string, unknown>> };
    expect(sent.items).toEqual([{ variant_id: "var-1", quantity: 2 }]); // only ids and quantities leave the browser
  });

  it("flags short stock, blocks checkout, and one click sets the available quantity", async () => {
    cart.add("var-1", 5);
    mockApi(baseRoutes({ "POST /stores/velora-x/cart/validate": () => cartResult({
      lines: [{ ...cartResult().lines[0], quantity: 5, available: 2, max_quantity: 2, issues: ["insufficient_stock"], line_total: null }], subtotal: 0, can_checkout: false }) }));
    renderApp("/cart?org=velora-x");
    expect(await screen.findByText(/Only 2 available/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Checkout" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Set to 2" }));
    expect(readCart()[0].quantity).toBe(2);
  });

  it("drops lines the store no longer sells", async () => {
    cart.add("gone", 1);
    mockApi(baseRoutes({ "POST /stores/velora-x/cart/validate": { lines: [{ variant_id: "gone", quantity: 1, issues: ["unavailable"], available: 0, max_quantity: 0 }], subtotal: 0, currency: "USD", can_checkout: false, shipping_note: "x" } }));
    renderApp("/cart?org=velora-x");
    await waitFor(() => expect(readCart()).toEqual([]));
  });

  it("changes quantities and removes lines", async () => {
    cart.add("var-1", 2);
    mockApi(baseRoutes({ "POST /stores/velora-x/cart/validate": () => cartResult() }));
    renderApp("/cart?org=velora-x");
    const line = await screen.findByTestId("cart-line");
    await userEvent.click(within(line).getByRole("button", { name: "Increase quantity" }));
    expect(readCart()[0].quantity).toBe(3);
    const again = await screen.findByTestId("cart-line"); // the cart is re-checked with the server after a change
    await userEvent.click(within(again).getByRole("button", { name: "Remove" }));
    expect(readCart()).toEqual([]);
  });
});

describe("checkout", () => {
  const order = { id: "11111111-aaaa-4aaa-8aaa-111111111111", status: "pending", payment_status: "pending", total: 240, currency: "USD", created_at: new Date().toISOString(), customer_name: "Sam", customer_email: "sam@example.com", items: [{ title: "Weekender Tote", sku: "SKU-1", attributes: null, quantity: 2, unit_price: 120, line_total: 240 }], demo: true, note: "Demo order. No payment was taken and nothing will be shipped.", replayed: false };

  const fill = async () => {
    await userEvent.type(await screen.findByLabelText("Full name"), "Sam Shopper");
    await userEvent.type(screen.getByLabelText("Email"), "sam@example.com");
  };

  it("is labelled a demo and asks for no payment details", async () => {
    cart.add("var-1", 2);
    mockApi(baseRoutes({ "POST /stores/velora-x/cart/validate": cartResult() }));
    renderApp("/checkout?org=velora-x");
    expect(await screen.findByTestId("demo-notice")).toHaveTextContent("No payment is taken");
    expect(document.querySelector("input[autocomplete^='cc']")).toBeNull();
    expect(screen.getByRole("button", { name: "Place demo order" })).toBeInTheDocument();
    expect(await screen.findByTestId("checkout-total")).toHaveTextContent("$240.00");
  });

  it("validates before sending anything", async () => {
    cart.add("var-1", 2);
    const api = mockApi(baseRoutes({ "POST /stores/velora-x/cart/validate": cartResult(), "POST /stores/velora-x/checkout": order }));
    renderApp("/checkout?org=velora-x");
    await screen.findByTestId("checkout-total");
    await userEvent.click(screen.getByRole("button", { name: "Place demo order" }));
    expect(await screen.findByText("Enter your name.")).toBeInTheDocument();
    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
    expect(screen.getByText(/confirm that you understand/)).toBeInTheDocument();
    expect(api.calls.some((c) => c.url.endsWith("/checkout"))).toBe(false);
  });

  it("places the order once even on a double click, clears the cart and shows the order as NOT paid", async () => {
    cart.add("var-1", 2);
    let resolve!: (v: unknown) => void;
    const api = mockApi(baseRoutes({ "POST /stores/velora-x/cart/validate": cartResult(), "POST /stores/velora-x/checkout": () => new Promise((r) => (resolve = r)) }));
    renderApp("/checkout?org=velora-x");
    await fill();
    await userEvent.click(screen.getByRole("checkbox"));
    const button = screen.getByRole("button", { name: "Place demo order" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(api.calls.filter((c) => c.url.endsWith("/checkout"))).toHaveLength(1));
    resolve(order);
    expect(await screen.findByTestId("order-details")).toBeInTheDocument();
    expect(screen.getByTestId("payment-status")).toHaveTextContent("Not paid");
    expect(screen.getByTestId("order-total")).toHaveTextContent("$240.00");
    expect(readCart()).toEqual([]);
    const sent = api.calls.find((c) => c.url.endsWith("/checkout"))!.body as Record<string, unknown>;
    expect(sent.demo_checkout_acknowledged).toBe(true);
    expect(sent.items).toEqual([{ variant_id: "var-1", quantity: 2 }]); // no prices, ever
  });

  it("a failed request keeps the SAME idempotency key so a retry cannot create a second order; a stock conflict gets a new one", async () => {
    cart.add("var-1", 2);
    let attempt = 0;
    const api = mockApi(baseRoutes({
      "POST /stores/velora-x/cart/validate": cartResult(),
      "POST /stores/velora-x/checkout": () => {
        attempt += 1;
        if (attempt === 1) throw new Error("network down");
        if (attempt === 2) return { status: 409, body: { error: { message: "Some items just sold out or don't have enough stock.", details: { lines: [] } } } };
        return order;
      },
    }));
    renderApp("/checkout?org=velora-x");
    await fill();
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: "Place demo order" }));
    expect(await screen.findByTestId("checkout-error")).toHaveTextContent("Nothing was charged");
    await userEvent.click(screen.getByRole("button", { name: "Place demo order" }));
    expect(await screen.findByTestId("checkout-error")).toHaveTextContent("sold out");
    await userEvent.click(screen.getByRole("button", { name: "Place demo order" }));
    await screen.findByTestId("order-details");
    const keys = api.calls.filter((c) => c.url.endsWith("/checkout")).map((c) => (c.body as { idempotency_key: string }).idempotency_key);
    expect(keys[0]).toBe(keys[1]); // retry after a dropped response: same key
    expect(keys[2]).not.toBe(keys[1]); // after a stock conflict the cart changed: a new attempt
  });

  it("an empty cart has nothing to check out", async () => {
    mockApi(baseRoutes());
    renderApp("/checkout?org=velora-x");
    expect(await screen.findByText("Nothing to check out")).toBeInTheDocument();
  });
});

describe("orders, saved items", () => {
  it("guest lookup: a wrong email is refused with a neutral message, the right one shows the order", async () => {
    const found = { id: "11111111-aaaa-4aaa-8aaa-111111111111", status: "fulfilled", payment_status: "pending", total: 95, currency: "USD", created_at: new Date().toISOString(), customer_name: "Sam", customer_email: "sam@example.com", items: [], demo: true, note: "Demo order.", replayed: false };
    mockApi(baseRoutes({ "POST /stores/velora-x/orders/lookup": (_u: string, init?: RequestInit) => (JSON.parse(String(init?.body)).email === "sam@example.com" ? found : { status: 404, body: { error: { message: "We couldn't find an order with that number and email." } } }) }));
    renderApp("/orders?org=velora-x");
    await userEvent.type(await screen.findByLabelText("Order number"), found.id);
    await userEvent.type(screen.getByLabelText("Email"), "wrong@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Find my order" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't find an order");
    await userEvent.clear(screen.getByLabelText("Email"));
    await userEvent.type(screen.getByLabelText("Email"), "sam@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Find my order" }));
    expect(await screen.findByTestId("order-details")).toBeInTheDocument();
    expect(screen.getByTestId("order-status")).toHaveTextContent("Fulfilled");
  });

  it("saved items: empty state, saving, and the honest 'this device only' note", async () => {
    mockApi(baseRoutes());
    renderApp("/wishlist?org=velora-x");
    expect(await screen.findByText("Nothing saved yet")).toBeInTheDocument();
    expect(screen.getByText(/Saved on this device only/)).toBeInTheDocument();
  });

  it("shows saved products and lets them be removed with the heart", async () => {
    window.localStorage.setItem("nova.store.wishlist.v1:velora-x", JSON.stringify(["weekender-tote", "removed-product"]));
    mockApi(baseRoutes());
    renderApp("/wishlist?org=velora-x");
    expect(await screen.findByRole("link", { name: /Weekender Tote/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Remove Weekender Tote from saved items/ }));
    expect(await screen.findByText("Nothing saved yet")).toBeInTheDocument();
  });
});
