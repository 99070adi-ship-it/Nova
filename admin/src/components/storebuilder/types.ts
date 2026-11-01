import type { EditableElement, EditableRegistry, StorefrontVersion, StoreSection } from "../../api/client";

export interface Selection {
  sectionId: string | null; // null for the theme
  element: string;
}

export type Device = "desktop" | "tablet" | "mobile";
export const DEVICES: Record<Device, { label: string; width: number; height: number }> = {
  desktop: { label: "Desktop", width: 1280, height: 800 },
  tablet: { label: "Tablet", width: 820, height: 1024 },
  mobile: { label: "Mobile", width: 390, height: 844 },
};

export const elementOf = (registry: EditableRegistry | undefined, key: string): EditableElement | undefined => registry?.elements.find((e) => e.key === key);

export function findSection(draft: StorefrontVersion, sectionId: string | null): { section: StoreSection; pageSlug: string } | null {
  if (!sectionId) return null;
  for (const page of draft.pages) {
    const section = page.sections.find((s) => s.id === sectionId);
    if (section) return { section, pageSlug: page.slug };
  }
  return null;
}

/** The current value of one property of the selected element, from the draft itself (never from the page). */
export function currentValue(draft: StorefrontVersion, selection: Selection, path: string, registry?: EditableRegistry): unknown {
  if (selection.sectionId === null) {
    const raw = draft.theme[path];
    if (path === "font_family" && registry) return Object.entries(registry.fonts).find(([, stack]) => stack === raw)?.[0] ?? raw;
    return raw;
  }
  return findSection(draft, selection.sectionId)?.section.configuration[path];
}

/** Whether an element currently exists on the page: optional text/button/image elements without content aren't rendered, so they
 * aren't offered in the outline. */
export function elementPresent(el: EditableElement, config: Record<string, unknown>): boolean {
  const primary = el.properties[0];
  if (el.key.endsWith(".section") || !primary?.optional) return true;
  const v = config[primary.path];
  return typeof v === "string" ? v.trim() !== "" : v != null;
}

export function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "None";
  if (typeof value === "string") return value.length > 140 ? `${value.slice(0, 137)}…` : value;
  return String(value);
}
