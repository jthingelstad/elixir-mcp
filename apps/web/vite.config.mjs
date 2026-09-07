import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** The app is one half of elixir.poapkings.com. Its shell is emitted as
 *  app.html, not index.html, because the static site (apps/site) owns
 *  the root document; the edge router rewrites every app-owned path to
 *  /app.html. Assets stay at /assets/ and are merged with the static
 *  build by infra/scripts/build-site.mjs. */
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/api": "http://localhost:4319" },
  },
  test: {
    environment: "jsdom",
    globals: false,
  },
});
