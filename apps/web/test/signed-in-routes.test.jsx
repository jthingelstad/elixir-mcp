/**
 * Every signed-in route, rendered against data it does not expect.
 *
 * Reported symptom: blank pages with a console error while logged in. That is
 * the signature of a render throw in an app that had NO error boundary --
 * React unmounts the whole tree, so one component's bad assumption took the
 * entire page down, navigation included, leaving no way forward but retyping
 * a URL.
 *
 * These mocks are deliberately WRONG-SHAPED. That is the point: this does not
 * assert that a view renders correctly (it cannot -- it has no real
 * fixtures), it asserts that a view which blows up is CONTAINED. The nav must
 * survive and the error must be readable, whatever the server said.
 */
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  cleanup,
  configure,
} from "@testing-library/react";
import { App } from "../src/App.jsx";
// The route chunks compile while this file loads, not inside a wait.
import "./warm-routes.js";
import { ADMIN, ADMIN_PAGES } from "../src/lib/settings.js";

// This file renders the whole App, routes and all, from a cold module
// graph. Testing Library's 1 s default wait reads a slow first paint on a
// loaded machine as a missing element (first-answer failed so, #488).
// Bound the wait as the other whole-App journeys do
// (account-journeys.test.jsx), with a 20 s bound on each test that renders it.
configure({ asyncUtilTimeout: 5000 });

const ME = {
  authenticated: true,
  is_admin: true,
  is_owner: true,
  role: "owner",
  account_id: "00000000-0000-0000-0000-000000000001",
};

// Well-formed JSON that is nonetheless not what any view is expecting.
const UNEXPECTED = {};

function permissiveFetch() {
  return vi.fn(async (path) => {
    const body = path === "/api/me" ? ME : UNEXPECTED;
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  });
}

beforeEach(() => {
  cleanup();
  // React logs caught boundary errors; that is expected here, not a failure.
  vi.spyOn(console, "error").mockImplementation(() => {});
  global.fetch = permissiveFetch();
});
// Unmount after each test too: left mounted, the last test's App outlives
// jsdom, and a query settling after teardown calls into React with no
// window (an unhandled error that fails the run).
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const routes = ["/home/find", "/home/you"];
// Admin's pages, under Settings since the Console folded (2026-11-12).
for (const page of Object.keys(ADMIN_PAGES)) routes.push(`${ADMIN}/${page}`);

/**
 * Detail pages, which the section walk above cannot discover.
 *
 * A detail page once shipped referencing a hook its parent did not import,
 * and every check in the repo passed: `verify` was green, the route sweep
 * covered the list and stopped there. A page nothing renders is a page nothing
 * tests.
 */
routes.push(
  "/settings/feedback/1",
  "/settings/admin/accounts/00000000-0000-0000-0000-000000000001",
  "/home/player/2ABC",
  "/home/player/2ABC?tab=record",
  "/home/follow/2ABC,9XYZ",
  "/home/passport",
  "/home/passport?stamp=cheerleader",
  "/home/passport/abcdefghjkmn",
);

for (const route of routes) {
  test(
    `signed in, ${route} survives data it did not expect`,
    { timeout: 20000 },
    async () => {
      window.history.pushState({}, "", route);
      render(<App />);
      // The navigation is the thing that must never disappear: without it a
      // failed page is a dead end rather than a bad page.
      // Two navs by design: tier 1 is the site row, tier 2 the section's pages.
      await waitFor(() =>
        expect(screen.getAllByRole("navigation").length).toBeGreaterThan(0),
      );
      const nav = screen.getAllByRole("navigation")[0];
      expect(
        nav.textContent.length,
        `nav vanished on ${route}`,
      ).toBeGreaterThan(0);
      // Either the view coped, or the boundary caught it and said so. What must
      // not happen is an empty main with no explanation.
      // A redirected or lazy page settles after the bar is up.
      await waitFor(() =>
        expect(
          (document.querySelector("main")?.textContent ?? "").trim().length,
          `blank main with no error shown on ${route}`,
        ).toBeGreaterThan(0),
      );
    },
  );
}

/**
 * The bug this file was written to catch, pinned directly.
 *
 * Migration 0053 made account.email_hash nullable so agents and integrations
 * -- which belong to a person and have no address of their own -- could
 * exist. Every admin table still called .slice() on it, so creating one agent
 * blanked EVERY /admin page at once: the throw happens in the shared Admin
 * component, above the per-page switch.
 */
test(
  "an agent account does not blank the admin pages",
  { timeout: 20000 },
  async () => {
    const AGENT = {
      account_id: "aaaaaaaa-0000-0000-0000-000000000002",
      email_hash: null, // <- the whole bug
      kind: "agent",
      principal_name: "poap-kings-agent",
      public_id: "jamie/poap-kings",
      status: "approved",
      role: "member",
      is_owner: false,
    };
    global.fetch = vi.fn(async (path) => {
      const p = String(path);
      const body = p.includes("/api/me")
        ? ME
        : p.includes("/admin/accounts")
          ? { accounts: [AGENT] }
          : p.includes("/admin/usage")
            ? {
                accounts: [{ ...AGENT, calls_today: 3, calls_7d: 9 }],
                tools: [],
              }
            : { requests: [], gateways: [], feedback: [], tokens: [] };
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      };
    });

    window.history.pushState({}, "", "/settings/admin/accounts");
    render(<App />);
    // Named, not dashed: a table that says who did what must say who.
    await waitFor(() =>
      expect(screen.getAllByText(/poap-kings-agent/).length).toBeGreaterThan(0),
    );
    expect(screen.queryByText(/This section failed to render/)).toBeNull();
  },
);
