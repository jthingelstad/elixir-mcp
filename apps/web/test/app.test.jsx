import { test, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { App } from "../src/App.jsx";

function mockFetch(routes) {
  return vi.fn(async (path, init = {}) => {
    const key = `${init.method ?? "GET"} ${path}`;
    const route = routes[key];
    if (!route) throw new Error(`unmocked fetch: ${key}`);
    const [status, body] = typeof route === "function" ? route(init) : route;
    return { ok: status < 400, status, json: async () => body };
  });
}

beforeEach(() => {
  cleanup();
  window.history.pushState({}, "", "/");
});

test("landing renders the pitch, the disclaimer, and posts request-access", async () => {
  const calls = [];
  global.fetch = mockFetch({
    "GET /api/me": [200, { authenticated: false }],
    "GET /api/public/stats": [
      200,
      {
        totals: {
          battles: 1,
          players: 1,
          clans: 1,
          collectors_active: 1,
        },
        series: {
          battles_daily: [],
          players_observed_daily: [],
          fetches_daily: [],
        },
      },
    ],
    "POST /api/request-access": (init) => {
      calls.push(JSON.parse(init.body));
      expect(init.headers["x-elixir-client"]).toBe("web");
      return [200, { ok: true, message: "If your request is approved…" }];
    },
  });
  render(<App />);
  expect(
    await screen.findByText(/Clash Royale history, recorded/),
  ).toBeTruthy();
  expect(screen.getByText("UNOFFICIAL")).toBeTruthy();

  fireEvent.change(screen.getByLabelText(/Email/), {
    target: { value: "a@b.com" },
  });
  fireEvent.change(screen.getByLabelText(/player tag/i), {
    target: { value: "#20JJJ2CCRU" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Request access" }));
  await waitFor(() =>
    expect(screen.getByText(/If your request is approved/)).toBeTruthy(),
  );
  expect(calls[0].player_tag).toBe("#20JJJ2CCRU");
});

test("sign-in flow: email step then code step authenticates", async () => {
  global.fetch = mockFetch({
    "GET /api/me": [200, { authenticated: false }],
    "GET /api/public/stats": [
      200,
      {
        totals: {
          battles: 1,
          players: 1,
          clans: 1,
          collectors_active: 1,
        },
        series: {
          battles_daily: [],
          players_observed_daily: [],
          fetches_daily: [],
        },
      },
    ],
    "POST /api/auth": [200, { ok: true }],
    "POST /api/auth/code": (init) => {
      expect(JSON.parse(init.body)).toEqual({
        email: "j@x.com",
        code: "123456",
      });
      return [200, { authenticated: true }];
    },
  });
  render(<App />);
  fireEvent.click(await screen.findByText("Sign in"));
  fireEvent.change(await screen.findByLabelText(/Email/), {
    target: { value: "j@x.com" },
  });
  fireEvent.click(screen.getByText("Send sign-in email"));
  fireEvent.change(await screen.findByLabelText(/6-digit code/), {
    target: { value: "123456" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  await waitFor(() =>
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/auth/code",
      expect.anything(),
    ),
  );
});

test("account overview renders claims, recording state, and notify switches", async () => {
  window.history.pushState({}, "", "/dashboard");
  global.fetch = mockFetch({
    "GET /api/me": [
      200,
      {
        authenticated: true,
        is_owner: false,
        timezone: "America/Chicago",
        claims: [
          {
            player_tag: "#20JJJ2CCRU",
            status: "verified",
            is_primary: true,
            notify: true,
            name: "Jamie",
            last_known_clan_tag: "#J2RGCRVG",
          },
        ],
        recordings: [
          {
            subject_tag: "#20JJJ2CCRU",
            status: "active",
            freshest_poll: new Date().toISOString(),
          },
        ],
      },
    ],
    "GET /api/me/activity": [
      200,
      {
        events: [
          {
            kind: "signed_in",
            detail: null,
            created_at: new Date().toISOString(),
          },
        ],
      },
    ],
    "GET /api/me/connections": [
      200,
      {
        connections: [
          {
            family_id: "fam1",
            client_name: "Claude",
            created_at: new Date().toISOString(),
            last_token_at: new Date().toISOString(),
          },
        ],
      },
    ],
    "GET /api/me/usage": [
      200,
      {
        days: [{ day: "2026-09-03", calls: 12, errors: 0 }],
        top_tools: [{ tool: "get_player", calls: 7 }],
        today_calls: 12,
        live_today: 1,
        live_max: 50,
        quota_max: 500,
      },
    ],
    "GET /api/me/clans": [
      200,
      {
        clans: [],
        home_clan: null,
        slots: {
          activity: { used: 0, limit: 1 },
          comprehensive: { used: 0, limit: 0 },
        },
      },
    ],
  });
  render(<App />);
  expect(await screen.findByText("#20JJJ2CCRU")).toBeTruthy();
  expect(screen.getByText("Jamie")).toBeTruthy();
  expect(screen.getByText("active")).toBeTruthy();
  expect(screen.getByText("Add a player")).toBeTruthy();
  expect(screen.getAllByRole("switch").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Remove").length).toBeGreaterThan(0);
  expect(await screen.findByText("Your players")).toBeTruthy();
});

test("admin view is admin-gated in the UI", async () => {
  window.history.pushState({}, "", "/admin");
  global.fetch = mockFetch({
    "GET /api/me": [
      200,
      { authenticated: true, is_owner: false, claims: [], recordings: [] },
    ],
  });
  render(<App />);
  expect(await screen.findByText("Sign in first")).toBeTruthy();
});
