import registry from "../../../contracts/editable-elements.json";
import { parseAdminMessage, toParent, type AdminMessage, type PreviewMessage } from "./protocol";

const LABELS: Record<string, string> = Object.fromEntries((registry.elements as Array<{ key: string; label: string }>).map((e) => [e.key, e.label]));

interface Target {
  postMessage(message: unknown, targetOrigin: string): void;
}

/**
 * The selection layer inside the preview. It draws outlines in its own overlay (never touching the storefront's markup or
 * styles) and reports clicks on tagged elements to the verified parent. In "interact" mode it does nothing, so links and
 * buttons work as for a customer.
 */
export class EditorController {
  private mode: "select" | "interact" = "select";
  private selected: { sectionId: string | null; element: string } | null = null;
  private hover: HTMLElement | null = null;
  private hoverBox: HTMLDivElement;
  private selectedBox: HTMLDivElement;
  private selectedLabel: HTMLSpanElement;
  private raf = 0;
  private disposed = false;
  private readonly listeners: Array<[string, EventListener, AddEventListenerOptions | boolean]> = [];
  onRefresh: () => void = () => {};

  constructor(
    private readonly doc: Document,
    private readonly win: Window,
    private readonly parent: Target,
    private readonly parentOrigin: string,
    private readonly versionId: string,
  ) {
    const reduced = win.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const box = (dashed: boolean) => {
      const el = doc.createElement("div");
      el.setAttribute("data-nova-overlay", "");
      el.setAttribute("aria-hidden", "true");
      Object.assign(el.style, {
        position: "fixed", zIndex: "2147483000", pointerEvents: "none", display: "none", boxSizing: "border-box",
        border: dashed ? "1.5px dashed #E8602C" : "2px solid #E8602C", borderRadius: "3px",
        background: dashed ? "rgba(232,96,44,0.05)" : "rgba(232,96,44,0.08)",
        transition: reduced ? "none" : "top 120ms ease, left 120ms ease, width 120ms ease, height 120ms ease",
      });
      doc.body.appendChild(el);
      return el;
    };
    this.hoverBox = box(true);
    this.selectedBox = box(false);
    this.selectedLabel = doc.createElement("span");
    Object.assign(this.selectedLabel.style, {
      position: "absolute", left: "-2px", top: "-22px", background: "#E8602C", color: "#fff", font: "600 11px/1 system-ui, sans-serif",
      padding: "5px 8px", borderRadius: "3px 3px 3px 0", whiteSpace: "nowrap",
    });
    this.selectedBox.appendChild(this.selectedLabel);

    this.on("message", ((e: MessageEvent) => this.onMessage(e)) as EventListener, false);
    this.on("click", ((e: MouseEvent) => this.onClick(e)) as EventListener, true);
    this.on("submit", ((e: Event) => { if (this.mode === "select") e.preventDefault(); }) as EventListener, true);
    this.on("mouseover", ((e: MouseEvent) => this.onHover(e)) as EventListener, true);
    this.on("mouseout", (() => this.setHover(null)) as EventListener, true);
    this.on("scroll", (() => this.paint()) as EventListener, true);
    this.on("resize", (() => this.paint()) as EventListener, false);
    this.send({ type: "ready", versionId });
    const tick = () => {
      if (this.disposed) return;
      this.paint();
      this.raf = this.win.requestAnimationFrame(tick);
    };
    this.raf = this.win.requestAnimationFrame(tick); // follows layout changes (images loading, refreshes, viewport changes)
  }

  private on(type: string, fn: EventListener, options: AddEventListenerOptions | boolean) {
    const target = type === "message" || type === "resize" ? this.win : this.doc;
    target.addEventListener(type, fn, options);
    this.listeners.push([type, fn, options]);
  }

  private send(message: PreviewMessage) {
    this.parent.postMessage(toParent(message), this.parentOrigin);
  }

  private onMessage(event: MessageEvent) {
    // Only the verified parent window, from the verified origin, with a well-formed message.
    if (event.origin !== this.parentOrigin || event.source !== (this.win.parent as unknown)) return;
    const message = parseAdminMessage(event.data);
    if (message) this.handle(message);
  }

  handle(message: AdminMessage) {
    switch (message.type) {
      case "mode":
        this.mode = message.mode;
        if (message.mode === "interact") this.setHover(null);
        break;
      case "select":
        this.selected = { sectionId: message.sectionId, element: message.element };
        this.reveal();
        break;
      case "clear":
        this.selected = null;
        break;
      case "refresh":
        this.onRefresh();
        break;
    }
    this.paint();
  }

  private find(sel: { sectionId: string | null; element: string }): HTMLElement | null {
    if (sel.sectionId === null) return this.doc.querySelector<HTMLElement>(`[data-nova-el="${CSS.escape(sel.element)}"]`);
    const section = Array.from(this.doc.querySelectorAll<HTMLElement>("[data-nova-section]")).find((s) => s.getAttribute("data-nova-section") === sel.sectionId);
    if (!section) return null;
    if (section.getAttribute("data-nova-el") === sel.element) return section;
    return Array.from(section.querySelectorAll<HTMLElement>("[data-nova-el]")).find((e) => e.getAttribute("data-nova-el") === sel.element) ?? null;
  }

  private reveal() {
    const el = this.selected && this.find(this.selected);
    if (!el) return;
    const reduced = this.win.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView?.({ behavior: reduced ? "auto" : "smooth", block: "center" });
  }

  private tagged(target: EventTarget | null): HTMLElement | null {
    return target instanceof Element ? target.closest<HTMLElement>("[data-nova-el]") : null;
  }

  private onClick(event: MouseEvent) {
    if (this.mode !== "select") return;
    event.preventDefault(); // nothing in the preview navigates or submits while selecting
    event.stopPropagation();
    const el = this.tagged(event.target);
    if (!el) {
      this.send({ type: "unsupported", versionId: this.versionId });
      return;
    }
    const element = el.getAttribute("data-nova-el")!;
    const section = el.closest<HTMLElement>("[data-nova-section]");
    const sectionId = element.startsWith("theme.") ? null : (section?.getAttribute("data-nova-section") ?? null);
    this.selected = { sectionId, element };
    this.paint();
    this.send({ type: "select", versionId: this.versionId, sectionId, element });
  }

  private onHover(event: MouseEvent) {
    if (this.mode !== "select") return;
    this.setHover(this.tagged(event.target));
  }

  private setHover(el: HTMLElement | null) {
    this.hover = el;
    this.paint();
  }

  private place(box: HTMLDivElement, el: HTMLElement | null) {
    if (!el || !el.isConnected) {
      box.style.display = "none";
      return;
    }
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { display: "block", top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px` });
  }

  paint() {
    const sel = this.selected ? this.find(this.selected) : null;
    this.place(this.selectedBox, sel);
    this.selectedLabel.textContent = this.selected ? (LABELS[this.selected.element] ?? this.selected.element) : "";
    this.place(this.hoverBox, this.hover && this.hover !== sel && this.mode === "select" ? this.hover : null);
  }

  /** Test/inspection hook: the current selection. */
  get current() {
    return this.selected;
  }

  dispose() {
    this.disposed = true;
    this.win.cancelAnimationFrame(this.raf);
    for (const [type, fn, options] of this.listeners) (type === "message" || type === "resize" ? this.win : this.doc).removeEventListener(type, fn, options);
    this.hoverBox.remove();
    this.selectedBox.remove();
  }
}
