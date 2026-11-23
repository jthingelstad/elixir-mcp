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
  fireEvent,
  within,
} from "@testing-library/react";
import { App } from "../src/App.jsx";
// The route chunks compile while this file loads, not inside a wait.
import "./warm-routes.js";
// Settings is a lazy chunk. Imported here, its module graph compiles while
// the file loads, where no wait is bounded, instead of inside the first
// test's wait for the page: on a loaded host the compile was most of a
// first paint and outran the 5 s wait (2026-11-12).
import "../src/pages/SettingsPage.jsx";

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
  "the page names the address and the profile shows it with the timezone",
  { timeout: 20000 },
  async () => {
    window.history.pushState({}, "", "/settings/profile");
    render(<App />);
    await waitFor(() =>
      screen.getByRole("heading", { name: "Profile settings" }),
    );
    expect(screen.getAllByText("jamie@example.com").length).toBeGreaterThan(0);
    const tz = screen.getByRole("combobox", { name: "Time zone" });
    expect(tz.value).toBe("America/Chicago");
    expect(screen.getByText(/Leader limits/)).toBeTruthy();
  },
);

const PLACED = {
  country: "CA",
  country_name: "Canada",
  region: "08",
  region_name: "Ontario",
  city: null,
  city_name: null,
  precision: "region",
};

function placeFetch(place) {
  const calls = [];
  global.fetch = vi.fn(async (path, init) => {
    const p = String(path);
    if (p === "/api/clan/me/place") calls.push(init?.method ?? "GET");
    const body =
      p === "/api/me"
        ? ME
        : p === "/api/clan/me/place"
          ? init?.method === "DELETE"
            ? { cleared: true }
            : { place }
          : {};
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  });
  return calls;
}

test(
  "Your place lives on Profile: Not set with Set, or the place with Change and Remove",
  { timeout: 20000 },
  async () => {
    placeFetch(null);
    window.history.pushState({}, "", "/settings/profile");
    render(<App />);
    const head = await screen.findByRole("heading", { name: "Your place" });
    const section = head.closest("section");
    await within(section).findByText("Not set");
    expect(
      within(section).getByText(/your clan’s verified members/),
    ).toBeTruthy();
    fireEvent.click(
      within(section).getByRole("button", { name: "Set your place" }),
    );
    await within(section).findByLabelText("Country");
    fireEvent.click(within(section).getByRole("button", { name: "Cancel" }));
    await within(section).findByText("Not set");
    cleanup();

    const calls = placeFetch(PLACED);
    window.history.pushState({}, "", "/settings/profile");
    render(<App />);
    const placed = (
      await screen.findByRole("heading", { name: "Your place" })
    ).closest("section");
    await within(placed).findByText("Ontario, Canada");
    expect(
      within(placed).getByRole("button", { name: "Change your place" }),
    ).toBeTruthy();
    fireEvent.click(
      within(placed).getByRole("button", { name: "Remove your place" }),
    );
    await waitFor(() => expect(calls).toContain("DELETE"));
  },
);

test(
  "#place opens the picker at once (the passport's On the Map, Location)",
  { timeout: 20000 },
  async () => {
    placeFetch(null);
    window.history.pushState({}, "", "/settings/profile#place");
    render(<App />);
    const country = await screen.findByLabelText("Country");
    await waitFor(() => expect(document.activeElement).toBe(country));
  },
);

test(
  "Delete your account asks for DELETE typed out, then deletes and leaves",
  { timeout: 20000 },
  async () => {
    const sent = [];
    let answer = {
      status: 409,
      body: {
        error: "refused",
        code: "collectors_live",
        message: "Revoke your collector first, in Settings › Collectors.",
      },
    };
    global.fetch = vi.fn(async (path, init) => {
      const p = String(path);
      let status = 200;
      let body = p === "/api/me" ? ME : {};
      if (p === "/api/me/account/delete") {
        sent.push(JSON.parse(init.body));
        ({ status, body } = answer);
      }
      return {
        ok: status < 400,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
      };
    });
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...original, assign, hash: "", pathname: original.pathname },
    });
    try {
      window.history.pushState({}, "", "/settings/profile");
      render(<App />);
      const head = await screen.findByRole("heading", {
        name: "Delete your account",
      });
      const panel = head.closest("section") ?? document.body;
      expect(within(panel).getByText(/can’t be undone/)).toBeTruthy();
      fireEvent.click(
        within(panel).getByRole("button", { name: "Delete account" }),
      );
      const go = within(panel).getByRole("button", {
        name: "Delete my account",
      });
      expect(go.disabled).toBe(true);
      const box = within(panel).getByLabelText("Type DELETE to confirm");
      fireEvent.change(box, { target: { value: "delete" } });
      expect(go.disabled).toBe(true);
      fireEvent.change(box, { target: { value: "DELETE" } });
      expect(go.disabled).toBe(false);

      // A refusal says why and deletes nothing.
      fireEvent.click(go);
      await within(panel).findByText(/Revoke your collector first/);
      expect(assign).not.toHaveBeenCalled();

      answer = { status: 200, body: { ok: true } };
      fireEvent.click(go);
      await waitFor(() => expect(assign).toHaveBeenCalledWith("/"));
      expect(sent).toEqual([{ confirm: "DELETE" }, { confirm: "DELETE" }]);
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: original,
      });
    }
  },
);
