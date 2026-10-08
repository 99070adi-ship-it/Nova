// Config-driven, swappable product film asset (ARCHITECTURE.md "Product film") — a placeholder
// today; set VITE_PRODUCT_FILM_URL to point the landing page at a real video with no code change.
export const PRODUCT_FILM_URL = import.meta.env.VITE_PRODUCT_FILM_URL ?? "";

// The shared demo identity (backend/app/services/demo_service.py — DEMO_EMAIL/DEMO_PASSWORD).
// Pre-fills the login page so a portfolio visitor only has to click "Sign in" — logging in with
// these still goes through the exact same auth flow as any other account, no special-casing.
export const DEMO_CREDENTIALS = {
  email: "owner@velora.demo",
  password: "changeme123",
};
