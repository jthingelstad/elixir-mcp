import { describe, test, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  cleanup,
  configure,
} from "@testing-library/react";
import { App } from "../src/App.jsx";
// The route chunks compile while this file loads, not inside a wait.
import "./warm-routes.js";

// This file renders the whole App, routes and all, from a cold module
// graph. Testing Library's 1 s default wait reads a slow first paint on a
// loaded machine as a missing element (first-answer failed so, #488).
// Bound the wait as the other whole-App journeys do
// (account-journeys.test.jsx), with a 20 s bound on each test that renders it.
configure({ asyncUtilTimeout: 5000 });

function mockFetch(routes) {
  return vi.fn(async (path, init = {}) => {
    const key = `${init.method ?? "GET"} ${path}`;
    // A route a test did not mock answers 404. It used to throw, which
    // the client reads as a transport failure and retries after a real
    // 1.5 s (packages/client query.ts): a wait inside the test (the tag
    // fix waited on its refresh's retry) and, after cleanup, a stray
    // request into the next test's mock.
    const route = routes[key] ?? [404, { error: `unmocked fetch: ${key}` }];
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

// An account that follows a friend and has no player of its own: Home is its
// steps and, below them, its feed (#765). Fixture names only.
const FOLLOWS_A_FRIEND = [
  {
    player_tag: "#2FRND",
    name: "Fixture Friend",
    is_primary: false,
    relationship: "friend",
  },
];
const NO_PLAYER_YET = {
  "GET /api/me/home": [200, { first: { ok: true, player: null } }],
};

test(
  "a path the app does not own leaves for the static site",
  { timeout: 20000 },
  async () => {
    // Home, docs, updates and the changelog are real documents built by
    // apps/site. The app must hand those paths back rather than render an
    // empty main - the state the old catch-all Landing fallback hid.
    const replace = vi.fn();
    vi.stubGlobal("location", { ...window.location, replace });
    window.history.pushState({}, "", "/");
    global.fetch = mockFetch({
      "GET /api/me": [200, { authenticated: false }],
    });
    render(<App />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    vi.unstubAllGlobals();
  },
);

test("the app owns /console and disowns everything else", async () => {
  const { legalRoute, STATIC_LINKS } = await import("../src/App.jsx");
  // Owned: resolved to a real app page.
  // The charts joined the site's /data page: a section the app no longer has.
  expect(legalRoute("/console/data/nonsense")).toBe(null);
  expect(legalRoute("/signin")).toBe("/signin");
  // The service page folded into Admin and the public /data (2026-11-12).
  expect(legalRoute("/data/service")).toBe(null);
  // Explore folded (2026-11-12): /console/ holds no page of its own.
  expect(legalRoute("/console/explore/player/%2320JJJ2CCRU")).toBe(null);
  expect(legalRoute("/console/bogus")).toBe(null);
  // Disowned: every static path, and every path outside the prefix,
  // the Console's old addresses at the root included (2026-09-28: no
  // aliases, nobody was using them yet).
  for (const path of Object.values(STATIC_LINKS)) {
    expect(legalRoute(path)).toBe(null);
  }
  for (const path of [
    "/",
    "/bogus",
    "/account/overview",
    "/explore/player/%2320JJJ2CCRU",
    "/data/dashboard",
    "/consoles/account/overview",
  ]) {
    expect(legalRoute(path)).toBe(null);
  }
});

test(
  "sign-in flow: email step then code step authenticates",
  { timeout: 20000 },
  async () => {
    // Signed out until the code is redeemed, signed in after: the journey
    // ends on Home, and the test waits for it there.
    let redeemed = false;
    global.fetch = mockFetch({
      "GET /api/me": () =>
        redeemed
          ? [200, { authenticated: true, claims: [], recordings: [] }]
          : [200, { authenticated: false }],
      ...NO_PLAYER_YET,
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
        redeemed = true;
        return [200, { authenticated: true }];
      },
    });
    // Signed out, the bar's account slot is "Sign in", routed in-app.
    window.history.pushState({}, "", "/home");
    render(<App />);
    await screen.findByText("Sign in first");
    fireEvent.click(
      within(document.querySelector(".kit-top")).getByRole("link", {
        name: "Sign in",
      }),
    );
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
    // Wait for the journey's end, signed in on Home. Ended at the POST,
    // the sign-in finished during the NEXT test (its session read and its
    // move to Home), and on a slow runner that move took the next test's
    // page away (CI on 80dc908c, "tracking renders claims").
    expect(await screen.findByText("Welcome to Elixir")).toBeTruthy();
    expect(window.location.pathname).toBe("/home");
  },
);

test(
  "tracking renders claims, recording state, and notify switches",
  { timeout: 20000 },
  async () => {
    // The table moved off Overview with the 2026-09-09 split: Overview
    // reports these, Tracking is where they can be changed.
    window.history.pushState({}, "", "/settings/players");
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
    // The list: what is tracked, how it relates to you, and how fresh it is.
    // The first paint loads the Settings chunk cold; on a loaded CI runner
    // that outlasted the 5 s wait with the page still "Reading your
    // settings." (main, 2026-11-12), so this first wait is longer.
    await screen.findByText(/Your main player/, {}, { timeout: 15000 });
    // In the page; the bar's account button says the name too.
    expect(
      within(document.querySelector("main")).getByText("Jamie"),
    ).toBeTruthy();
    expect(screen.getAllByText("Manage").length).toBeGreaterThan(0);
    // The controls are NOT in the row: a row with four controls in it is a
    // form pretending to be a list.
    expect(screen.queryByRole("switch")).toBeNull();
    // Each kind is added on its own tab of the same page.
    expect(screen.getByRole("button", { name: "Follow" })).toBeTruthy();
    expect(screen.getByLabelText("Player tag")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Clans" }));
    expect(await screen.findByLabelText("Clan tag")).toBeTruthy();
  },
);

test(
  "the tracked record holds the controls, and says what stopping costs",
  { timeout: 20000 },
  async () => {
    window.history.pushState(
      {},
      "",
      `/settings/players/${encodeURIComponent("#20JJJ2CCRU")}`,
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
    await screen.findByRole("switch", { name: "On your timeline" });
    expect(screen.getByText(/whether they appear in your digest/)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Email settings" }).getAttribute("href"),
    ).toBe("/settings/emails");
    expect(
      within(document.querySelector("main")).getByText("Jamie"),
    ).toBeTruthy();
    expect(screen.getByText("Recording", { selector: ".chip" })).toBeTruthy();
    // The control asks once before it writes (2026-10-08): a stray click
    // stopped a recording. What it costs is in the question.
    const writes = () =>
      global.fetch.mock.calls.filter(([, init]) => init?.method === "POST");
    fireEvent.click(screen.getByRole("button", { name: "Stop following" }));
    const ask = document.querySelector("dialog.kit-confirm");
    expect(ask.textContent).toContain("Stop following Jamie?");
    expect(ask.textContent).toContain("History stays");
    expect(writes()).toEqual([]);
    fireEvent.click(
      within(ask).getByRole("button", { name: "Cancel", hidden: true }),
    );
    expect(document.querySelector("dialog.kit-confirm")).toBeNull();
    expect(writes()).toEqual([]);
  },
);

// 2026-10-08, the fresh-person journey: a typo'd tag read "Tag not
// found" as plain text beside a green "active" chip and a fresh poll (the
// empty battle log of an unknown tag is admitted), with the fix on
// another page. Now it is an error, with the fix in it, and nothing on
// the page says the recording is healthy.
test(
  "a tag the game did not find is an error with the fix beside it",
  { timeout: 20000 },
  async () => {
    window.history.pushState({}, "", "/settings/players/09CV8UVL");
    const posts = [];
    let claims = [
      {
        player_tag: "#09CV8UVL",
        is_primary: true,
        notify: true,
        name: null,
        relationship: "you",
      },
    ];
    global.fetch = mockFetch({
      "GET /api/me": () => [
        200,
        {
          authenticated: true,
          is_owner: false,
          claims,
          recordings: [
            {
              subject_tag: "#09CV8UVL",
              status: "active",
              freshest_poll: new Date().toISOString(),
              fetches_24h: 2,
            },
          ],
        },
      ],
      "GET /api/me/clans": [200, { clans: [], home_clan: null, slots: {} }],
      "GET /api/me/first-answer?player_tag=%2309CV8UVL": [
        200,
        {
          as_of: new Date().toISOString(),
          player: {
            player_tag: "#09CV8UVL",
            is_primary: true,
            recording_status: "active",
            profile_available: false,
            battlelog_observed_at: new Date().toISOString(),
            last_battle_at: null,
            battles_30d: 0,
            tracked_since: new Date().toISOString(),
            capture_attempts: [
              {
                endpoint: "player",
                last_admitted_at: null,
                last_failed_at: new Date(Date.now() - 60_000).toISOString(),
                last_failed_status: 404,
              },
              {
                endpoint: "player_battlelog",
                last_admitted_at: new Date().toISOString(),
              },
            ],
          },
          connection: { active_connections: 0 },
          clan: null,
        },
      ],
      "POST /api/claims": (init) => {
        const body = JSON.parse(init.body);
        posts.push(body);
        if (body.action === "add")
          claims = [{ ...claims[0], player_tag: body.player_tag }];
        return [200, { ok: true, player_tag: body.player_tag }];
      },
    });
    render(<App />);
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Tag not found")).toBeTruthy();
    expect(alert.textContent).toContain("so nothing is being recorded");
    // Never "active", never a healthy poll, for a tag the game does not know.
    expect(
      screen.getByText("Tag not found", { selector: ".chip" }),
    ).toBeTruthy();
    expect(screen.queryByText("Recording", { selector: ".chip" })).toBeNull();
    expect(screen.getByText(/the game does not know this tag/)).toBeTruthy();
    // The fix is in the callout: the right tag in this one's place.
    const input = within(alert).getByLabelText("Correct tag");
    fireEvent.change(input, { target: { value: "09CV8UVL" } });
    fireEvent.click(
      within(alert).getByRole("button", { name: "Follow this tag instead" }),
    );
    expect(
      await within(alert).findByText("That is the tag the game did not find."),
    ).toBeTruthy();
    expect(posts).toEqual([]);
    fireEvent.change(input, { target: { value: "#0pjcljyp" } });
    fireEvent.click(
      within(alert).getByRole("button", { name: "Follow this tag instead" }),
    );
    // A correction stops the old tag, so it asks first.
    expect(posts).toEqual([]);
    fireEvent.click(
      within(document.querySelector("dialog.kit-confirm")).getByRole("button", {
        name: "Follow this tag instead",
        hidden: true,
      }),
    );
    await waitFor(() => expect(posts).toHaveLength(2));
    // Added first, as the primary, so the typo can be stopped.
    expect(posts).toEqual([
      { player_tag: "#0PJCLJYP", action: "add", make_primary: true },
      { player_tag: "#09CV8UVL", action: "remove" },
    ]);
    await waitFor(() =>
      expect(window.location.pathname).toBe("/settings/players/0PJCLJYP"),
    );
  },
);

test("admin view is admin-gated in the UI", { timeout: 20000 }, async () => {
  window.history.pushState({}, "", "/settings/admin/service");
  global.fetch = mockFetch({
    "GET /api/me": [
      200,
      { authenticated: true, is_owner: false, claims: [], recordings: [] },
    ],
  });
  render(<App />);
  expect(
    await screen.findByText("This page is for Elixir\u2019s staff"),
  ).toBeTruthy();
  // Not even Admin's rail: its pages are named to staff only.
  expect(screen.queryByText("Fleet")).toBeNull();
  expect(screen.queryByText("Beta pulse")).toBeNull();
});

test(
  "signed-out Ladder says what it is and offers an account",
  { timeout: 20000 },
  async () => {
    window.history.pushState({}, "", "/home/you/stats/cards");
    global.fetch = mockFetch({
      "GET /api/me": [200, { authenticated: false }],
    });
    render(<App />);
    expect(await screen.findByText("Your season, read back")).toBeTruthy();
    expect(screen.queryByText("Sign in first")).toBeNull();
    expect(
      screen
        .getByRole("link", { name: "Create your account" })
        .getAttribute("href"),
    ).toBe("/signin?signup&return_to=%2Fhome%2Fyou%2Fstats%2Fcards");
    expect(
      screen
        .getByRole("link", { name: "How Stats works" })
        .getAttribute("href"),
    ).toBe("/docs/ladder");
  },
);

test("the tab title names the page, most specific part first", async () => {
  // A browser tab truncates from the right, so the distinguishing word
  // has to lead or every Elixir tab looks identical.
  const { titleFor } = await import("../src/App.jsx");
  const t = (path) => titleFor(path);
  expect(t("/")).toBe("Elixir");
  expect(t("/settings/admin/collectors")).toBe("Collectors - Admin - Elixir");
  expect(t("/settings/admin/fleet")).toBe("Fleet - Admin - Elixir");
  expect(t("/settings/profile")).toBe("Profile - Settings - Elixir");
  expect(t("/home/player/20JJJ2CCRU")).toBe("Player - Home - Elixir");
  // Every surface wears the site's own name, never "Elixir MCP".
  expect(titleFor("/signin")).toBe("Sign in - Elixir");
  expect(t("/clan")).toBe("Clan - Elixir");
  expect(t("/clan/you")).toBe("You - Clan - Elixir");
  expect(t("/clan/J2RGCRVG")).toBe("Clan - Elixir");
  expect(t("/clan/J2RGCRVG/actions")).toBe("Actions - Clan - Elixir");
  expect(t("/home/you/stats")).toBe("Season - Stats - Elixir");
  expect(t("/home/you/stats/decks")).toBe("Decks - Stats - Elixir");
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
  const res = await api.adminAccounts();
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
  sessionStorage.setItem("clan-delivery:private-draft", "Reviewed words");
  sessionStorage.setItem("elixir-trail", "Retain unrelated state");
  const res = await api.signOut();
  expect(res.ok).toBe(true);
  expect(res.data).toEqual({});
  expect(sessionStorage.getItem("clan-delivery:private-draft")).toBeNull();
  expect(sessionStorage.getItem("elixir-trail")).toBe("Retain unrelated state");
  sessionStorage.removeItem("elixir-trail");
});

test(
  "a partial path is redirected and the ADDRESS BAR follows it",
  { timeout: 20000 },
  async () => {
    // The old REDIRECTS rendered the new page under the old address, so a
    // link credited the old path in the report and the new one looked
    // unvisited. The router replaces the entry, and the query rides along.
    window.history.pushState({}, "", "/settings/agents?x=1");
    global.fetch = mockFetch({
      "GET /api/me": [200, { authenticated: false }],
    });
    render(<App />);
    await waitFor(() =>
      expect(window.location.pathname).toBe("/settings/connections"),
    );
    expect(window.location.search).toBe("?x=1");
    // The folded Console's addresses are not the app's at all since
    // 2026-11-13: the edge answers them with the site's 404 (pinned by
    // apps/site/test/site.test.mjs and e2e/console.spec.ts).
  },
);

test("the route table has no page under /console: the Console folded", async () => {
  const { routeTree } = await import("../src/App.jsx");
  // Outside the console: a battle's public page (2026-10-01), a shared
  // post's (#762), and Ladder,
  // the one section beside the Console (2026-09-28), with one route under
  // its own prefix, and Home at its new address (redesign step 3), with
  // the player page and Follow me links under it (#764).
  const clan = routeTree.children.find((r) => r.options.id === "clan");
  expect(clan.children.every((r) => r.fullPath.startsWith("/clan"))).toBe(true);
  const all = routeTree.children
    .filter((r) => r.path)
    .map((r) => r.path.split("/").filter(Boolean));
  expect(
    all
      .filter((s) => s[0] !== "console")
      .map((s) => s.join("/"))
      .sort(),
  ).toEqual([
    "battle/$ref",
    "h/$id",
    "home",
    "home/find",
    "home/follow/$tags",
    "home/player/$tag",
    "home/you",
    "home/you/stats/{-$page}",
    "settings/$",
    "settings/admin/$",
    "signin",
  ]);
  // Explore folded (2026-11-12): no /console address is a page, and since
  // 2026-11-13 none forwards.
  expect(all.filter((s) => s[0] === "console")).toEqual([]);
});

test(
  "the console prints times on the account's clock, and UTC when none is set",
  { timeout: 20000 },
  async () => {
    // Jamie, 2026-09-23: the console knew the zone and printed UTC anyway.
    const timeline = {
      window: { from: "2026-09-06T02:30:00Z", to: "2026-09-13T02:30:00Z" },
      seen_to: null,
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
        ...NO_PLAYER_YET,
        "GET /api/me": [
          200,
          {
            authenticated: true,
            timezone,
            claims: FOLLOWS_A_FRIEND,
            recordings: [],
          },
        ],
        "GET /api/me/home/feed": [200, timeline],
        "POST /api/me/timeline/seen": [200, { seen_to: timeline.window.to }],
      });

    window.history.pushState({}, "", "/home");
    global.fetch = signedIn("America/Chicago");
    render(<App />);
    // The evening before, in Chicago, and named as Chicago's clock. The
    // feed says the day with the time (design canvas, 2026-11-13).
    expect(
      await screen.findByText("Saturday, September 12, 9:30 pm"),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Saturday, September 12" }),
    ).toBeTruthy();

    cleanup();
    window.history.pushState({}, "", "/home");
    global.fetch = signedIn(null);
    render(<App />);
    expect(
      await screen.findByText("Sunday, September 13, 2:30 am UTC"),
    ).toBeTruthy();
  },
);

test(
  "the timeline lists newest first, and says when a busy week was cut",
  { timeout: 20000 },
  async () => {
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
    window.history.pushState({}, "", "/home");
    global.fetch = mockFetch({
      ...NO_PLAYER_YET,
      "GET /api/me": [
        200,
        { authenticated: true, claims: FOLLOWS_A_FRIEND, recordings: [] },
      ],
      "GET /api/me/home/feed": [
        200,
        {
          seen_to: null,
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
    const texts = [...document.querySelectorAll(".kit-feed__text")].map(
      (tr) => tr.textContent,
    );
    expect(texts).toEqual(["The newer session.", "The older session."]);
    expect(screen.getByText(/the 2 newest are shown, and 7 more/)).toBeTruthy();
  },
);

test(
  "Home's feed shows thirty and More reads the next page of the same week (G1)",
  { timeout: 20000 },
  async () => {
    const item = (at, text) => ({
      id: `tl_${text.length.toString(16).padStart(20, "0")}`,
      at,
      subject_tag: "#2FRND",
      subject_name: "Fixture Friend",
      kind: "personal_record",
      section: "moments",
      text,
      facts: {},
    });
    const asked = [];
    window.history.pushState({}, "", "/home");
    global.fetch = mockFetch({
      ...NO_PLAYER_YET,
      "GET /api/me": [
        200,
        { authenticated: true, claims: FOLLOWS_A_FRIEND, recordings: [] },
      ],
      "GET /api/me/home/feed": () => {
        asked.push("first");
        return [
          200,
          {
            window: {
              from: "2026-09-06T02:30:00.000Z",
              to: "2026-09-13T02:30:00.000Z",
            },
            seen_to: null,
            timeline: [item("2026-09-12T10:00:00Z", "On the first page.")],
            total: 2,
            next: "c1",
            counts: { everyone: 2, you: 0, friends: 2, clan: 0, new: 0 },
            timeline_more: 0,
          },
        ];
      },
      "GET /api/me/home/feed?cursor=c1": () => {
        asked.push("c1");
        return [
          200,
          {
            window: {
              from: "2026-09-06T02:30:00.000Z",
              to: "2026-09-13T02:30:00.000Z",
            },
            seen_to: null,
            timeline: [item("2026-09-11T10:00:00Z", "Read by More, older.")],
            total: 2,
            next: null,
            timeline_more: 0,
          },
        ];
      },
    });
    render(<App />);
    await screen.findByText("On the first page.");
    expect(screen.getByText("1 of 2 shown")).toBeTruthy();
    expect(screen.queryByText("Read by More, older.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    await screen.findByText("Read by More, older.");
    expect(asked).toEqual(["first", "c1"]);
    expect(screen.queryByRole("button", { name: "More" })).toBeNull();
    const texts = [...document.querySelectorAll(".kit-feed__text")].map(
      (p) => p.textContent,
    );
    expect(texts).toEqual(["On the first page.", "Read by More, older."]);
  },
);

test(
  "a More that fails keeps the pages read and says so beside More (Codex on #800)",
  { timeout: 20000 },
  async () => {
    const item = (id, at, text) => ({
      id,
      at,
      subject_tag: "#2FRND",
      subject_name: "Fixture Friend",
      kind: "personal_record",
      section: "moments",
      text,
      facts: {},
    });
    let more = 0;
    window.history.pushState({}, "", "/home");
    global.fetch = mockFetch({
      ...NO_PLAYER_YET,
      "GET /api/me": [
        200,
        { authenticated: true, claims: FOLLOWS_A_FRIEND, recordings: [] },
      ],
      "GET /api/me/home/feed": [
        200,
        {
          seen_to: null,
          timeline: [
            item("tl_00000000000000000001", "2026-09-12T10:00:00Z", "Kept."),
          ],
          total: 2,
          next: "c1",
          timeline_more: 0,
        },
      ],
      "GET /api/me/home/feed?cursor=c1": () => {
        more += 1;
        return more === 1
          ? [504, { error: "timeout", message: "The read took too long." }]
          : [
              200,
              {
                seen_to: null,
                timeline: [
                  item(
                    "tl_00000000000000000002",
                    "2026-09-11T10:00:00Z",
                    "Read on the second try.",
                  ),
                ],
                total: 2,
                next: null,
                timeline_more: 0,
              },
            ];
      },
    });
    render(<App />);
    await screen.findByText("Kept.");
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    await screen.findByText("The next items didn’t load. Try again.");
    expect(screen.getByText("Kept.")).toBeTruthy();
    expect(screen.queryByText("Your feed didn’t load")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    await screen.findByText("Read on the second try.");
    expect(more).toBe(2);
  },
);

for (const [label, since, want] of [
  ["the place it counted from", "2026-09-12T00:00:00.000Z", "7"],
  ["an earlier place, so the loaded items", "2026-09-10T00:00:00.000Z", "1"],
]) {
  test(`the New chip counts from ${label} (Codex on #800)`, async () => {
    window.history.pushState({}, "", "/home");
    global.fetch = mockFetch({
      ...NO_PLAYER_YET,
      "GET /api/me": [
        200,
        { authenticated: true, claims: FOLLOWS_A_FRIEND, recordings: [] },
      ],
      "GET /api/me/home/feed": [
        200,
        {
          window: {
            from: "2026-09-06T02:30:00.000Z",
            to: "2026-09-13T02:30:00.000Z",
          },
          seen_to: "2026-09-12T00:00:00.000Z",
          timeline: [
            {
              id: "tl_00000000000000000003",
              at: "2026-09-12T10:00:00Z",
              observed_at: "2026-09-12T10:05:00Z",
              subject_tag: "#2FRND",
              subject_name: "Fixture Friend",
              kind: "personal_record",
              section: "moments",
              text: "Learned after the place.",
              facts: {},
            },
          ],
          total: 40,
          next: "c1",
          counts: {
            everyone: 40,
            you: 0,
            friends: 40,
            clan: 0,
            new: 7,
            new_since: since,
          },
          timeline_more: 0,
        },
      ],
      "POST /api/me/timeline/seen": [
        200,
        { seen_to: "2026-09-13T02:30:00.000Z" },
      ],
    });
    render(<App />);
    await screen.findByText("Learned after the place.");
    // New is one toggle in the Show row, not a second row of chips.
    expect(screen.queryByRole("group", { name: "State" })).toBeNull();
    const chip = screen.getByRole("button", {
      name: /^New since your last visit/,
    });
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    expect(chip.textContent.replace("New", "").trim()).toBe(want);
  });
}

test(
  "a feed that did not load says so and Try again reads it once more, never on its own (G1)",
  { timeout: 20000 },
  async () => {
    let calls = 0;
    window.history.pushState({}, "", "/home");
    global.fetch = mockFetch({
      ...NO_PLAYER_YET,
      "GET /api/me": [
        200,
        { authenticated: true, claims: FOLLOWS_A_FRIEND, recordings: [] },
      ],
      "GET /api/me/home/feed": () => {
        calls += 1;
        return calls === 1
          ? [504, { error: "timeout", message: "The read took too long." }]
          : [
              200,
              {
                seen_to: null,
                timeline: [
                  {
                    id: "tl_00000000000000000001",
                    at: "2026-09-12T10:00:00Z",
                    subject_tag: "#2FRND",
                    subject_name: "Fixture Friend",
                    kind: "personal_record",
                    section: "moments",
                    text: "Read the second time.",
                    facts: {},
                  },
                ],
                total: 1,
                next: null,
                timeline_more: 0,
              },
            ];
      },
    });
    render(<App />);
    await screen.findByText("Your feed didn’t load");
    expect(calls).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("Read the second time.");
    expect(calls).toBe(2);
  },
);

test(
  "the timeline keeps the console's own place: it marks what it showed and rules off what is new",
  { timeout: 20000 },
  async () => {
    // Jamie, 2026-10-20: "timeline should be independent of what agents
    // have seen via MCP." The page moves the console's place to the
    // window it showed, the rail's dot follows, and the rule sits where
    // the place stood when the page opened.
    const item = (text, at, observed_at) => ({
      at,
      observed_at,
      subject_tag: "#20JJJ2CCRU",
      subject_name: "Jamie",
      kind: "battle_session",
      section: "battles",
      text,
      facts: {},
    });
    const TO = "2026-09-13T02:30:00.000Z";
    const posts = [];
    let pending = 1;
    global.fetch = mockFetch({
      ...NO_PLAYER_YET,
      "GET /api/me": () => [
        200,
        {
          authenticated: true,
          claims: FOLLOWS_A_FRIEND,
          recordings: [],
          signals: { tracking: 1, timeline_pending: pending },
        },
      ],
      "GET /api/me/home/feed": [
        200,
        {
          window: { from: "2026-09-06T02:30:00.000Z", to: TO },
          seen_to: "2026-09-12T12:00:00.000Z",
          timeline: [
            item(
              "Learned since.",
              "2026-09-13T01:00:00Z",
              "2026-09-13T01:05:00Z",
            ),
            item(
              "Seen before.",
              "2026-09-12T10:00:00Z",
              "2026-09-12T10:05:00Z",
            ),
            item(
              "Older still.",
              "2026-09-11T10:00:00Z",
              "2026-09-11T10:05:00Z",
            ),
          ],
          timeline_more: 0,
          entries: [],
          quiet: [],
        },
      ],
      "POST /api/me/timeline/seen": (init) => {
        posts.push(JSON.parse(init.body));
        pending = 0;
        return [200, { seen_to: TO }];
      },
    });
    window.history.pushState({}, "", "/home");
    render(<App />);
    await screen.findByText("Learned since.");
    await waitFor(() => expect(posts).toEqual([{ to: TO }]));
    // The write refetches `me`, which carries the unread count.
    await waitFor(() =>
      expect(
        global.fetch.mock.calls.filter(
          ([p, init]) => p === "/api/me" && (init?.method ?? "GET") === "GET",
        ).length,
      ).toBeGreaterThanOrEqual(2),
    );
    // One rule, under the last new row.
    expect(document.querySelectorAll(".kit-newmark").length).toBe(1);
    const page = document.querySelector(".kit-feed").textContent;
    expect(page.indexOf("Learned since.")).toBeLessThan(
      page.indexOf("Seen before."),
    );
    // The place this visit opened from holds: the rule stays put after
    // the write moved it.
    expect(document.querySelectorAll(".kit-newmark").length).toBe(1);
    expect(document.body.textContent).not.toContain("Unread by connections");
  },
);

describe("an agent's pages in Settings", () => {
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
    seen_to: null,
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

  const PRINCIPALS = {
    agents: [
      {
        account_id: 7,
        public_id: "abcd1234",
        name: "poap-bot",
        status: "approved",
        clans: [{ clan_tag: "#J2RGCRVG", name: "POAP KINGS" }],
        tokens: [],
      },
    ],
  };

  test(
    "the switcher is gone: an agent is a page with five tabs, and each reads only its own account",
    { timeout: 20000 },
    async () => {
      const fetch = mockFetch({
        "GET /api/me": [200, PERSON],
        "GET /api/me/principals": [200, PRINCIPALS],
        "GET /api/me/timeline": [200, timeline("Yours.")],
        "GET /api/agent/abcd1234": [200, AGENT],
        "GET /api/agent/abcd1234/timeline": [200, timeline("The agent's.")],
      });
      global.fetch = fetch;
      window.history.pushState({}, "", "/settings/agents/abcd1234/overview");
      render(<App />);
      const tabs = await screen.findByRole("tablist", { name: "This agent" });
      expect(
        within(tabs)
          .getAllByRole("tab")
          .map((t) => t.textContent),
      ).toEqual([
        "Overview",
        "What it reads",
        "Usage",
        "Connections",
        "Settings",
      ]);
      // Its Timeline reads the agent's route and never yours.
      fireEvent.click(screen.getByRole("link", { name: "Open its timeline" }));
      await screen.findByText("The agent's.");
      const paths = fetch.mock.calls.map(([p]) => p);
      expect(paths).toContain("/api/agent/abcd1234/timeline");
      expect(
        paths.filter((p) => p === "/api/me/timeline").length,
        "yours is not read on the agent's pages",
      ).toBe(0);
    },
  );

  test(
    "its Tracking: the clan it acts for, a rival it watches, and re-pointing it",
    { timeout: 20000 },
    async () => {
      const posts = [];
      global.fetch = mockFetch({
        "GET /api/me": [200, PERSON],
        "GET /api/me/principals": [200, PRINCIPALS],
        "GET /api/agent/abcd1234": [
          200,
          {
            ...AGENT,
            claims: [
              {
                player_tag: "#022YGRRL",
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
                clan_tag: "#0GC0GG2P",
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
      window.history.pushState({}, "", "/settings/agents/abcd1234/reads");
      render(<App />);
      await screen.findByText("Rivals");
      expect(screen.getByText("Rival Star")).toBeTruthy();
      // The clan it acts for offers no removal; the rival can take its place.
      expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(2);
      fireEvent.click(
        screen.getByRole("button", { name: "Make it the clan it acts for" }),
      );
      await waitFor(() =>
        expect(posts).toEqual([{ clan_tag: "#0GC0GG2P", action: "primary" }]),
      );
    },
  );

  test(
    "an agent that is not yours says so, and shows nothing of anyone's",
    { timeout: 20000 },
    async () => {
      global.fetch = mockFetch({
        "GET /api/me": [200, PERSON],
        "GET /api/me/principals": [200, PRINCIPALS],
        "GET /api/agent/zzzz9999": [404, { error: "not_found" }],
      });
      window.history.pushState({}, "", "/settings/agents/zzzz9999/timeline");
      render(<App />);
      expect(
        await screen.findByText(/No agent here on your account/),
      ).toBeTruthy();
    },
  );
});

test(
  "a session that ends under Clan's read turns into the app's sign-in page",
  { timeout: 20000 },
  async () => {
    // The app read its session first and found it signed in; Clan's own
    // read then answers 401. The app reads its session again, and its
    // sign-in page follows (Clan has no signed-out page of its own).
    let meReads = 0;
    global.fetch = vi.fn(async (path, init = {}) => {
      const key = `${init.method ?? "GET"} ${String(path).split("?")[0]}`;
      let status = 404;
      let body = { error: "not_found" };
      if (key === "GET /api/me") {
        meReads += 1;
        status = 200;
        body =
          meReads === 1
            ? {
                authenticated: true,
                email: "fixture@example.test",
                features: {},
                claims: [],
                recordings: [],
                signals: {},
              }
            : { authenticated: false };
      } else if (key === "GET /api/clan/me") {
        status = 401;
        body = { error: "signed_out" };
      }
      return {
        ok: status < 400,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
      };
    });
    window.history.pushState({}, "", "/clan/0QC8RCGY/feed");
    render(<App />);
    await screen.findByText("Sign in first");
    expect(meReads).toBeGreaterThanOrEqual(2);
    expect(window.location.pathname).toBe("/clan/0QC8RCGY/feed");
  },
);
