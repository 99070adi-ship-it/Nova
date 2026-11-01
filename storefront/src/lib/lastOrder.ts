import type { Order } from "../api/client";

/** The order just placed, kept for this tab so the confirmation page can show it after navigation or a refresh without
 * asking for the email again. Session-only; the server remains the only source of truth (lookup needs id + email). */
const key = (id: string) => `nova.store.order.${id}`;

export function saveLastOrder(order: Order): void {
  try {
    window.sessionStorage.setItem(key(order.id), JSON.stringify(order));
  } catch {
    // best effort
  }
}

export function loadLastOrder(id: string): Order | null {
  try {
    const raw = window.sessionStorage.getItem(key(id));
    return raw ? (JSON.parse(raw) as Order) : null;
  } catch {
    return null;
  }
}
