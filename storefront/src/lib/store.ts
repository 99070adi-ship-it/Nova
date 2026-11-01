/**
 * Which store is being shown. There is NO default store: a customer-facing site that silently falls back to one
 * particular organization would expose it for any visitor with a bad link. The slug comes from `?org=` (the admin
 * always links with it), is remembered for the browser session so a refresh or a copied internal URL keeps working,
 * and may be fixed at build time with VITE_ORG_SLUG for a single-store deployment.
 */
const KEY = "nova.store.org";

function safeStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function rememberOrgSlug(slug: string): void {
  safeStorage()?.setItem(KEY, slug);
}

export function resolveOrgSlug(search: string = window.location.search): string | null {
  const fromUrl = new URLSearchParams(search).get("org");
  if (fromUrl && /^[a-z0-9][a-z0-9-]{0,80}$/i.test(fromUrl)) {
    safeStorage()?.setItem(KEY, fromUrl);
    return fromUrl;
  }
  const remembered = safeStorage()?.getItem(KEY);
  if (remembered) return remembered;
  const built = import.meta.env?.VITE_ORG_SLUG as string | undefined;
  return built || null;
}

/** The unpublished draft being previewed, if any (a StorefrontVersion id from Store Builder). */
export function previewVersionId(search: string = window.location.search): string | null {
  const v = new URLSearchParams(search).get("preview");
  return v && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
}

/** True when Store Builder embeds this page as its visual-editing preview (the embedding parent is still verified: editor/bridge.ts). */
export function editorRequested(search: string = window.location.search): boolean {
  return new URLSearchParams(search).get("editor") === "1";
}

/** Internal link that keeps the store (and a draft preview) selected as the shopper navigates. */
export function storePath(to: string, org: string | null, preview: string | null, editor = false): string {
  const [path, existing = ""] = to.split("?");
  const params = new URLSearchParams(existing);
  if (org) params.set("org", org);
  if (preview) params.set("preview", preview);
  if (editor && preview) params.set("editor", "1");
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}
