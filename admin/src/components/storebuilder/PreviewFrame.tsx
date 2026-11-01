import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { STOREFRONT_ORIGIN, editorPreviewUrl } from "../../lib/storefrontUrl";
import { acceptPreviewMessage, sendToPreview, type PreviewEvent } from "../../lib/previewBridge";
import { DEVICES, type Device, type Selection } from "./types";

/**
 * The customer-facing storefront (the one real renderer) showing THIS draft, in a device emulator. It is the storefront app
 * itself in an iframe: there is no second renderer. Selection happens inside it (see storefront/src/editor) and is reported here
 * through the origin-checked protocol in lib/previewBridge.ts.
 */
export default function PreviewFrame({
  draftId, pageSlug, device, mode, selected, refreshKey, onSelect, onUnsupported,
}: {
  draftId: string;
  pageSlug: string;
  device: Device;
  mode: "select" | "interact";
  selected: Selection | null;
  /** Bumped after the draft changes; the preview re-fetches it in place (selection is kept). */
  refreshKey: number;
  onSelect: (s: Selection) => void;
  onUnsupported: () => void;
}) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [scale, setScale] = useState(1);
  const dims = DEVICES[device];
  const src = useMemo(() => editorPreviewUrl(draftId, pageSlug), [draftId, pageSlug]);

  const send = useCallback((command: Parameters<typeof sendToPreview>[2]) => sendToPreview(frameRef.current?.contentWindow, STOREFRONT_ORIGIN, command), []);

  // A new page or draft means a new load.
  useEffect(() => {
    setReady(false);
    setFailed(false);
  }, [src, attempt]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message: PreviewEvent | null = acceptPreviewMessage(event, frameRef.current?.contentWindow, STOREFRONT_ORIGIN, draftId);
      if (!message) return;
      if (message.type === "ready") setReady(true);
      else if (message.type === "select") onSelect({ sectionId: message.sectionId, element: message.element });
      else if (message.type === "unsupported") onUnsupported();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [draftId, onSelect, onUnsupported]);

  // Whatever the preview needs to know is re-sent whenever it (re)starts or the state changes.
  useEffect(() => {
    if (!ready) return;
    send({ type: "mode", mode });
  }, [ready, mode, send]);
  useEffect(() => {
    if (!ready) return;
    send(selected ? { type: "select", sectionId: selected.sectionId, element: selected.element } : { type: "clear" });
  }, [ready, selected, send]);
  const firstRefresh = useRef(true);
  useEffect(() => {
    if (firstRefresh.current) {
      firstRefresh.current = false;
      return;
    }
    if (ready) send({ type: "refresh" });
  }, [refreshKey, ready, send]);

  // If the storefront never says hello, say so instead of showing an empty frame.
  useEffect(() => {
    if (ready) return;
    const t = setTimeout(() => setFailed(true), 15000);
    return () => clearTimeout(t);
  }, [ready, src, attempt]);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const measure = () => setScale(Math.min(1, (el.clientWidth || dims.width) / dims.width));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [dims.width]);

  const isDesktop = device === "desktop";
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="preview-emulator" data-device={device}>
      <div className="flex items-center justify-center gap-2 text-xs text-fg-3">
        <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-corona px-2.5 font-mono text-[10px] font-semibold uppercase tracking-label text-corona-on">Draft preview</span>
        <span>Not published. Customers don't see this.</span>
      </div>
      <div ref={hostRef} className="w-full">
        <div
          className={clsx(
            "relative mx-auto overflow-hidden border border-line-strong bg-raised shadow-float",
            isDesktop ? "rounded-lg" : "rounded-[28px] border-[6px] border-fg",
          )}
          style={{ width: dims.width * scale, height: dims.height * scale + (isDesktop ? 34 * scale : 0) }}
        >
          {isDesktop && (
            <div className="flex items-center gap-2 border-b border-line bg-sunken px-3" style={{ height: 34 * scale }} aria-hidden="true">
              <span className="h-2 w-2 rounded-full bg-line-strong" /><span className="h-2 w-2 rounded-full bg-line-strong" /><span className="h-2 w-2 rounded-full bg-line-strong" />
              <span className="ml-3 flex-1 truncate rounded-full bg-raised px-3 py-0.5 text-center font-mono text-[10px] text-fg-3">draft preview · not published</span>
            </div>
          )}
          <iframe
            key={attempt}
            ref={frameRef}
            title={`Storefront draft preview, ${dims.label.toLowerCase()}`}
            src={src}
            // The preview is the customer-facing storefront: scripts and its own storage are needed, nothing else is granted.
            sandbox="allow-scripts allow-same-origin allow-forms"
            referrerPolicy="origin"
            className="block border-0 bg-white"
            style={{ width: dims.width, height: dims.height, transform: `scale(${scale})`, transformOrigin: "top left" }}
            data-testid="preview-frame"
          />
          {!ready && (
            <div role="status" className="absolute inset-0 z-20 flex items-center justify-center bg-raised/90 p-6 text-center text-sm text-fg-2">
              {failed ? (
                <div>
                  <p className="font-medium text-fg">The preview couldn't load.</p>
                  <p className="mt-1 text-xs text-fg-3">Make sure the storefront app is running at {STOREFRONT_ORIGIN}.</p>
                  <button className="mt-3 rounded-md border border-line-strong px-3 py-1.5 text-xs font-medium hover:bg-sunken" onClick={() => { setFailed(false); setAttempt((a) => a + 1); }}>Try again</button>
                </div>
              ) : "Loading your draft…"}
            </div>
          )}
        </div>
      </div>
      <p className="text-center font-mono text-[11px] text-fg-3" data-testid="device-size">
        {dims.label} · {dims.width} × {dims.height}px{scale < 1 ? ` · shown at ${Math.round(scale * 100)}%` : ""}
      </p>
    </div>
  );
}
