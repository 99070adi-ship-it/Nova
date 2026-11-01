import { useSyncExternalStore } from "react";

/**
 * The cart holds ONLY variant ids and quantities, per store, in this browser. Prices, titles, stock and totals are never
 * stored here: the cart page asks the server (POST /cart/validate) for the authoritative version every time, so a stale
 * or tampered localStorage can change what is in the cart but never what anything costs.
 */
export interface CartItem {
  variantId: string;
  quantity: number;
}

const MAX_LINES = 30;
export const DEFAULT_MAX_QUANTITY = 10;

const listeners = new Set<() => void>();
let cache: { key: string; raw: string | null; items: CartItem[] } | null = null;
let currentKey = "nova.store.cart.v1:none";

export function setCartStore(org: string | null) {
  currentKey = `nova.store.cart.v1:${org ?? "none"}`;
  cache = null;
  emit();
}

function emit() {
  for (const l of [...listeners]) l();
}

function sanitize(value: unknown): CartItem[] {
  if (!Array.isArray(value)) return [];
  const merged = new Map<string, number>();
  for (const raw of value) {
    const id = typeof raw?.variantId === "string" ? raw.variantId : null;
    const qty = Number(raw?.quantity);
    if (!id || !Number.isInteger(qty) || qty < 1) continue;
    merged.set(id, Math.min(1000, (merged.get(id) ?? 0) + qty));
  }
  return [...merged].slice(0, MAX_LINES).map(([variantId, quantity]) => ({ variantId, quantity }));
}

export function readCart(): CartItem[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(currentKey);
  } catch {
    // storage blocked: the cart then lives only for this page session (see `memory`)
    return memory.get(currentKey) ?? [];
  }
  if (cache && cache.key === currentKey && cache.raw === raw) return cache.items;
  let items: CartItem[] = [];
  try {
    items = raw ? sanitize(JSON.parse(raw)) : [];
  } catch {
    items = [];
  }
  cache = { key: currentKey, raw, items };
  return items;
}

const memory = new Map<string, CartItem[]>();

function write(items: CartItem[]) {
  const clean = sanitize(items);
  try {
    window.localStorage.setItem(currentKey, JSON.stringify(clean));
  } catch {
    memory.set(currentKey, clean);
  }
  cache = null;
  emit();
}

export const cart = {
  /** Add `quantity` of a variant, never above `max` (the store's per-line limit or the stock the shopper was shown). */
  add(variantId: string, quantity: number, max = DEFAULT_MAX_QUANTITY): { added: number; capped: boolean } {
    const items = readCart();
    const existing = items.find((i) => i.variantId === variantId)?.quantity ?? 0;
    const wanted = Math.max(0, Math.floor(quantity));
    const next = Math.min(existing + wanted, Math.max(1, max));
    const added = next - existing;
    if (added <= 0) return { added: 0, capped: true };
    const exists = items.some((i) => i.variantId === variantId);
    write(exists ? items.map((i) => (i.variantId === variantId ? { ...i, quantity: next } : i)) : [...items, { variantId, quantity: next }]);
    return { added, capped: existing + wanted > next };
  },
  setQuantity(variantId: string, quantity: number, max = DEFAULT_MAX_QUANTITY) {
    const q = Math.floor(quantity);
    if (!Number.isFinite(q) || q < 1) return this.remove(variantId);
    write(readCart().map((i) => (i.variantId === variantId ? { ...i, quantity: Math.min(q, Math.max(1, max)) } : i)));
  },
  remove(variantId: string) {
    write(readCart().filter((i) => i.variantId !== variantId));
  },
  clear() {
    write([]);
  },
};

export function cartCount(items: CartItem[]): number {
  return items.reduce((n, i) => n + i.quantity, 0);
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key === currentKey) {
      cache = null;
      fn();
    }
  };
  window.addEventListener("storage", onStorage); // another tab changed the cart
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

export function useCart(): CartItem[] {
  return useSyncExternalStore(subscribe, readCart, readCart);
}
