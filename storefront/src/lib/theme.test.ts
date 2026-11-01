import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, resolveTheme, themeStyle, webFontHref } from "./theme";
import { resolveOrgSlug, storePath, previewVersionId } from "./store";

describe("published theme tokens", () => {
  it("applies valid colors, font and radius", () => {
    expect(resolveTheme({ primary_color: "#2A1D15", background_color: "#F3EEE6", font_family: "'Cormorant Garamond', Georgia, serif", border_radius: "2px" })).toEqual({
      primary: "#2A1D15", background: "#F3EEE6", font: "'Cormorant Garamond', Georgia, serif", radius: "2px", buttonStyle: "filled",
    });
    expect(resolveTheme({ button_style: "outline" }).buttonStyle).toBe("outline");
    expect(resolveTheme({ button_style: "glow; x" }).buttonStyle).toBe("filled");
    expect((themeStyle({ primary_color: "#111" }) as Record<string, string>)["--sf-primary"]).toBe("#111");
  });

  it("falls back for anything missing or malformed, so a bad token can't inject CSS", () => {
    const r = resolveTheme({ primary_color: "red; background:url(x)", background_color: "javascript:1", font_family: "x}body{display:none", border_radius: "9999px;" });
    expect(r).toEqual({ primary: DEFAULT_THEME.primary, background: DEFAULT_THEME.background, font: DEFAULT_THEME.font, radius: DEFAULT_THEME.radius, buttonStyle: "filled" });
    expect(resolveTheme(undefined).primary).toBe(DEFAULT_THEME.primary);
  });

  it("loads only known open-licence web fonts", () => {
    expect(webFontHref("'Cormorant Garamond', Georgia, serif")).toContain("Cormorant+Garamond");
    expect(webFontHref("system-ui, sans-serif")).toBeNull();
    expect(webFontHref("'Evil Font', serif")).toBeNull();
  });
});

describe("which store is shown (no default store)", () => {
  it("takes the slug from ?org=, remembers it for the session, and never invents one", () => {
    expect(resolveOrgSlug("")).toBeNull();
    expect(resolveOrgSlug("?org=acme-1")).toBe("acme-1");
    expect(resolveOrgSlug("")).toBe("acme-1"); // a refresh or an internal link without the param keeps working
  });

  it("rejects a malformed slug", () => {
    expect(resolveOrgSlug("?org=../../admin")).toBeNull();
    expect(resolveOrgSlug("?org=a b")).toBeNull();
  });

  it("builds internal links that keep the store and any draft preview", () => {
    expect(storePath("/products", "acme", null)).toBe("/products?org=acme");
    expect(storePath("/products?sort=name", "acme", "00000000-0000-4000-8000-000000000000")).toBe("/products?sort=name&org=acme&preview=00000000-0000-4000-8000-000000000000");
    expect(previewVersionId("?preview=not-a-uuid")).toBeNull();
  });
});
