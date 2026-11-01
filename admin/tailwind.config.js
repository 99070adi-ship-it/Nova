/** @type {import('tailwindcss').Config} */

// NOVA design tokens. The values live as CSS variables in src/index.css (light "paper" by default,
// dark "ink" inside a `.theme-ink` scope) so one class like `bg-raised` or `text-fg-2` is correct in
// both. Tailwind only maps names to those variables — there is no second design system.
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Surfaces and text
        canvas: token("canvas"),
        raised: token("raised"),
        sunken: token("sunken"),
        fg: { DEFAULT: token("fg"), 2: token("fg-2"), 3: token("fg-3") },
        line: { DEFAULT: token("line"), strong: token("line-strong") },
        inverse: { DEFAULT: token("inverse"), on: token("on-inverse") },
        // Corona: NOVA's presence, active AI state, and the one thing that needs attention.
        corona: { DEFAULT: token("corona"), soft: token("corona-soft"), ink: token("corona-ink"), on: token("on-corona") },
        // Status
        ok: { DEFAULT: token("ok"), soft: token("ok-soft") },
        warn: { DEFAULT: token("warn"), soft: token("warn-soft") },
        bad: { DEFAULT: token("bad"), soft: token("bad-soft") },
        info: { DEFAULT: token("info"), soft: token("info-soft") },
      },
      fontFamily: {
        sans: ["Geist", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ['"Geist Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
        display: ['"Instrument Serif"', "Georgia", "Times New Roman", "serif"],
      },
      // Radii: 6 chips · 10 buttons/inputs · 14 cards · 20 panels · 28 launcher morph.
      borderRadius: { DEFAULT: "6px", md: "10px", lg: "14px", xl: "20px", "2xl": "28px" },
      boxShadow: {
        "elev-1": "0 1px 2px rgb(14 15 18 / 0.06)",
        "elev-2": "0 4px 16px rgb(14 15 18 / 0.08), 0 1px 2px rgb(14 15 18 / 0.05)",
        float: "0 24px 60px rgb(14 15 18 / 0.2), 0 8px 20px rgb(14 15 18 / 0.1)",
        glow: "0 0 24px rgb(var(--corona) / 0.4)",
        focus: "0 0 0 2px rgb(var(--corona)), 0 0 0 5px rgb(var(--corona) / 0.16)",
      },
      transitionDuration: { instant: "120ms", quick: "200ms", standard: "320ms", emphasis: "520ms", cinematic: "900ms" },
      transitionTimingFunction: {
        settle: "cubic-bezier(0.2, 0.8, 0.2, 1)",
        "in-out-soft": "cubic-bezier(0.65, 0, 0.35, 1)",
        spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      },
      letterSpacing: { label: "0.09em" },
    },
    // Legacy pages still use Tailwind's `neutral-*`. Re-pointing that one scale to warm paper/ink
    // values re-skins every existing screen at once; new code uses the semantic tokens above.
    colors: ({ colors }) => ({
      ...colors,
      neutral: {
        50: "#F6F5F2",
        100: "#EFEDE8",
        200: "#E7E5DF",
        300: "#D1CEC5",
        400: "#7F8086",
        500: "#5F6066",
        600: "#4A4B51",
        700: "#35363B",
        800: "#1F2024",
        900: "#0E0F12",
      },
    }),
  },
  plugins: [],
};
