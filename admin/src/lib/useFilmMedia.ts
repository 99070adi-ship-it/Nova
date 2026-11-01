import { useEffect, useState } from "react";

// A media query that stays correct if the visitor changes the setting while the page is open.
// jsdom (and very old browsers) have no matchMedia: treat that as "doesn't match".
function useMediaQuery(query: string): boolean {
  const read = () => typeof window !== "undefined" && !!window.matchMedia?.(query).matches;
  const [matches, setMatches] = useState(read);
  useEffect(() => {
    const mql = window.matchMedia?.(query);
    if (!mql) return;
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener?.("change", onChange);
    return () => mql.removeEventListener?.("change", onChange);
  }, [query]);
  return matches;
}

/** Visitors who asked the OS for less motion: show the poster, never autoplay. */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}

/** Phone-sized screens and Data Saver: a decorative background video isn't worth the ~9 MB. */
export function useSmallOrSavingData(): boolean {
  const small = useMediaQuery("(max-width: 640px)");
  const saveData = typeof navigator !== "undefined" && !!(navigator as { connection?: { saveData?: boolean } }).connection?.saveData;
  return small || saveData;
}
