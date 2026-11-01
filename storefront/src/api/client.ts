/**
 * Public, unauthenticated client. The storefront never holds a credential: every call is a read (or a checkout/lookup)
 * against /api/v1/public/stores/{org_slug}/... and the server treats every value sent here as an untrusted claim.
 */
import { resolveOrgSlug } from "../lib/store";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8100/api/v1";

export class ApiError extends Error {
  status: number;
  code: string;
  details: Record<string, unknown>;
  constructor(status: number, message: string, code = "error", details: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function orgOrThrow(): string {
  const org = resolveOrgSlug();
  if (!org) throw new ApiError(404, "No store selected", "no_store");
  return org;
}

async function parse<T>(res: Response): Promise<T> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON error body
  }
  if (!res.ok) {
    const err = (body as { error?: { message?: string; code?: string; details?: Record<string, unknown> } } | null)?.error;
    throw new ApiError(res.status, err?.message ?? "Request failed", err?.code, err?.details);
  }
  return body as T;
}

async function storeFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const org = orgOrThrow();
  const res = await fetch(`${API_BASE_URL}/public/stores/${encodeURIComponent(org)}${path}`, init);
  return parse<T>(res);
}

const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export interface Section {
  id: string;
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
  org_slug: string;
  theme: Record<string, string>;
  pages: Page[];
}
export interface StoreInfo {
  store_name: string;
  slug: string;
  currency: string;
  demo_checkout: boolean;
  has_live_storefront: boolean;
  max_quantity_per_line: number;
}
export interface Variant {
  id: string;
  sku: string;
  price: number;
  attributes: Record<string, unknown> | null;
  available: number;
  in_stock: boolean;
  low_stock: boolean;
}
export interface ProductImage {
  url: string;
  alt_text: string | null;
}
export interface Product {
  id: string;
  title: string;
  slug: string;
  category: string | null;
  description: string | null;
  seo_title: string | null;
  seo_description: string | null;
  tags: string[];
  images: ProductImage[];
  variants: Variant[];
}
export interface Collection {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  product_ids: string[];
}
export interface CartLine {
  variant_id: string;
  product_slug: string | null;
  title: string | null;
  sku: string | null;
  attributes: Record<string, unknown> | null;
  image_url: string | null;
  unit_price: number | null;
  quantity: number;
  available: number;
  max_quantity: number;
  line_total: number | null;
  issues: Array<"unavailable" | "out_of_stock" | "insufficient_stock" | "quantity_capped">;
}
export interface CartResult {
  lines: CartLine[];
  subtotal: number;
  currency: string;
  can_checkout: boolean;
  shipping_note: string;
}
export interface OrderItem {
  title: string;
  sku: string;
  attributes: Record<string, unknown> | null;
  quantity: number;
  unit_price: number;
  line_total: number;
}
export interface Order {
  id: string;
  status: string;
  payment_status: string;
  total: number;
  currency: string;
  created_at: string;
  customer_name: string;
  customer_email: string;
  items: OrderItem[];
  demo: boolean;
  note: string;
  replayed: boolean;
}

export const getStoreInfo = () => storeFetch<StoreInfo>("");
export const getStorefront = () => storeFetch<Storefront>("/storefront");
export const listProducts = () => storeFetch<Product[]>("/products");
export const getProduct = (slug: string) => storeFetch<Product>(`/products/${encodeURIComponent(slug)}`);
export const listCollections = () => storeFetch<Collection[]>("/collections");
export const validateCart = (items: Array<{ variant_id: string; quantity: number }>) => storeFetch<CartResult>("/cart/validate", post({ items }));
export const checkout = (input: {
  idempotency_key: string;
  customer_email: string;
  customer_name: string;
  items: Array<{ variant_id: string; quantity: number }>;
  demo_checkout_acknowledged: boolean;
}) => storeFetch<Order>("/checkout", post(input));
export const lookupOrder = (orderId: string, email: string) => storeFetch<Order>("/orders/lookup", post({ order_id: orderId, email }));

// A draft preview is keyed by the version's own id, not the store slug (Store Builder links here).
export async function getStorefrontPreview(versionId: string) {
  const res = await fetch(`${API_BASE_URL}/public/preview/${versionId}`);
  return parse<Storefront>(res);
}

/** Tells the server this draft preview genuinely loaded AND rendered (the event behind onboarding's `preview` step).
 * Called only after sections are on screen; fire-and-forget so it can never break the preview. */
export function recordPreviewLoaded(versionId: string): Promise<void> {
  return fetch(`${API_BASE_URL}/public/preview/${versionId}/loaded`, { method: "POST" })
    .then(() => undefined)
    .catch(() => undefined);
}

export type EventType = "page_view" | "product_view" | "collection_view" | "add_to_cart" | "hero_click";

export function recordEvent(eventType: EventType, productSlug?: string) {
  const org = resolveOrgSlug();
  if (!org) return;
  // Fire-and-forget: analytics must never block or break browsing.
  fetch(`${API_BASE_URL}/public/stores/${encodeURIComponent(org)}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event_type: eventType, product_slug: productSlug ?? null }),
  }).catch(() => {});
}

/** Site-relative asset paths in published content (e.g. /static/velora/hero.svg) live on the API's origin. */
export function assetUrl(url: unknown): string | null {
  if (typeof url !== "string" || !url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (!url.startsWith("/") || url.startsWith("//")) return null;
  return `${API_BASE_URL.replace(/\/api\/v1\/?$/, "")}${url}`;
}
