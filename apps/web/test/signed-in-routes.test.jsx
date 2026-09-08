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
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { App, SECTIONS } from "../src/App.jsx";

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
afterEach(() => vi.restoreAllMocks());

const routes = [];
for (const [section, def] of Object.entries(SECTIONS)) {
  if (def.pages.length === 0) routes.push(`/${section}`);
  for (const page of def.pages)
    if (!page.static) routes.push(`/${section}/${page.slug}`);
}

for (const route of routes) {
  test(`signed in, ${route} survives data it did not expect`, async () => {
    window.history.pushState({}, "", route);
    render(<App />);
    // The navigation is the thing that must never disappear: without it a
    // failed page is a dead end rather than a bad page.
    // Two navs by design: tier 1 is the site row, tier 2 the section's pages.
    await waitFor(() =>
      expect(screen.getAllByRole("navigation").length).toBeGreaterThan(0),
    );
    const nav = screen.getAllByRole("navigation")[0];
    expect(nav.textContent.length, `nav vanished on ${route}`).toBeGreaterThan(
      0,
    );
    // Either the view coped, or the boundary caught it and said so. What must
    // not happen is an empty main with no explanation.
    const main = document.querySelector("main");
    expect(
      (main?.textContent ?? "").trim().length,
      `blank main with no error shown on ${route}`,
    ).toBeGreaterThan(0);
  });
}
