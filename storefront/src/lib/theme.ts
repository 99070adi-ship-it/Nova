import type { CSSProperties } from "react";

/**
 * Published theme tokens (Store Builder's StoreTheme: primary_color, background_color, font_family, border_radius) become
 * CSS variables for the whole storefront, with safe fallbacks. Values are validated before use, so a bad token can never
 * inject CSS or break the page; an invalid one falls back to the default.
 */
export interface ThemeTokens {
  primary_color?: string;
  background_color?: string;
  font_family?: string;
  border_radius?: string;
  button_style?: string;
  [key: string]: string | undefined;
}

export const DEFAULT_THEME = { primary: "#171717", background: "#fafafa", font: "system-ui, sans-serif", radius: "8px", buttonStyle: "filled" };

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const RADIUS = /^(?:0|\d{1,2}(?:\.\d+)?(?:px|rem|em))$/;
// A font stack: names (optionally quoted), commas, spaces, hyphens. No semicolons, braces, urls or parentheses.
const FONT = /^[A-Za-z0-9 ,'"-]{1,200}$/;

export function resolveTheme(tokens: ThemeTokens | undefined) {
  const t = tokens ?? {};
  return {
    primary: t.primary_color && HEX.test(t.primary_color) ? t.primary_color : DEFAULT_THEME.primary,
    background: t.background_color && HEX.test(t.background_color) ? t.background_color : DEFAULT_THEME.background,
    font: t.font_family && FONT.test(t.font_family) ? t.font_family : DEFAULT_THEME.font,
    radius: t.border_radius && RADIUS.test(t.border_radius) ? t.border_radius : DEFAULT_THEME.radius,
    buttonStyle: t.button_style === "outline" ? "outline" : DEFAULT_THEME.buttonStyle,
  };
}

export function themeStyle(tokens: ThemeTokens | undefined): CSSProperties {
  const r = resolveTheme(tokens);
  return {
    "--sf-primary": r.primary,
    "--sf-bg": r.background,
    // Unchanging copies: an inverted section swaps --sf-primary and --sf-bg between these.
    "--sf-primary-base": r.primary,
    "--sf-bg-base": r.background,
    "--sf-font": r.font,
    "--sf-radius": r.radius,
  } as CSSProperties;
}

const WEB_FONTS: Record<string, string> = {
  "cormorant garamond": "Cormorant+Garamond:wght@400;500;600",
  inter: "Inter:wght@400;500;600",
  "playfair display": "Playfair+Display:wght@400;500;600",
  "dm sans": "DM+Sans:wght@400;500;600",
};

/** The Google Fonts stylesheet (open-licence families only) for the first family in the stack, if we know it. */
export function webFontHref(fontStack: string): string | null {
  const first = fontStack.split(",")[0]?.replace(/['"]/g, "").trim().toLowerCase();
  const spec = first ? WEB_FONTS[first] : undefined;
  return spec ? `https://fonts.googleapis.com/css2?family=${spec}&display=swap` : null;
}
