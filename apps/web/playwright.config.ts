import { defineConfig, devices } from "@playwright/test";

/**
 * Journeys against the BUILT tree, behind the same document-or-shell
 * rule the edge applies (infra/scripts/serve-site.mjs). /api/* is
 * answered by each journey's fixtures (e2e/fixtures.ts), so this runs
 * without a database and exercises the real bundle, the real router,
 * the real chunks. `npm run e2e` from the repo root.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:4321",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "wide",
      use: { ...devices["Desktop Chrome"] },
      grepInvert: /@narrow/,
    },
    {
      name: "narrow",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 420, height: 860 },
      },
      grep: /@narrow/,
    },
  ],
  webServer: {
    command:
      "node ../../infra/scripts/build-site.mjs --skip-stats && node ../../infra/scripts/serve-site.mjs --port 4321",
    url: "http://127.0.0.1:4321/",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
