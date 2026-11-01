import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import App from "../App";
import type { Collection, Product, Storefront } from "../api/client";

export const variant = (over: Partial<Product["variants"][number]> = {}) => ({
  id: "var-1", sku: "SKU-1", price: 120, attributes: { color: "Cognac", material: "leather" }, available: 20, in_stock: true, low_stock: false, ...over,
});

export const product = (over: Partial<Product> = {}): Product => ({
  id: "p1", title: "Weekender Tote", slug: "weekender-tote", category: "Totes", description: "A roomy leather tote.", seo_title: null, seo_description: null,
  tags: ["totes"], images: [{ url: "http://api/static/x.svg", alt_text: "Weekender Tote in Cognac" }], variants: [variant()], ...over,
});

export const collection = (over: Partial<Collection> = {}): Collection => ({ id: "c1", title: "Totes", slug: "totes", description: "Carryalls.", product_ids: ["p1"], ...over });

export const storefront = (over: Partial<Storefront> = {}): Storefront => ({
  store_name: "Velora", org_slug: "velora-x", theme: { primary_color: "#2A1D15", background_color: "#F3EEE6", font_family: "Georgia, serif", border_radius: "2px" },
  pages: [{ slug: "home", title: "Home", order: 0, sections: [{ id: "s-hero", type: "hero", order: 0, configuration: { headline: "Quiet leather", cta_text: "Shop", cta_href: "/products" } }] }], ...over,
});

type Handler = (url: string, init?: RequestInit) => unknown | Promise<unknown>;

/** A fake backend: routes by path suffix. Returns {status, body}; unknown routes are a test failure. */
export function mockApi(routes: Record<string, Handler | unknown>) {
  const calls: Array<{ url: string; init?: RequestInit; body?: unknown }> = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const path = url.replace(/^.*\/public/, "");
    calls.push({ url: path, init, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const key = Object.keys(routes).find((k) => (k.startsWith("POST ") ? init?.method === "POST" && path.endsWith(k.slice(5)) : (!init?.method || init.method === "GET") && path.endsWith(k)));
    if (!key) throw new Error(`Unmocked request: ${init?.method ?? "GET"} ${path}`);
    const h = routes[key];
    const out = typeof h === "function" ? await (h as Handler)(url, init) : h;
    const { status = 200, body = out } = out && typeof out === "object" && typeof (out as { status?: unknown }).status === "number" ? (out as { status: number; body: unknown }) : { status: 200, body: out };
    return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fn);
  return { calls, fn };
}

export const baseRoutes = (over: Record<string, Handler | unknown> = {}) => ({
  "/stores/velora-x": { store_name: "Velora", slug: "velora-x", currency: "USD", demo_checkout: true, has_live_storefront: true, max_quantity_per_line: 10 },
  "/stores/velora-x/storefront": storefront(),
  "/stores/velora-x/products": [product()],
  "/stores/velora-x/collections": [collection()],
  "POST /stores/velora-x/events": { status: 204, body: null },
  ...over,
});

export function renderApp(path = "/?org=velora-x") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
