import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // The editor labels come from the shared contract at the repository root.
  server: { port: 5174, fs: { allow: [".."] } },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    globals: true,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
