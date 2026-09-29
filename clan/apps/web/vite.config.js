import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/** One SPA, served under Elixir's /clan (lib/base.js): `base` makes the
 *  build reference /clan/assets/..., the files Clan's web deploy puts
 *  under clan/ in its bucket. The Lambda answers /api/clan/* on the same
 *  origin; in development that is proxied to 4320, where nothing runs:
 *  there is no local API runner (services/api/local.mjs was never
 *  written); `npm run e2e` stubs the routes instead. Tailwind compiles
 *  src/styles.css: Elixir's tokens and components from the workspace
 *  kit, plus the utilities this app and the kit use. */
export default defineConfig({
  base: "/clan/",
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api/clan": "http://localhost:4320",
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
    // Playwright's journeys live in e2e/ and run under its own runner.
    exclude: ["e2e/**", "node_modules/**"],
  },
});
