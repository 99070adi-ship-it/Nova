import { useSyncExternalStore } from "react";

/**
 * Saved items. There are no customer accounts, so this is a list kept in THIS browser only (per store). The page says so
 * plainly; nothing is sent to the server and it is not available on another device.
 */
const listeners = new Set<() => void>();
let currentKey = "nova.store.wishlist.v1:none";
let snapshot: { raw: string | null; slugs: string[] } | null = null;
const memory = new Map<string, string[]>();

export function setWishlistStore(org: string | null) {
  currentKey = `nova.store.wishlist.v1:${org ?? "none"}`;
  snapshot = null;
  for (const l of [...listeners]) l();
}

export function readWishlist(): string[] {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(currentKey);
  } catch {
    return memory.get(currentKey) ?? [];
  }
  if (snapshot && snapshot.raw === raw) return snapshot.slugs;
  let slugs: string[] = [];
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    slugs = Array.isArray(parsed) ? [...new Set(parsed.filter((s): s is string => typeof s === "string" && s.length < 300))].slice(0, 200) : [];
  } catch {
    slugs = [];
  }
  snapshot = { raw, slugs };
  return slugs;
}

function write(slugs: string[]) {
  try {
    window.localStorage.setItem(currentKey, JSON.stringify(slugs));
  } catch {
    memory.set(currentKey, slugs);
  }
  snapshot = null;
  for (const l of [...listeners]) l();
}

export const wishlist = {
  toggle(slug: string): boolean {
    const current = readWishlist();
    const has = current.includes(slug);
    write(has ? current.filter((s) => s !== slug) : [...current, slug]);
    return !has;
  },
  remove(slug: string) {
    write(readWishlist().filter((s) => s !== slug));
  },
};

export function useWishlist(): string[] {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    readWishlist,
    readWishlist,
  );
}
