/**
 * The profile: the address the account holds, the tier, and the one
 * control that lives here - the timezone. The bar's account menu names
 * the address and leads here ("Account settings").
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

// This file renders the whole App, routes and all, from a cold module
// graph. Testing Library's 1 s default wait reads a slow first paint on a
// loaded machine as a missing element (first-answer failed so, #488).
// Bound the wait as the other whole-App journeys do
// (account-journeys.test.jsx), with a 20 s bound on each test that renders it.
configure({ asyncUtilTimeout: 5000 });

const ME = {
  authenticated: true,
  is_admin: false,
  is_owner: false,
  role: "leader",
  email: "jamie@example.com",
  timezone: "America/Chicago",
  claims: [],
  recordings: [],
  entitlements: {},
};

beforeEach(() => {
  cleanup();
  vi.spyOn(console, "error").mockImplementation(() => {});
  global.fetch = vi.fn(async (path) => {
    const body = String(path) === "/api/me" ? ME : {};
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  });
});
afterEach(() => vi.restoreAllMocks());

test(
  "the console names the address and the profile shows it with the timezone",
  { timeout: 20000 },
  async () => {
    window.history.pushState({}, "", "/console/account/profile");
    render(<App />);
    await waitFor(() => screen.getByRole("heading", { name: "Profile" }));
    // The rail's account selector, and the page, both carry the address.
    expect(
      screen.getAllByText("jamie@example.com").length,
    ).toBeGreaterThanOrEqual(2);
    const tz = screen.getByRole("combobox", { name: "Timezone" });
    expect(tz.value).toBe("America/Chicago");
    expect(screen.getByText("leader", { selector: ".chip" })).toBeTruthy();
  },
);
