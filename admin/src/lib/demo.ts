// Config-driven, swappable product film asset (ARCHITECTURE.md "Product film"). Ships with the NOVA
// vision film in public/; set VITE_PRODUCT_FILM_URL (and _POSTER_URL) to point at a different one with
// no code change. The poster is the film's end card: it is what shows while the video loads, under
// reduced motion, on small screens, and if the video can't play.
export const PRODUCT_FILM_URL = import.meta.env.VITE_PRODUCT_FILM_URL ?? "/nova-trailer.mp4";
export const PRODUCT_FILM_POSTER_URL = import.meta.env.VITE_PRODUCT_FILM_POSTER_URL ?? "/nova-trailer-poster.jpg";

// The shared demo identity (backend/app/services/demo_service.py — DEMO_EMAIL/DEMO_PASSWORD).
// Pre-fills the login page so a portfolio visitor only has to click "Sign in" — logging in with
// these still goes through the exact same auth flow as any other account, no special-casing.
export const DEMO_CREDENTIALS = {
  email: "owner@velora.demo",
  password: "changeme123",
};
