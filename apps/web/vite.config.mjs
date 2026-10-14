import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** CloudFront sends app paths to the native web server, which injects
 * request-local React HTML into this shell. Assets stay under /assets/
 * and publish before the matching immutable server revision. */
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/api": "http://localhost:4319" },
  },
  test: {
    environment: "jsdom",
    globals: false,
    // Playwright's journeys live in e2e/ and run under its own runner.
    exclude: ["e2e/**", "node_modules/**"],
    // A stand-in for Cloudflare's Turnstile script (src/turnstile.js).
    setupFiles: ["test/setup-turnstile.js"],
  },
});
