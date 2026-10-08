// The customer-facing storefront app is a separate, unauthenticated SPA (storefront/src/api/
// client.ts) that resolves which org to display from an `?org=` query param first, falling back
// to its own build-time VITE_ORG_SLUG/"velora" default — that default only ever matches the one
// fixed dev fixture, never a real signup or an isolated per-visitor demo workspace (see
// backend/app/services/demo_service.py's Phase 0). Every admin-side link to the live storefront
// must carry the current org's own real slug, or it 404s against the wrong org.
export const STOREFRONT_ORIGIN = "http://localhost:5174";

export function liveStorefrontUrl(orgSlug: string | undefined): string {
  return orgSlug ? `${STOREFRONT_ORIGIN}/?org=${encodeURIComponent(orgSlug)}` : STOREFRONT_ORIGIN;
}
