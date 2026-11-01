/**
 * The message protocol between Store Builder (admin app) and this storefront preview, kept tiny on purpose.
 *
 *  preview -> admin:  ready | select {sectionId, element} | unsupported | location {path}
 *  admin  -> preview: mode {select|interact} | select {sectionId, element} | clear | refresh
 *
 * Nothing but identifiers and small enums crosses the boundary: never HTML, never DOM contents, never code. Every
 * incoming message is validated against the strict shapes below and anything else is ignored.
 */
export const PROTOCOL_VERSION = 1;

const ELEMENT_KEY = /^[a-z_]{2,30}\.[a-z_]{2,30}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AdminMessage =
  | { type: "mode"; mode: "select" | "interact" }
  | { type: "select"; sectionId: string | null; element: string }
  | { type: "clear" }
  | { type: "refresh" };

export type PreviewMessage =
  | { type: "ready"; versionId: string }
  | { type: "select"; versionId: string; sectionId: string | null; element: string }
  | { type: "unsupported"; versionId: string }
  | { type: "location"; versionId: string; path: string };

/** Returns a validated admin message, or null for anything that is not exactly one. */
export function parseAdminMessage(data: unknown): AdminMessage | null {
  if (!data || typeof data !== "object") return null;
  const m = data as Record<string, unknown>;
  if (m.source !== "nova-admin" || m.v !== PROTOCOL_VERSION) return null;
  switch (m.type) {
    case "mode":
      return m.mode === "select" || m.mode === "interact" ? { type: "mode", mode: m.mode } : null;
    case "select":
      if (typeof m.element !== "string" || !ELEMENT_KEY.test(m.element)) return null;
      if (m.sectionId !== null && (typeof m.sectionId !== "string" || !UUID.test(m.sectionId))) return null;
      return { type: "select", sectionId: m.sectionId as string | null, element: m.element };
    case "clear":
      return { type: "clear" };
    case "refresh":
      return { type: "refresh" };
    default:
      return null;
  }
}

export const toParent = (message: PreviewMessage) => ({ source: "nova-preview", v: PROTOCOL_VERSION, ...message });

/**
 * The embedding page's origin, but only if it is one of the allowed admin origins. A page that is not framed, or is framed by
 * anyone else, gets null and therefore no editing behaviour and no messages at all.
 */
export function verifiedParentOrigin(win: Window = window, allowedRaw: string | undefined = import.meta.env?.VITE_ADMIN_ORIGINS): string | null {
  const allowed = (allowedRaw ?? "http://localhost:5173,http://127.0.0.1:5173").split(",").map((s) => s.trim()).filter(Boolean);
  if (win.parent === win) return null; // not embedded
  let origin: string | null = (win.location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins?.[0] ?? null;
  if (!origin && win.document.referrer) {
    try {
      origin = new URL(win.document.referrer).origin;
    } catch {
      origin = null;
    }
  }
  return origin && allowed.includes(origin) ? origin : null;
}

/** True only for the draft preview that Store Builder itself frames (the editor was requested AND the parent is verified). */
export function insideBuilder(editor: boolean, preview: string | null): boolean {
  return !!(editor && preview && verifiedParentOrigin());
}
