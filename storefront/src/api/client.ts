/**
 * Public, unauthenticated client — the storefront never holds a credential; every call is a
 * read against /api/v1/public/stores/{org_slug}/... (ARCHITECTURE.md "Repository layout": the
 * storefront app has a fundamentally different auth model than admin — anonymous browsing).
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8100/api/v1";
const ORG_SLUG = import.meta.env.VITE_ORG_SLUG ?? "velora";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}/public/stores/${ORG_SLUG}${path}`);
  const body = await res.json();
  if (!res.ok) {
    throw new ApiError(res.status, body?.error?.message ?? "Request failed");
  }
  return body as T;
}

export interface Section {
  type: string;
  order: number;
  configuration: Record<string, unknown>;
}

export interface Page {
  slug: string;
  title: string;
  order: number;
  sections: Section[];
}

export interface Storefront {
  store_name: string;
  theme: Record<string, string>;
  pages: Page[];
}

export interface Variant {
  id: string;
  sku: string;
  price: number;
}

export interface Product {
  id: string;
  title: string;
  slug: string;
  category: string | null;
  description: string | null;
  variants: Variant[];
}

export async function getStorefront() {
  return apiFetch<Storefront>("/storefront");
}

export async function listProducts() {
  return apiFetch<Product[]>("/products");
}

export async function getProduct(slug: string) {
  return apiFetch<Product>(`/products/${slug}`);
}

export type EventType = "page_view" | "product_view" | "collection_view" | "add_to_cart" | "hero_click";

export function recordEvent(eventType: EventType, productSlug?: string) {
  // Fire-and-forget — analytics must never block or break the browsing experience.
  fetch(`${API_BASE_URL}/public/stores/${ORG_SLUG}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event_type: eventType, product_slug: productSlug ?? null }),
  }).catch(() => {});
}
