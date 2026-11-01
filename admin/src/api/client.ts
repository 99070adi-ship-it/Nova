/**
 * Hand-written API client. Kept hand-written (not generated from an OpenAPI schema) for
 * Prototype 1 to stay in lockstep with fast-moving backend routes without a codegen step.
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8100/api/v1";

/** "Request validation failed" tells the person nothing; name the first field that was rejected and why. */
function friendlyValidationMessage(details: unknown): string | null {
  const first = (details as { errors?: { loc?: unknown[]; msg?: string }[] } | null)?.errors?.[0];
  if (!first?.msg) return null;
  const field = String(first.loc?.[first.loc.length - 1] ?? "").replace(/_/g, " ");
  const reason = first.msg.replace(/^(Value error, |value is not a valid email address: )/i, "").replace(/\.$/, "");
  const known = first.msg.toLowerCase().includes("valid email") ? "That email address isn't valid" : null;
  return known ?? (field ? `Check the ${field} field: ${reason}` : reason);
}

export class ApiError extends Error {
  code: string;
  status: number;
  details: unknown;

  constructor(status: number, code: string, message: string, details: unknown) {
    super(code === "validation_error" ? friendlyValidationMessage(details) ?? message : message);
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

/** NOVA's voice: the backend turns the exact narration text into speech (self-hosted Kokoro TTS; no
 * API key, nothing paid per request) and returns a WAV (the response's own Content-Type says so). Throws ApiError on any non-2xx, which the caller treats as "carry
 * on in text". `signal` aborts the request when the narration is replaced or cancelled. */
export async function fetchSpeech(text: string, signal?: AbortSignal): Promise<Blob> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
  const res = await fetch(`${API_BASE_URL}/ai/speech`, {
    method: "POST",
    headers,
    body: JSON.stringify({ text }),
    credentials: "include",
    signal,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const err = body?.error ?? { code: "unknown", message: "Speech request failed" };
    throw new ApiError(res.status, err.code, err.message, err.details);
  }
  return res.blob();
}

export type SpeechEngineState = "not_loaded" | "loading" | "ready" | "failed";
export interface SpeechStatus {
  engine: string;
  state: SpeechEngineState;
  ready: boolean;
}

/** Readiness of the voice engine, so the UI can tell "voice unavailable" from a normal answer. */
export async function getSpeechStatus(): Promise<SpeechStatus> {
  return apiFetch<SpeechStatus>("/ai/speech/status");
}

/** Starts loading the voice model in the background (idempotent); returns the current status at once. */
export async function warmUpSpeech(): Promise<SpeechStatus> {
  return apiFetch<SpeechStatus>("/ai/speech/warmup", { method: "POST" });
}

// ---- Auth ----

export interface CurrentUser {
  id: string;
  org_id: string;
  org_slug: string;
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

export async function signup(input: { org_name: string; full_name: string; email: string; password: string }) {
  return apiFetch<{ access_token: string; expires_in: number }>("/auth/signup", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// One-click, no form — resets the shared demo identity to a blank org server-side and logs
// straight into it. The mandatory onboarding gate (App.tsx) then runs exactly as it would for a
// brand new signup, every time (see backend/app/services/demo_service.py::reset_to_blank_demo).
export async function demoLogin() {
  return apiFetch<{ access_token: string; expires_in: number }>("/auth/demo-login", { method: "POST" });
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

export async function updateProductDraft(
  draftId: string,
  input: {
    title?: string | null;
    description?: string | null;
    price?: number | null;
    sku?: string | null;
    category?: string | null;
    tags?: string[] | null;
    seo_title?: string | null;
    seo_description?: string | null;
  }
) {
  return apiFetch<ProductDraft>(`/store-creation/product-drafts/${draftId}`, { method: "PATCH", body: JSON.stringify(input) });
}

// Onboarding shortcut ("add products" step) — five fully specified example products so a new
// merchant can see the rest of Create My Store without hand-typing products first.
export async function useVeloraSampleProducts() {
  return apiFetch<ProductDraft[]>("/store-creation/product-drafts/use-sample-products", { method: "POST" });
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
  /** A fingerprint of the draft's content; click-to-edit proposals are bound to it (stale ones are refused). */
  revision: string;
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

export interface ChangePlanItem {
  action: "add_section" | "update_theme" | "none";
  description: string;
  section_type?: string | null;
  configuration?: Record<string, unknown> | null;
}

export interface ChangePlan {
  agent_run_id: string;
  instruction: string;
  plan: ChangePlanItem[];
  applied: boolean;
}

export async function proposeChangePlan(instruction: string) {
  return apiFetch<ChangePlan>("/storefront/change-plan", { method: "POST", body: JSON.stringify({ instruction }) });
}

export async function applyChangePlan(agentRunId: string) {
  return apiFetch<StorefrontVersion>(`/storefront/change-plan/${agentRunId}/apply`, { method: "POST" });
}

// ---- Store Builder: click-to-edit ----

export interface EditableProperty {
  path: string;
  label: string;
  kind: "text" | "textarea" | "link" | "enum" | "int" | "color" | "collection_id" | "image_url";
  max_length: number | null;
  options: string[] | null;
  minimum: number | null;
  maximum: number | null;
  optional: boolean;
}
export interface EditableElement {
  key: string;
  section_type: string | null;
  label: string;
  properties: EditableProperty[];
  suggestions: string[];
}
export interface EditableRegistry {
  elements: EditableElement[];
  section_types: Array<{ type: string; label: string }>;
  fonts: Record<string, string>;
}
export interface ElementChange {
  path: string;
  label: string;
  current: unknown;
  proposed: unknown;
}
export interface ElementEditProposal {
  proposal_id: string;
  draft_id: string;
  revision: string;
  section_id: string | null;
  element: string;
  element_label: string;
  summary: string;
  reasoning: string;
  changes: ElementChange[];
  warnings: string[];
  state: "proposed" | "applied" | "discarded";
}

export async function getEditableElements() {
  return apiFetch<EditableRegistry>("/storefront/editable-elements");
}

export async function proposeElementEdit(input: { draft_id: string; revision: string; section_id: string | null; element: string; instruction: string }) {
  return apiFetch<ElementEditProposal>("/storefront/element-edit/propose", { method: "POST", body: JSON.stringify(input) });
}

export async function applyElementEdit(proposalId: string, revision: string) {
  return apiFetch<StorefrontVersion>(`/storefront/element-edit/${proposalId}/apply`, { method: "POST", body: JSON.stringify({ revision }) });
}

export async function discardElementEdit(proposalId: string) {
  return apiFetch<ElementEditProposal>(`/storefront/element-edit/${proposalId}/discard`, { method: "POST" });
}

// ---- AI provider status ----

export interface AiStatus {
  provider: "fake" | "nvidia" | "openai";
  model: string | null;
  real_ai: boolean;
  /** "language_model" for a real provider; "rule_based_demo" for the deterministic double (it follows rules, it is not an LLM). */
  mode: "language_model" | "rule_based_demo";
  credentials_configured: boolean;
  ready: boolean | null;
  reason?: string;
  config?: { restart_required: boolean; changed_on_disk: string[]; overridden_by_environment: string[]; env_file_found: boolean };
  /** The speech (text-to-speech) provider: independent of the text AI above. */
  voice?: { provider: string; role: string };
}

export async function getAiStatus() {
  return apiFetch<AiStatus>("/ai/status");
}

export async function generateStorefront() {
  return apiFetch<{ id: string; status: string }>("/store-creation/generate-storefront", { method: "POST" });
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
  /** How the assistant routed the message: small_talk, product_help, business_query, action_request, troubleshooting or ambiguous. */
  intent?: string | null;
}

export async function startConversation(input: { agent_key: string; context: Record<string, unknown> }) {
  return apiFetch<Conversation>("/ai/conversations", { method: "POST", body: JSON.stringify(input) });
}

export async function listMessages(conversationId: string) {
  return apiFetch<AIMessage[]>(`/ai/conversations/${conversationId}/messages`);
}

/** `screen` is the admin screen the person is on (e.g. "products"); the server checks it against an
 * allowlist, so the assistant can be relevant without trusting free-form client context. */
export async function postMessage(conversationId: string, text: string, screen?: string, focus?: Record<string, string>) {
  return apiFetch<PostMessageResult>(`/ai/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({ text, ...(screen ? { screen } : {}), ...(focus ? { focus } : {}) }),
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

// ---- Store Manager ----

export interface StoreHealthFinding {
  category: "sales" | "inventory" | "products" | "customers" | "storefront" | "marketing" | "operations";
  metric: string;
  status: "good" | "watch" | "at_risk";
  finding: string;
  severity: "low" | "medium" | "high";
  evidence: Record<string, unknown>;
  suggested_action: string | null;
}

export interface AgentToolCall {
  name: string;
  arguments: Record<string, unknown>;
  is_mutating: boolean;
}

export interface StoreHealthReport {
  run_id: string;
  findings: StoreHealthFinding[];
  narrative: Record<string, string>;
  trace: Record<string, AgentToolCall[]>;
  generated_at: string | null;
}

export interface ActionPlanItem {
  tool_name: string;
  risk: "low" | "high";
  auto_executable: boolean;
  status: string;
  proposal_id: string;
  description: string;
}

export interface ActionPlan {
  id: string;
  run_id: string;
  items: ActionPlanItem[];
  generated_at: string | null;
}

export async function getStoreHealth() {
  return apiFetch<StoreHealthReport>("/store-manager/health", { method: "POST" });
}

// Read-only — the Overview "needs attention" feed reads whatever Store Health last found instead
// of triggering a fresh multi-agent run on every page load. null until "How is my store doing?"
// has been run at least once.
export async function getLatestStoreHealth() {
  return apiFetch<StoreHealthReport | null>("/store-manager/health/latest");
}

// Read-only review of the last "Fix what you can" run — item statuses are refreshed against
// their live ToolProposal, so an item approved later through Approvals doesn't show stale here.
export async function getLatestActionPlan() {
  return apiFetch<ActionPlan | null>("/store-manager/action-plan/latest");
}

export async function createActionPlan() {
  return apiFetch<ActionPlan>("/store-manager/action-plan", { method: "POST" });
}

// ---- Onboarding progress ----

export type OnboardingStepKey =
  | "brand"
  | "products"
  | "catalog"
  | "review"
  | "collections"
  | "storefront"
  | "preview"
  | "nl_edit"
  | "publish"
  | "run_business";

export interface OnboardingStep {
  key: OnboardingStepKey;
  title: string;
  /** Plain-language rule the server uses to decide this step is done. */
  completion_rule: string;
  status: "locked" | "available" | "completed";
}

export interface OnboardingProgress {
  steps: OnboardingStep[];
  current_step: OnboardingStepKey | null;
  intro_video_seen: boolean;
  total_steps: number;
  completed_steps: number;
}

export async function getOnboardingProgress() {
  return apiFetch<OnboardingProgress>("/onboarding/progress");
}

export async function markIntroVideoSeen() {
  return apiFetch<OnboardingProgress>("/onboarding/intro-video-seen", { method: "POST" });
}

// ---- Photo Studio (real image generation / editing; enhancement is not offered yet) ----

export interface StudioImage {
  id: string;
  kind: "generated" | "edited" | "upload";
  prompt: string | null;
  style: string | null;
  model: string | null;
  width: number | null;
  height: number | null;
  source_image_id: string | null;
  created_at: string;
}
export interface StudioStatus {
  configured: boolean;
  demo_workspace: boolean;
  used_today: number;
  daily_limit: number;
  max_upload_mb: number;
  styles: { key: string; label: string }[];
  generate: { available: boolean; note: string | null };
  edit: { available: boolean; note: string | null };
  enhance: { available: boolean; note: string | null };
}

export const getStudioStatus = () => apiFetch<StudioStatus>("/photo-studio/status");
export const listStudioHistory = () => apiFetch<StudioImage[]>("/photo-studio/history");
export const studioGenerate = (body: { prompt: string; style: string; count: number }) =>
  apiFetch<{ images: StudioImage[]; failed: number; message: string | null }>("/photo-studio/generate", {
    method: "POST",
    body: JSON.stringify(body),
  });
export const deleteStudioImage = (id: string) => apiFetch<void>(`/photo-studio/images/${id}`, { method: "DELETE" });

/** Multipart upload: the browser must set the Content-Type (with its boundary) itself, so this bypasses apiFetch's JSON header. */
export async function studioEdit(prompt: string, image: File) {
  const form = new FormData();
  form.append("prompt", prompt);
  form.append("image", image);
  const headers: Record<string, string> = {};
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
  const res = await fetch(`${API_BASE_URL}/photo-studio/edit`, { method: "POST", headers, body: form, credentials: "include" });
  const body = await res.json();
  if (!res.ok) {
    const err = body?.error ?? { code: "unknown", message: "Request failed" };
    throw new ApiError(res.status, err.code, err.message, err.details);
  }
  return body as { original: StudioImage; edited: StudioImage };
}

/** Images are private (org-scoped, bearer-authenticated), so <img src> can't fetch them directly: fetch the bytes with the token. */
export async function fetchStudioImageBlob(id: string, download = false): Promise<Blob> {
  const headers: Record<string, string> = {};
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
  const res = await fetch(`${API_BASE_URL}/photo-studio/images/${id}${download ? "?download=true" : ""}`, { headers, credentials: "include" });
  if (!res.ok) throw new ApiError(res.status, "image_unavailable", "That image could not be loaded.", null);
  return res.blob();
}

export { API_BASE_URL };
