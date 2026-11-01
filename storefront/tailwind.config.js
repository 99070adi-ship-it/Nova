/** @type {import('tailwindcss').Config} */
// Colors and type come from the published theme tokens (lib/theme.ts sets --sf-* on the storefront root), so a store's
// own palette and font drive every page. Derived tones are mixed from those two colors, never hardcoded.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "var(--sf-bg)",
        ink: "var(--sf-primary)",
        muted: "color-mix(in srgb, var(--sf-primary) 62%, var(--sf-bg))",
        faint: "color-mix(in srgb, var(--sf-primary) 40%, var(--sf-bg))",
        line: "color-mix(in srgb, var(--sf-primary) 14%, var(--sf-bg))",
        surface: "color-mix(in srgb, var(--sf-primary) 6%, var(--sf-bg))",
        "ink-on": "var(--sf-bg)",
      },
      fontFamily: { body: "var(--sf-font)" },
      borderRadius: { theme: "var(--sf-radius)" },
      letterSpacing: { label: "0.14em" },
    },
  },
  plugins: [],
};
