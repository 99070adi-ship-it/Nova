/**
 * Hand-written API client. Kept hand-written (not generated from an OpenAPI schema) for
 * Prototype 1 to stay in lockstep with fast-moving backend routes without a codegen step.
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8100/api/v1";

export class ApiError extends Error {
  code: string;
  status: number;
  details: unknown;

  constructor(status: number, code: string, message: string, details: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    credentials: "include", // send/receive the httpOnly refresh cookie
  });

  if (res.status === 204) return undefined as T;

  const body = await res.json();
  if (!res.ok) {
    const err = body?.error ?? { code: "unknown", message: "Request failed" };
    throw new ApiError(res.status, err.code, err.message, err.details);
  }
  return body as T;
}

// ---- Auth ----

export interface CurrentUser {
  id: string;
  org_id: string;
  email: string;
  full_name: string;
  role: "owner" | "staff";
}

export async function login(email: string, password: string) {
  return apiFetch<{ access_token: string; expires_in: number }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function logout() {
  return apiFetch<void>("/auth/logout", { method: "POST" });
}

export async function getMe() {
  return apiFetch<CurrentUser>("/auth/me");
}

// ---- Products ----

export interface Variant {
  id: string;
  sku: string;
  price: number;
  cost: number | null;
  attributes: Record<string, unknown> | null;
}

export interface Product {
  id: string;
  title: string;
  slug: string;
  status: "draft" | "published" | "archived";
  category: string | null;
  tags: string[] | null;
  description: string | null;
  seo_title: string | null;
  seo_description: string | null;
  created_at: string;
  variants: Variant[];
}

export async function listProducts() {
  return apiFetch<Product[]>("/products");
}

export async function createProduct(input: {
  title: string;
  slug: string;
  category?: string | null;
  variants: { sku: string; price: number }[];
}) {
  return apiFetch<Product>("/products", { method: "POST", body: JSON.stringify(input) });
}

export interface ProductImage {
  id: string;
  url: string;
  role: "canonical" | "generated";
  is_ai_generated: boolean;
  provider: string | null;
  model: string | null;
  environment: string | null;
  mood: string | null;
  source_image_id: string | null;
  created_at: string;
}

export async function listProductImages(productId: string) {
  return apiFetch<ProductImage[]>(`/products/${productId}/images`);
}

export async function generateLifestyleImage(productId: string, input: { environment?: string; mood?: string }) {
  return apiFetch<ProductImage>(`/products/${productId}/images/generate`, { method: "POST", body: JSON.stringify(input) });
}

// ---- Collections ----

export interface Collection {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  created_at: string;
  product_ids: string[];
}

export async function listCollections() {
  return apiFetch<Collection[]>("/collections");
}

export async function createCollection(input: { title: string; slug: string; description?: string | null }) {
  return apiFetch<Collection>("/collections", { method: "POST", body: JSON.stringify(input) });
}

export async function addProductToCollection(collectionId: string, productId: string) {
  return apiFetch<void>(`/collections/${collectionId}/products`, {
    method: "POST",
    body: JSON.stringify({ product_id: productId }),
  });
}

// ---- Inventory ----

export interface InventoryRow {
  id: string;
  variant_id: string;
  location_id: string;
  on_hand: number;
  reserved: number;
  low_stock_threshold: number;
  sku: string;
  product_id: string;
  product_title: string;
}

export async function listInventory() {
  return apiFetch<InventoryRow[]>("/inventory");
}

export async function adjustInventory(inventoryId: string, delta: number, reason: string) {
  return apiFetch<InventoryRow>(`/inventory/${inventoryId}/adjust`, {
    method: "POST",
    body: JSON.stringify({ delta, reason }),
  });
}

// ---- Customers ----

export interface Customer {
  id: string;
  email: string;
  name: string;
  created_at: string;
}

export async function listCustomers() {
  return apiFetch<Customer[]>("/customers");
}

export async function createCustomer(input: { email: string; name: string }) {
  return apiFetch<Customer>("/customers", { method: "POST", body: JSON.stringify(input) });
}

// ---- Orders ----

export interface OrderItem {
  id: string;
  variant_id: string;
  quantity: number;
  unit_price: number;
}

export interface Order {
  id: string;
  customer_id: string;
  status: string;
  payment_status: string;
  total: number;
  created_at: string;
  items: OrderItem[];
}

export async function listOrders() {
  return apiFetch<Order[]>("/orders");
}

// ---- Promotions ----

export interface Promotion {
  id: string;
  code: string;
  type: string;
  value: number;
  active: boolean;
  created_at: string;
}

export async function listPromotions() {
  return apiFetch<Promotion[]>("/promotions");
}

export async function createPromotion(input: { code: string; type: "percentage" | "fixed_amount"; value: number }) {
  return apiFetch<Promotion>("/promotions", { method: "POST", body: JSON.stringify(input) });
}

// ---- Store creation ("Create My Store") ----

export type StoreCreationStatus =
  | "brand_input"
  | "product_input"
  | "generating_products"
  | "generating_storefront"
  | "ready_for_review"
  | "completed";

export interface StoreCreationSession {
  id: string;
  status: StoreCreationStatus;
  current_step: string | null;
  started_at: string;
  completed_at: string | null;
}

export async function startStoreCreation() {
  return apiFetch<StoreCreationSession>("/store-creation/start", { method: "POST" });
}

export async function getCurrentStoreCreation() {
  return apiFetch<StoreCreationSession>("/store-creation/current");
}

export async function submitBrandInput(input: {
  name: string;
  description?: string | null;
  sells_what?: string | null;
  target_customer?: string | null;
  positioning?: string | null;
  vibe_text?: string | null;
  tone?: string | null;
  inspiration_reference_text?: string | null;
}) {
  return apiFetch<StoreCreationSession>("/store-creation/brand-input", { method: "PUT", body: JSON.stringify(input) });
}

export type FieldStatus = "known" | "suggested" | "requires_confirmation";

export interface ProductDraft {
  id: string;
  status: "pending_generation" | "generated" | "owner_reviewing" | "accepted" | "rejected";
  fields: Record<string, unknown>;
  field_status: Record<string, FieldStatus>;
  source_image_refs: string[] | null;
  accepted_product_id: string | null;
  created_at: string;
}

export async function listProductDrafts() {
  return apiFetch<ProductDraft[]>("/store-creation/product-drafts");
}

export async function createProductDraft(input: {
  title?: string | null;
  description?: string | null;
  price?: number | null;
  sku?: string | null;
  category?: string | null;
  tags?: string[] | null;
  source_image_refs?: string[] | null;
}) {
  return apiFetch<ProductDraft>("/store-creation/product-drafts", { method: "POST", body: JSON.stringify(input) });
}

export async function generateProductDraftContent(draftId: string) {
  return apiFetch<ProductDraft>(`/store-creation/product-drafts/${draftId}/generate`, { method: "POST" });
}

export async function acceptProductDraft(draftId: string) {
  return apiFetch<ProductDraft>(`/store-creation/product-drafts/${draftId}/accept`, { method: "POST" });
}

export async function rejectProductDraft(draftId: string) {
  return apiFetch<ProductDraft>(`/store-creation/product-drafts/${draftId}/reject`, { method: "POST" });
}

// ---- Storefront / Store Builder ----

export interface StoreSection {
  id: string;
  type: string;
  order: number;
  configuration: Record<string, unknown>;
}

export interface StorePage {
  id: string;
  slug: string;
  title: string;
  order: number;
  sections: StoreSection[];
}

export interface StorefrontVersion {
  id: string;
  status: "draft" | "live";
  generated_by: "ai" | "owner" | "mixed";
  published_at: string | null;
  theme: Record<string, string>;
  pages: StorePage[];
}

export async function getStorefrontDraft() {
  return apiFetch<StorefrontVersion>("/storefront/draft");
}

export async function publishStorefront() {
  return apiFetch<StorefrontVersion>("/storefront/publish", { method: "POST" });
}

export async function getStorefrontDiff() {
  return apiFetch<{ changes: string[] }>("/storefront/diff");
}

export async function addSection(input: { page_id: string; type: string; order: number; configuration: Record<string, unknown> }) {
  return apiFetch<StorefrontVersion>("/storefront/sections", { method: "POST", body: JSON.stringify(input) });
}

export async function updateSection(sectionId: string, input: { order?: number; configuration?: Record<string, unknown> }) {
  return apiFetch<StorefrontVersion>(`/storefront/sections/${sectionId}`, { method: "PATCH", body: JSON.stringify(input) });
}

export async function deleteSection(sectionId: string) {
  return apiFetch<StorefrontVersion>(`/storefront/sections/${sectionId}`, { method: "DELETE" });
}

export async function updateTheme(input: Record<string, string>) {
  return apiFetch<StorefrontVersion>("/storefront/theme", { method: "PATCH", body: JSON.stringify(input) });
}

// ---- AI Workspace ----

export interface Conversation {
  id: string;
  agent_key: string;
  context: Record<string, unknown>;
  created_at: string;
}

export interface AIMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface PostMessageResult {
  assistant_text: string;
  hit_loop_cap: boolean;
  tool_call_log: { name: string; arguments: Record<string, unknown>; is_mutating: boolean }[];
}

export async function startConversation(input: { agent_key: string; context: Record<string, unknown> }) {
  return apiFetch<Conversation>("/ai/conversations", { method: "POST", body: JSON.stringify(input) });
}

export async function listMessages(conversationId: string) {
  return apiFetch<AIMessage[]>(`/ai/conversations/${conversationId}/messages`);
}

export async function postMessage(conversationId: string, text: string) {
  return apiFetch<PostMessageResult>(`/ai/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

// ---- Approvals ----

export interface ToolProposal {
  id: string;
  tool_name: string;
  arguments: Record<string, unknown>;
  risk_classification: "low" | "high";
  status: "proposed" | "approved" | "rejected" | "executing" | "executed" | "execution_failed" | "stale" | "expired";
  rejection_reason: string | null;
  execution_result: Record<string, unknown> | null;
  failure_reason: string | null;
  expires_at: string;
  created_at: string;
}

export async function listProposals(status?: string) {
  const query = status ? `?status=${status}` : "";
  return apiFetch<ToolProposal[]>(`/approvals${query}`);
}

export async function approveProposal(id: string) {
  return apiFetch<ToolProposal>(`/approvals/${id}/approve`, { method: "POST" });
}

export async function rejectProposal(id: string, reason?: string) {
  return apiFetch<ToolProposal>(`/approvals/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) });
}

// ---- Activity ----

export interface AuditLogEntry {
  id: string;
  actor_type: "user" | "ai" | "system";
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  created_at: string;
}

export async function listActivity() {
  return apiFetch<AuditLogEntry[]>("/activity");
}

// ---- Analytics ----

export interface TopProduct {
  title: string;
  revenue: number;
  units: number;
}

export interface SalesSummary {
  revenue: number;
  orders: number;
  top_products: TopProduct[];
  days: number;
}

export interface LowStockProduct {
  title: string;
  sku: string;
  on_hand: number;
  low_stock_threshold: number;
}

export interface CustomerActivityRow {
  name: string;
  email: string;
  order_count: number;
  last_order_at: string | null;
  inactive: boolean;
}

export async function getSalesSummary(days = 30) {
  return apiFetch<SalesSummary>(`/analytics/sales?days=${days}`);
}

export async function getLowStockProducts() {
  return apiFetch<LowStockProduct[]>("/analytics/low-stock");
}

export async function getCustomerActivity(inactiveDays = 30) {
  return apiFetch<CustomerActivityRow[]>(`/analytics/customers?inactive_days=${inactiveDays}`);
}

export { API_BASE_URL };
