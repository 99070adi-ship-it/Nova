// The customer-facing storefront app is a separate, unauthenticated SPA (storefront/src/api/
// client.ts) that resolves which store to display from an `?org=` query param (remembered for the
// browser session). There is deliberately NO default store: without the param it asks which store to
// show. Every admin-side link to the live storefront must carry the current org's own real slug.
// (A draft-preview link carries only the version id; the draft itself says which store it belongs to.)
export const STOREFRONT_ORIGIN: string = import.meta.env?.VITE_STOREFRONT_ORIGIN ?? "http://localhost:5174";

export function liveStorefrontUrl(orgSlug: string | undefined): string {
  return orgSlug ? `${STOREFRONT_ORIGIN}/?org=${encodeURIComponent(orgSlug)}` : STOREFRONT_ORIGIN;
}

/** The draft rendered by the real storefront, framed inside Store Builder. `editor=1` asks the storefront to enable its selection
 * bridge (it still verifies that this app is the one framing it). Home is "/", any other page "/pages/<slug>". */
export function editorPreviewUrl(draftId: string, pageSlug: string): string {
  const path = pageSlug === "home" ? "/" : `/pages/${encodeURIComponent(pageSlug)}`;
  return `${STOREFRONT_ORIGIN}${path}?preview=${encodeURIComponent(draftId)}&editor=1`;
}
