import { defineConfig, devices } from "@playwright/test";

/**
 * Client journeys against the BUILT tree and app-shell fixture
 * (infra/scripts/serve-site.mjs). Native SSR/hydration has its own server
 * in e2e/native-ssr.spec.ts. /api/* is
 * answered by each journey's fixtures (e2e/fixtures.ts), so this runs
 * without a database and exercises the real bundle, the real router,
 * the real chunks. `npm run e2e` from the repo root.
 */
const build = "node ../../infra/scripts/build-site.mjs --skip-stats";
const port = Number(process.env.ELIXIR_E2E_PORT ?? 4321);
const serve = `node ../../infra/scripts/serve-site.mjs --port ${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // GitHub's public-repo runners have four cores; the default is half.
  ...(process.env.CI ? { workers: 4 } : {}),
  reporter: process.env.CI ? "github" : "list",
  timeout: 30_000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
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
    // CI serves the tree its e2e job built just before. Locally the
    // journeys build first, so they never run against a stale tree.
    command: process.env.CI ? serve : `${build} && ${serve}`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
