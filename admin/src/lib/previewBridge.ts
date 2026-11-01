/**
 * Store Builder's side of the preview protocol (the storefront's side is storefront/src/editor/protocol.ts).
 *
 *  preview -> admin:  ready | select {sectionId, element} | unsupported | location {path}
 *  admin  -> preview: mode {select|interact} | select {sectionId, element} | clear | refresh
 *
 * Only identifiers and small enums cross the boundary. Incoming messages are accepted only from the storefront's origin AND from
 * the preview iframe's own window, and only if they match these shapes and refer to the draft being edited.
 */
export const PROTOCOL_VERSION = 1;

const ELEMENT_KEY = /^[a-z_]{2,30}\.[a-z_]{2,30}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PreviewEvent =
  | { type: "ready"; versionId: string }
  | { type: "select"; versionId: string; sectionId: string | null; element: string }
  | { type: "unsupported"; versionId: string }
  | { type: "location"; versionId: string; path: string };

export type AdminCommand =
  | { type: "mode"; mode: "select" | "interact" }
  | { type: "select"; sectionId: string | null; element: string }
  | { type: "clear" }
  | { type: "refresh" };

export function parsePreviewEvent(data: unknown): PreviewEvent | null {
  if (!data || typeof data !== "object") return null;
  const m = data as Record<string, unknown>;
  if (m.source !== "nova-preview" || m.v !== PROTOCOL_VERSION) return null;
  if (typeof m.versionId !== "string" || !UUID.test(m.versionId)) return null;
  switch (m.type) {
    case "ready":
      return { type: "ready", versionId: m.versionId };
    case "unsupported":
      return { type: "unsupported", versionId: m.versionId };
    case "select":
      if (typeof m.element !== "string" || !ELEMENT_KEY.test(m.element)) return null;
      if (m.sectionId !== null && (typeof m.sectionId !== "string" || !UUID.test(m.sectionId))) return null;
      return { type: "select", versionId: m.versionId, sectionId: m.sectionId as string | null, element: m.element };
    case "location":
      return typeof m.path === "string" && m.path.startsWith("/") && m.path.length < 200 ? { type: "location", versionId: m.versionId, path: m.path } : null;
    default:
      return null;
  }
}

/** Accept a message only if it came from the preview iframe's window at the storefront's origin. */
export function acceptPreviewMessage(
  event: Pick<MessageEvent, "origin" | "source" | "data">,
  frameWindow: Window | null | undefined,
  storefrontOrigin: string,
  draftId: string,
): PreviewEvent | null {
  if (!frameWindow || event.source !== frameWindow || event.origin !== storefrontOrigin) return null;
  const parsed = parsePreviewEvent(event.data);
  return parsed && parsed.versionId === draftId ? parsed : null;
}

export function sendToPreview(frameWindow: Window | null | undefined, storefrontOrigin: string, command: AdminCommand): void {
  frameWindow?.postMessage({ source: "nova-admin", v: PROTOCOL_VERSION, ...command }, storefrontOrigin);
}
