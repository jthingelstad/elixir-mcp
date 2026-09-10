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
    // The client reads the body as text and parses it itself, so a
    // response that is not JSON can never be mistaken for success.
    return {
      ok: status < 400,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  });
}

beforeEach(() => {
  cleanup();
  window.history.pushState({}, "", "/");
});

test("a path the app does not own leaves for the static site", async () => {
  // Home, docs, updates and the changelog are real documents built by
  // apps/site. The app must hand those paths back rather than render an
  // empty main - the state the old catch-all Landing fallback hid.
  const replace = vi.fn();
  vi.stubGlobal("location", { ...window.location, replace });
  window.history.pushState({}, "", "/");
  global.fetch = mockFetch({ "GET /api/me": [200, { authenticated: false }] });
  render(<App />);
  await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  vi.unstubAllGlobals();
});

test("the app owns its own sections and disowns the static ones", async () => {
  const { legalRoute, STATIC_LINKS } = await import("../src/App.jsx");
  // Owned: resolved to a real app page.
  expect(legalRoute("/data/dashboard")).toBe("/data/dashboard");
  expect(legalRoute("/data/nonsense")).toBe("/data/dashboard");
  expect(legalRoute("/signin")).toBe("/signin");
  expect(legalRoute("/explore/player/%2320JJJ2CCRU")).toBe(
    "/explore/player/%2320JJJ2CCRU",
  );
  // Disowned: every static path, and anything unrecognised.
  for (const path of Object.values(STATIC_LINKS)) {
    expect(legalRoute(path)).toBe(null);
  }
  expect(legalRoute("/")).toBe(null);
  expect(legalRoute("/bogus")).toBe(null);
  // The changelog sits inside an app section but is a static page, so
  // it must never be chosen as the section's default page. /data itself
  // is a static page too now — the corpus proof — so the bare path goes
  // back to the site rather than resolving to the app's dashboard.
  expect(legalRoute("/data")).toBe(null);
  expect(legalRoute("/data/nonsense")).toBe("/data/dashboard");
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
  // The top bar has no signed-in state by design, so Console is the way
  // in: signed out it lands on the wall, which offers Sign in.
  fireEvent.click(await screen.findByText("Console"));
  fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));
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

test("tracking renders claims, recording state, and notify switches", async () => {
  // The table moved off Overview with the 2026-09-09 split: Overview
  // reports these, Tracking is where they can be changed.
  window.history.pushState({}, "", "/account/tracking");
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
            scope: "cr:read",
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

test("the tab title names the page, most specific part first", async () => {
  // A browser tab truncates from the right, so the distinguishing word
  // has to lead or every Elixir MCP tab looks identical.
  const { titleFor, SECTIONS } = await import("../src/App.jsx");
  const t = (path) => {
    const section = path.split("/")[1];
    return titleFor(section, SECTIONS[section], path);
  };
  expect(t("/")).toBe("Elixir MCP");
  expect(t("/status/service")).toBe("Status - Elixir MCP");
  expect(t("/data/dashboard")).toBe("Dashboard - Data - Elixir MCP");
  expect(t("/admin/collectors")).toBe("Collectors - Admin - Elixir MCP");
  expect(t("/status/collectors")).toBe("Collectors - Status - Elixir MCP");
  // Explore owns its sub-pages, so a record beats the page slug: it is
  // the most specific thing shown.
  expect(t("/explore/player/%2320JJJ2CCRU")).toBe(
    "#20JJJ2CCRU - Explore - Elixir MCP",
  );
});

test("an HTML body is a failure however it is numbered", async () => {
  // #20: the distribution rewrote API 403/404 into a 200 app shell, and
  // this client's `res.json().catch(() => ({}))` turned that into
  // {ok:true,status:200,data:{}} — a refusal read as success. The edge
  // no longer does it; the client no longer accepts it either.
  const { api } = await import("../src/api.js");
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError("Unexpected token <");
    },
    text: async () => "<!doctype html><html><body>app shell</body></html>",
  }));
  const res = await api.adminRequests();
  expect(res.ok).toBe(false);
  expect(res.error).toBe("bad_response");
  expect(res.data).toEqual({});
});

test("an empty body is still a success", async () => {
  const { api } = await import("../src/api.js");
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 204,
    json: async () => ({}),
    text: async () => "",
  }));
  const res = await api.signOut();
  expect(res.ok).toBe(true);
  expect(res.data).toEqual({});
});
