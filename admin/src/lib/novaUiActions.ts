/**
 * NOVA's UI Action Protocol — a small, deterministic, allowlisted set of actions the Guide uses
 * to demonstrate the real application instead of just describing it in text.
 *
 * This is explicitly NOT model-controlled: the model (nova_guide) only ever produces narration
 * text. The sequence of actions for each step is authored in application code (see
 * lib/novaLessons.ts) — the model never generates a target string or picks what to click. Targets
 * are a fixed, known vocabulary (`data-nova-target="key"` attributes placed on real existing
 * elements), never an arbitrary CSS selector, so there is nothing here an LLM could manipulate
 * even if it tried.
 */

export type UIActionType = "spotlight" | "fill_field" | "clear_field" | "click" | "wait";

export interface UIAction {
  type: UIActionType;
  /** A data-nova-target key — the only way an action addresses the real UI. */
  target?: string;
  value?: string;
  ms?: number;
}

export function getTarget(key: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-nova-target="${key}"]`);
}

/** Sets a React-controlled input/textarea/select's value via the native setter and dispatches a
 * real "input" event, so React's own onChange handler fires exactly as it would for a real
 * keystroke — the lesson drives the actual form, not a lookalike copy of it. */
export function setControlledValue(el: HTMLElement, value: string): void {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const proto = el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  } else if (el instanceof HTMLSelectElement) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls for a target to exist in the real DOM, up to `timeoutMs` — used before starting a
 * lesson that may have just navigated to a different page (components/NovaGuideWidget.tsx), so
 * the demo's first action never silently no-ops against a page still rendering. Resolves either
 * way; a lesson's own actions already no-op gracefully if the target still isn't there. */
export async function waitForTarget(key: string, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!getTarget(key) && Date.now() - start < timeoutMs) {
    await wait(100);
  }
}

export interface RunActionContext {
  onSpotlight: (rect: DOMRect | null) => void;
}

/** Executes one allowlisted action against the real DOM. Returns quietly (no-op) if a target
 * doesn't currently exist — a lesson must never throw and break the page it's demonstrating. */
export async function runUIAction(action: UIAction, ctx: RunActionContext): Promise<void> {
  switch (action.type) {
    case "spotlight": {
      const el = action.target ? getTarget(action.target) : null;
      if (!el) {
        ctx.onSpotlight(null);
        return;
      }
      // Only scroll (and wait for the scroll) when the control is actually off-screen. A control
      // that is already visible is spotlighted at once; the ring animates to it on its own.
      const r = el.getBoundingClientRect();
      const visible = r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth;
      if (!visible) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        await wait(SCROLL_SETTLE_MS);
      }
      ctx.onSpotlight(el.getBoundingClientRect());
      return;
    }
    case "fill_field": {
      const el = action.target ? getTarget(action.target) : null;
      if (el) setControlledValue(el, action.value ?? "");
      return;
    }
    case "clear_field": {
      const el = action.target ? getTarget(action.target) : null;
      if (el) setControlledValue(el, "");
      return;
    }
    case "click": {
      const el = action.target ? getTarget(action.target) : null;
      el?.click();
      return;
    }
    case "wait":
      await wait(action.ms ?? 400);
      return;
  }
}

/** Time for a smooth scroll to land before measuring a control that was off-screen. */
const SCROLL_SETTLE_MS = 280;
/** A short beat between demo actions so each fill or highlight is seen, without dragging the demo out. */
export const DEFAULT_ACTION_PACE_MS = 150;

export async function runUIActions(actions: UIAction[], ctx: RunActionContext, pace = DEFAULT_ACTION_PACE_MS): Promise<void> {
  for (let i = 0; i < actions.length; i++) {
    await runUIAction(actions[i], ctx);
    if (i < actions.length - 1) await wait(pace); // never a trailing pause after the last action
  }
}
