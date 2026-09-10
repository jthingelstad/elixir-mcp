/**
 * The profile: the address the account holds, the tier, and the one
 * control that lives here - the timezone. The rail's identity block
 * names the address and leads here.
 */
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { App } from "../src/App.jsx";

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

test("the rail names the address and the profile shows it with the timezone", async () => {
  window.history.pushState({}, "", "/account/profile");
  render(<App />);
  await waitFor(() => screen.getByRole("heading", { name: "Profile" }));
  // The identity block, and the page, both carry the address.
  expect(
    screen.getAllByText("jamie@example.com").length,
  ).toBeGreaterThanOrEqual(2);
  const tz = screen.getByRole("combobox", { name: "Timezone" });
  expect(tz.value).toBe("America/Chicago");
  expect(screen.getByText("leader", { selector: ".chip" })).toBeTruthy();
});
