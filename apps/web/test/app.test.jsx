import { describe, test, expect, vi, beforeEach } from "vitest";
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
  // The list: what is tracked, how it relates to you, and how fresh it
  // is. One table over players and clans — a player and a clan are both
  // something you track.
  expect(await screen.findByText("#20JJJ2CCRU")).toBeTruthy();
  expect(screen.getByText("Jamie")).toBeTruthy();
  expect(screen.getByText("you")).toBeTruthy();
  expect(screen.getAllByText("Manage").length).toBeGreaterThan(0);
  // The controls are NOT in the row: a row with four controls in it is a
  // form pretending to be a list.
  expect(screen.queryByRole("switch")).toBeNull();
  // Both kinds can be added, from the same page.
  expect(screen.getAllByRole("button", { name: "Track" })).toHaveLength(2);
  expect(screen.getByLabelText("Player tag")).toBeTruthy();
  expect(screen.getByLabelText("Clan tag")).toBeTruthy();
});

test("the tracked record holds the controls, and says what stopping costs", async () => {
  window.history.pushState(
    {},
    "",
    `/account/tracking/${encodeURIComponent("#20JJJ2CCRU")}`,
  );
  global.fetch = mockFetch({
    "GET /api/me": [
      200,
      {
        authenticated: true,
        is_owner: false,
        claims: [
          {
            player_tag: "#20JJJ2CCRU",
            is_primary: true,
            notify: true,
            name: "Jamie",
            relationship: "you",
          },
        ],
        recordings: [
          {
            subject_tag: "#20JJJ2CCRU",
            status: "active",
            freshest_poll: new Date().toISOString(),
            fetches_24h: 38,
          },
        ],
      },
    ],
    "GET /api/me/clans": [200, { clans: [], home_clan: null, slots: {} }],
  });
  render(<App />);
  expect(await screen.findByText("Jamie")).toBeTruthy();
  expect(screen.getByRole("switch", { name: "Notifications" })).toBeTruthy();
  expect(screen.getByText("active")).toBeTruthy();
  // The consequence sits beside the control, not behind a confirm.
  const stop = screen.getByRole("button", { name: "Stop tracking" });
  expect(stop).toBeTruthy();
  expect(screen.getByText("History already recorded is kept.")).toBeTruthy();
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
  expect(t("/data/dashboard")).toBe("Charts - Data - Elixir MCP");
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

test("the Overview opens on the battle-activity graphic, with a chip per tracked player and a link to the record", async () => {
  window.history.pushState({}, "", "/account");
  const days = [];
  const end = Date.parse("2026-09-13T00:00:00Z");
  for (let i = 364; i >= 0; i -= 1) {
    const day = new Date(end - i * 86_400_000).toISOString().slice(0, 10);
    days.push({
      day,
      battles: day === "2026-09-12" ? 4 : 0,
      status: day >= "2026-09-03" ? "recorded" : "not_recorded",
    });
  }
  const activity = {
    player_tag: "#20JJJ2CCRU",
    computed_at: "2026-09-13T05:30:00Z",
    window_days: 365,
    half_life_days: 28,
    rhythm: new Array(168).fill(0),
    rhythm_battles: 4,
    days,
  };
  global.fetch = mockFetch({
    "GET /api/me": [
      200,
      {
        authenticated: true,
        is_owner: false,
        claims: [
          { player_tag: "#20JJJ2CCRU", is_primary: true, name: "Jamie" },
          {
            player_tag: "#VJG0J29QP",
            is_primary: false,
            name: "Big Thing",
            relationship: "alt",
          },
        ],
        recordings: [],
      },
    ],
    "GET /api/me/clans": [200, { clans: [], home_clan: null, slots: {} }],
    "GET /api/me/first-answer": [200, { suggestions: [] }],
    "GET /api/me/battle-activity/20JJJ2CCRU": [200, activity],
    "GET /api/me/battle-activity/VJG0J29QP": [
      200,
      { ...activity, player_tag: "#VJG0J29QP", computed_at: null, days: [] },
    ],
  });
  render(<App />);
  // The primary's year is drawn first, without a click.
  expect(
    await screen.findByRole("button", { name: /^Sat 12 Sep 2026: 4 battles$/ }),
  ).toBeTruthy();
  expect(screen.getByText("Battle activity")).toBeTruthy();
  const alt = screen.getByRole("button", { name: "Big Thing" });
  expect(alt.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(alt);
  // The alt has no row yet: the panel says so instead of an empty year.
  expect(await screen.findByText(/Not computed yet/)).toBeTruthy();
  expect(alt.getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByText("Record ›")).toBeTruthy();
});

test("a legacy path is redirected and the ADDRESS BAR follows it", async () => {
  // The old REDIRECTS rendered the new page under the old address, so a
  // bookmark to /data/status credited the old path in the report and
  // /status/service looked unvisited. The router replaces the entry.
  window.history.pushState({}, "", "/data/status");
  global.fetch = mockFetch({
    "GET /api/me": [200, { authenticated: false }],
  });
  render(<App />);
  await waitFor(() => expect(window.location.pathname).toBe("/status/service"));
  // A partial path lands on the section's first page the same way.
  cleanup();
  window.history.pushState({}, "", "/account");
  render(<App />);
  await waitFor(() =>
    expect(window.location.pathname).toBe("/account/overview"),
  );
  // And the query string rides along.
  cleanup();
  window.history.pushState({}, "", "/admin?x=1");
  render(<App />);
  await waitFor(() => expect(window.location.pathname).toBe("/admin/requests"));
  expect(window.location.search).toBe("?x=1");
});

test("the bare Activity path was the timeline's address, and still opens it", async () => {
  // The timeline left Activity for its own rail item (2026-09-23); a
  // bookmark or a docs link to /account/activity meant the timeline.
  window.history.pushState({}, "", "/account/activity");
  global.fetch = mockFetch({
    "GET /api/me": [200, { authenticated: false }],
  });
  render(<App />);
  await waitFor(() =>
    expect(window.location.pathname).toBe("/account/timeline"),
  );
  // Activity's own pages keep their addresses.
  cleanup();
  window.history.pushState({}, "", "/account/activity/requests");
  render(<App />);
  await waitFor(() => expect(document.querySelector(".page")).toBeTruthy());
  expect(window.location.pathname).toBe("/account/activity/requests");
});

test("every app section in the route table has a route, and nothing else does", async () => {
  const { routeTree, SECTIONS } = await import("../src/App.jsx");
  const routed = new Set(
    routeTree.children.map((r) => r.path.split("/").filter(Boolean)[0]),
  );
  for (const section of Object.keys(SECTIONS))
    expect(routed.has(section), `${section} has no route`).toBe(true);
  expect(routed.has("signin")).toBe(true);
  expect(routed.size).toBe(Object.keys(SECTIONS).length + 1);
});

test("the console prints times on the account's clock, and UTC when none is set", async () => {
  // Jamie, 2026-09-23: the console knew the zone and printed UTC anyway.
  const timeline = {
    window: { from: "2026-09-06T02:30:00Z", to: "2026-09-13T02:30:00Z" },
    read_to: null,
    timeline: [
      {
        at: "2026-09-13T02:30:00Z",
        subject_tag: "#20JJJ2CCRU",
        subject_name: "Jamie",
        kind: "battle_session",
        section: "battles",
        text: "Played a battle session.",
        facts: {},
      },
    ],
    timeline_more: 0,
    entries: [],
    quiet: [],
  };
  const signedIn = (timezone) =>
    mockFetch({
      "GET /api/me": [
        200,
        { authenticated: true, timezone, claims: [], recordings: [] },
      ],
      "GET /api/me/timeline": [200, timeline],
    });

  window.history.pushState({}, "", "/account/timeline");
  global.fetch = signedIn("America/Chicago");
  render(<App />);
  // The evening before, in Chicago, and named as Chicago's clock.
  expect(await screen.findByText("09-12 21:30 CDT")).toBeTruthy();

  cleanup();
  window.history.pushState({}, "", "/account/timeline");
  global.fetch = signedIn(null);
  render(<App />);
  expect(await screen.findByText("09-13 02:30Z")).toBeTruthy();
});

test("the timeline lists newest first, and says when a busy week was cut", async () => {
  // Jamie, 2026-09-23: the timeline is a newsfeed, newest first
  // everywhere (contract 7.0.0); the page keeps the API's order.
  const item = (at, text) => ({
    at,
    subject_tag: "#20JJJ2CCRU",
    subject_name: "Jamie",
    kind: "battle_session",
    section: "battles",
    text,
    facts: {},
  });
  window.history.pushState({}, "", "/account/timeline");
  global.fetch = mockFetch({
    "GET /api/me": [200, { authenticated: true, claims: [], recordings: [] }],
    "GET /api/me/timeline": [
      200,
      {
        read_to: null,
        timeline: [
          item("2026-09-12T10:00:00Z", "The newer session."),
          item("2026-09-10T10:00:00Z", "The older session."),
        ],
        timeline_more: 7,
        entries: [],
        quiet: [],
      },
    ],
  });
  render(<App />);
  await screen.findByText("The newer session.");
  const texts = [...document.querySelectorAll("tbody tr")].map(
    (tr) => tr.children[2].textContent,
  );
  expect(texts).toEqual(["The newer session.", "The older session."]);
  expect(
    screen.getByText(/the 2 newest are shown, and 7 more this week are not/),
  ).toBeTruthy();
});

describe("an agent's console (2026-09-23)", () => {
  const PERSON = {
    authenticated: true,
    kind: "person",
    role: "owner",
    is_owner: true,
    email: "jamie@example.com",
    claims: [
      {
        player_tag: "#20JJJ2CCRU",
        is_primary: true,
        name: "King Thing",
        nickname: "Jamie",
      },
    ],
    recordings: [],
    signals: { tracking: 3, connections: 2, feedback: 0 },
    agents: [
      {
        public_id: "abcd1234",
        name: "poap-bot",
        role: "leader",
        status: "approved",
        clan: { clan_tag: "#J2RGCRVG", name: "POAP KINGS" },
      },
    ],
  };
  const AGENT = {
    authenticated: true,
    kind: "agent",
    public_id: "abcd1234",
    name: "poap-bot",
    role: "leader",
    clans: [{ clan_tag: "#J2RGCRVG", name: "POAP KINGS", is_primary: true }],
    claims: [],
    recordings: [],
    signals: { tracking: 1, connections: 0, feedback: 2, timeline_pending: 1 },
  };
  const timeline = (text) => ({
    read_to: null,
    timeline: [
      {
        at: "2026-09-12T10:00:00Z",
        subject_tag: "#J2RGCRVG",
        subject_name: "POAP KINGS",
        kind: "member_joined",
        section: "roster",
        text,
        facts: {},
      },
    ],
    timeline_more: 0,
    entries: [],
    quiet: [],
  });

  test("the rail head switches consoles, and each reads only its own account", async () => {
    const fetch = mockFetch({
      "GET /api/me": [200, PERSON],
      "GET /api/me/timeline": [200, timeline("Yours.")],
      "GET /api/agent/abcd1234": [200, AGENT],
      "GET /api/agent/abcd1234/timeline": [200, timeline("The agent's.")],
    });
    global.fetch = fetch;
    window.history.pushState({}, "", "/account/timeline");
    render(<App />);
    await screen.findByText("Yours.");
    // Your console: the head names you, and offers the agent.
    const head = await screen.findByRole("button", { name: /Jamie/ });
    fireEvent.click(head);
    fireEvent.click(await screen.findByRole("link", { name: /poap-bot/ }));
    await waitFor(() =>
      expect(window.location.pathname).toBe("/agent/abcd1234/overview"),
    );
    // On the agent's console the head names the agent, tinted, and its
    // rail has no person's pages.
    const agentHead = await screen.findByRole("button", { name: /poap-bot/ });
    expect(agentHead.closest(".rail__switch").getAttribute("data-scoped")).toBe(
      "true",
    );
    const rail = document.querySelector(".rail");
    expect(rail.textContent).toContain("Settings");
    expect(rail.textContent).not.toContain("Verify");
    expect(rail.textContent).not.toContain("Collections");
    // Its Timeline reads the agent's route and never yours.
    fireEvent.click(screen.getByRole("link", { name: /^Timeline/ }));
    await screen.findByText("The agent's.");
    const paths = fetch.mock.calls.map(([p]) => p);
    expect(paths).toContain("/api/agent/abcd1234/timeline");
    expect(
      paths.filter((p) => p === "/api/me/timeline").length,
      "yours was read once, on your console",
    ).toBe(1);
  });

  test("its Tracking: the clan it acts for, a rival it watches, and re-pointing it", async () => {
    const posts = [];
    global.fetch = mockFetch({
      "GET /api/me": [200, PERSON],
      "GET /api/agent/abcd1234": [
        200,
        {
          ...AGENT,
          claims: [
            {
              player_tag: "#PQLGR2C9",
              name: "Rival Star",
              relationship: "watching",
              notify: true,
            },
          ],
          entitlements: {
            player_slots: { used: 4, limit: 50 },
            activity_clans: { used: 2, limit: 3 },
            comprehensive_clans: { used: 1, limit: 3 },
          },
        },
      ],
      "GET /api/agent/abcd1234/clans": [
        200,
        {
          clans: [
            {
              clan_tag: "#J2RGCRVG",
              name: "POAP KINGS",
              scope: "comprehensive",
              notify: true,
              is_primary: true,
            },
            {
              clan_tag: "#PGLQYRJ2",
              name: "Rivals",
              scope: "activity",
              notify: true,
              is_primary: false,
            },
          ],
        },
      ],
      "POST /api/agent/abcd1234/clans": (init) => {
        posts.push(JSON.parse(init.body));
        return [200, { ok: true }];
      },
    });
    window.history.pushState({}, "", "/agent/abcd1234/tracking");
    render(<App />);
    await screen.findByText("Rivals");
    expect(screen.getByText("acts for")).toBeTruthy();
    expect(screen.getByText("Rival Star")).toBeTruthy();
    expect(screen.getByText(/activity 2 of 3/)).toBeTruthy();
    // The clan it acts for offers no removal; the rival can take its place.
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(2);
    fireEvent.click(
      screen.getByRole("button", { name: "Make it the clan it acts for" }),
    );
    await waitFor(() =>
      expect(posts).toEqual([{ clan_tag: "#PGLQYRJ2", action: "primary" }]),
    );
  });

  test("an agent that is not yours says so, and shows nothing of anyone's", async () => {
    global.fetch = mockFetch({
      "GET /api/me": [200, PERSON],
      "GET /api/agent/zzzz9999": [404, { error: "not_found" }],
    });
    window.history.pushState({}, "", "/agent/zzzz9999/timeline");
    render(<App />);
    expect(
      await screen.findByText(/No agent here on your account/),
    ).toBeTruthy();
  });
});
