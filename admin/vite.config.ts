import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    globals: true,
    // Tests rely on real timers (typing, polling). A busy or throttled host can freeze a process for
    // several seconds, so timeouts are generous; assertions are about ordering, not wall-clock speed.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
