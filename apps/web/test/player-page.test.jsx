/**
 * The player page and Follow me links (slice 6, #764): every name opens one
 * page, the page shows game names and tags only, Follow asks first and says
 * what it costs, and a Follow me link names players and nothing else.
 * Invented players only.
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
import { followPlanLine } from "../src/home/follow.jsx";
import {
  followMeHref,
  isPlayerPath,
  playerHref,
  tagsFromFollowPath,
} from "../src/lib/player.js";

configure({ asyncUtilTimeout: 5000 });

const ME = {
  authenticated: true,
  is_admin: false,
  is_owner: false,
  role: "member",
  timezone: "America/Chicago",
  claims: [
    {
      player_tag: "#PYLQ88",
      name: "Birch Lantern",
      nickname: "Private Owl",
      is_primary: true,
      relationship: "primary",
      status: "verified",
    },
  ],
  recordings: [],
};

const PAGE = {
  player: {
    tag: "#QQ8822",
    name: "Copper Fern",
    clan_tag: "#GRC2",
    clan_name: "Grove",
    trophies: 7400,
    recorded: true,
  },
  you: { own: false, following: false, relationship: null, clanmate: null },
  badges: { verified_player: true, discord: true },
  follows: { count: 1, players: [{ tag: "#UUU2", name: "Umber" }] },
  followers: {
    count: 3,
    players: [{ tag: "#PYLQ88", name: "Birch Lantern" }],
    unnamed: 2,
  },
  window_days: 30,
  timeline: [
    {
      id: "t1",
      kind: "battle_streak",
      at: "2026-11-10T14:00:00.000Z",
      text: "Copper Fern won five in a row",
    },
  ],
  timeline_more: 0,
  moments: [],
  highlights: [],
};

const reply = (body, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

let page;
let plan;
let posted;
let pageCheers;
beforeEach(() => {
  cleanup();
  page = PAGE;
  pageCheers = {};
  posted = [];
  plan = {
    clan_tag: null,
    players: [
      {
        player_tag: "#QQ8822",
        name: "Copper Fern",
        following: false,
        free: true,
        reason: "followed_by_others",
      },
      {
        player_tag: "#UUU2",
        name: "Umber",
        following: false,
        free: false,
        reason: null,
      },
    ],
    yours: [],
    to_follow: 2,
    free: 1,
    slots: 1,
    following: 0,
    used: 3,
    limit: 50,
    fits: true,
  };
  vi.spyOn(console, "error").mockImplementation(() => {});
  global.fetch = vi.fn(async (path, init) => {
    const p = String(path);
    if (p === "/api/me") return reply(ME);
    if (p.startsWith("/api/player?")) return reply(page);
    if (p.startsWith("/api/player/evidence?")) {
      posted.push([p, null]);
      return reply({
        kind: "session",
        observed_at: "2026-11-10T15:00:00.000Z",
        observed_at_basis: "recorded_capture",
        count: 2,
        from: "2026-11-10T14:00:00.000Z",
        through: "2026-11-10T14:40:00.000Z",
        open: false,
        completeness: "recorded_sitting",
        battles: [],
      });
    }
    if (p.startsWith("/api/me/cheers?")) return reply(pageCheers);
    if (p === "/api/me/cheers" && init?.method === "PUT") {
      const body = JSON.parse(init.body);
      posted.push([p, body]);
      return reply({
        item_id: body.item_id,
        cheers: { on_fire: 2 },
        my_cheer: body.cheer,
      });
    }
    if (p.startsWith("/api/me/follow-cost"))
      return reply({
        player_tag: "#QQ8822",
        following: false,
        free: false,
        reason: null,
        used: 3,
        limit: 50,
      });
    if (p.startsWith("/api/me/follow-plan")) return reply(plan);
    if (p === "/api/explore") {
      const { tool, args } = JSON.parse(init.body);
      posted.push([p, { tool, args }]);
      if (tool === "players_summary")
        return reply({
          body: {
            player_tag: "#QQ8822",
            name: "Copper Fern",
            nickname: "Hidden Moss",
            last_30_days: {
              battles: 42,
              wins: 25,
              losses: 16,
              draws: 1,
              net_trophies: 118,
              capture: { captured_battles: 42, expected_battles: 44 },
            },
            top_deck: { battles: 20, archetype: { label: "Hog Rider cycle" } },
          },
        });
      if (tool === "players_profile")
        return reply({
          body: {
            player_tag: "#QQ8822",
            attributes: { best_trophies: 7600 },
            snapshot: {
              date: "2026-11-09",
              trophies: 7400,
              lifetime: {
                battle_count: 3100,
                wins: 1700,
                three_crown_wins: 640,
              },
            },
          },
        });
    }
    if (p === "/api/me/follow-all" || p === "/api/claims") {
      posted.push([p, JSON.parse(init.body)]);
      return reply({ ok: true, followed: [] });
    }
    return reply({});
  });
});
afterEach(() => vi.restoreAllMocks());

test("one address per player, and a Follow me link carries tags only", () => {
  expect(playerHref("#QQ8822")).toBe("/home/player/QQ8822");
  expect(followMeHref(["#QQ8822", "#UUU2"])).toBe("/home/follow/QQ8822,UUU2");
  expect(tagsFromFollowPath("QQ8822,uuu2,QQ8822")).toEqual([
    "#QQ8822",
    "#UUU2",
  ]);
  expect(tagsFromFollowPath("QQ8822,<b>")).toBeNull();
  expect(tagsFromFollowPath("")).toBeNull();
  expect(isPlayerPath("/home/player/QQ8822")).toBe(true);
  expect(isPlayerPath("/home/follow/QQ8822,UUU2")).toBe(true);
  expect(isPlayerPath("/home/friends")).toBe(false);
});

test("a plan in words: free, slots, and a refusal that says why", () => {
  expect(followPlanLine(plan)).toBe(
    "2 players to follow · 1 free · 1 uses a slot · 3 of 50 slots used now",
  );
  expect(followPlanLine({ ...plan, slots: 2, used: 49, fits: false })).toMatch(
    /Only 1 of your 50 player slots are left, so nobody would be followed\./,
  );
  expect(followPlanLine({ ...plan, to_follow: 0, following: 2 })).toBe(
    "You already follow every one of them.",
  );
});

test(
  "the page: name, badges, counts, follows and followers by game name, no nickname",
  { timeout: 20000 },
  async () => {
    window.history.pushState({}, "", "/home/player/QQ8822");
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Copper Fern" });
    expect(screen.getByText("Verified player")).toBeTruthy();
    expect(screen.getByText("Verified in Discord")).toBeTruthy();
    expect(screen.getByText(/Following 1 · Followers 3/)).toBeTruthy();
    expect(screen.getByText("Copper Fern won five in a row")).toBeTruthy();
    // Explore folded into the page (2026-11-12): no link out to it.
    expect(screen.queryByRole("link", { name: "Full record" })).toBeNull();
    expect(document.querySelector('a[href^="/console"]')).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /Follows/ }));
    const follower = await screen.findByRole("link", {
      name: /Birch Lantern/,
    });
    expect(follower.getAttribute("href")).toBe("/home/player/PYLQ88");
    expect(
      screen.getByText(/2 more accounts have no verified player/),
    ).toBeTruthy();
    // The top bar names the reader as they named themselves; the page never.
    expect(document.querySelector("main").textContent).not.toContain(
      "Private Owl",
    );
  },
);

test(
  "a sitting draws as Home draws it: sparkline, numbers, and its games in place",
  { timeout: 20000 },
  async () => {
    page = {
      ...PAGE,
      timeline: [
        {
          id: "s1",
          kind: "battle_session",
          at: "2026-11-10T14:00:00.000Z",
          text: "Copper Fern played two battles",
          facts: {
            battles: 2,
            won: 1,
            lost: 1,
            trophy_net: 4,
            by_mode: { ladder: 2 },
            decks: [{ label: "Hog Rider cycle" }],
            ended_at: "2026-11-10T14:40:00.000Z",
          },
          spark: [
            { r: "w", m: 3 },
            { r: "l", m: 1 },
          ],
          evidence: { kind: "session", version: "ev_1", count: 2 },
        },
      ],
    };
    window.history.pushState({}, "", "/home/player/QQ8822");
    render(<App />);
    await screen.findByText("Copper Fern played two battles");
    // The sitting's figures, as the canvas's .sfacts: each label beside its
    // number.
    const figures = Object.fromEntries(
      [...document.querySelectorAll(".kit-sfacts dt")].map((dt) => [
        dt.textContent,
        dt.nextElementSibling?.textContent,
      ]),
    );
    expect(figures).toEqual({
      Battles: "2",
      Won: "1",
      Lost: "1",
      Trophies: "+4",
    });
    expect(
      screen.getByRole("img", { name: /won|lost|win|loss/i }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "View games" }));
    await screen.findByText(/2 recorded games/);
    expect(posted[0][0]).toMatch(
      /^\/api\/player\/evidence\?tag=%23QQ8822&evidence_item_id=s1&expected_evidence_version=ev_1&evidence_offset=0$/,
    );
    expect(
      screen
        .getByRole("button", { name: "Close games" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
  },
);

test(
  "Follow asks first and says what it costs",
  { timeout: 20000 },
  async () => {
    window.history.pushState({}, "", "/home/player/QQ8822");
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Copper Fern" });
    fireEvent.click(screen.getByRole("button", { name: "Follow" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Follow Copper Fern?",
      hidden: true,
    });
    await within(dialog).findByText("Uses 1 of your 50 player slots · 3 used");
    expect(posted).toEqual([]);
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Follow", hidden: true }),
    );
    await waitFor(() =>
      expect(posted).toEqual([
        ["/api/claims", { player_tag: "#QQ8822", relationship: "friend" }],
      ]),
    );
  },
);

test(
  "a player no account verified has no follows to show",
  { timeout: 20000 },
  async () => {
    page = {
      ...PAGE,
      badges: { verified_player: false, discord: false },
      follows: null,
      followers: null,
    };
    window.history.pushState({}, "", "/home/player/QQ8822");
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Copper Fern" });
    expect(screen.queryByText("Verified player")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /Follows/ }));
    expect(
      await screen.findByText(/No account has verified this player/),
    ).toBeTruthy();
  },
);

test(
  "a Follow me link signed in: each player, its cost, and one Follow for all",
  { timeout: 20000 },
  async () => {
    window.history.pushState({}, "", "/home/follow/QQ8822,UUU2");
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Follow in Elixir" });
    expect(
      screen.getByRole("link", { name: "Copper Fern" }).getAttribute("href"),
    ).toBe("/home/player/QQ8822");
    expect(
      screen.getByText("Uses 1 of your 50 player slots · 3 used"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Follow all 2" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Follow all 2 players?",
      hidden: true,
    });
    expect(
      within(dialog).getByText(
        "2 players to follow · 1 free · 1 uses a slot · 3 of 50 slots used now",
      ),
    ).toBeTruthy();
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "Follow everyone",
        hidden: true,
      }),
    );
    await waitFor(() =>
      expect(posted).toEqual([
        ["/api/me/follow-all", { player_tags: ["#QQ8822", "#UUU2"] }],
      ]),
    );
  },
);

test(
  "cheers on the page: only on an item in your own feed, sent with its follows",
  { timeout: 20000 },
  async () => {
    page = {
      ...PAGE,
      timeline: [
        ...PAGE.timeline,
        {
          id: "t2",
          kind: "pol_league_up",
          at: "2026-10-20T14:00:00.000Z",
          text: "Copper Fern reached Path of Legends",
        },
      ],
    };
    pageCheers = {
      items: [{ id: "t1", cheers: { on_fire: 1 }, my_cheer: null }],
      subjects: ["#GRC2"],
    };
    window.history.pushState({}, "", "/home/player/QQ8822");
    render(<App />);
    await screen.findByText("Copper Fern reached Path of Legends");
    const cheer = await screen.findByRole("button", { name: "Cheer" });
    // One item in your feed, one Cheer: the older item has none, and no
    // counts.
    expect(screen.getAllByRole("button", { name: "Cheer" })).toHaveLength(1);
    expect(screen.getByText("1 person")).toBeTruthy();
    fireEvent.click(cheer);
    fireEvent.click(
      within(screen.getByRole("group", { name: "Choose a cheer" })).getByRole(
        "button",
        { name: /Royal/ },
      ),
    );
    await waitFor(() =>
      expect(posted).toContainEqual([
        "/api/me/cheers",
        { item_id: "t1", cheer: "royal", subjects: ["#GRC2"] },
      ]),
    );
  },
);

test(
  "no cheers on the page when nothing on it is in your feed",
  { timeout: 20000 },
  async () => {
    pageCheers = { items: [], subjects: [] };
    window.history.pushState({}, "", "/home/player/QQ8822");
    render(<App />);
    await screen.findByText("Copper Fern won five in a row");
    expect(screen.queryByRole("button", { name: "Cheer" })).toBeNull();
  },
);

test(
  "the Record tab: the last 30 days and the profile, read only when opened, no nickname",
  { timeout: 20000 },
  async () => {
    window.history.pushState({}, "", "/home/player/QQ8822");
    render(<App />);
    await screen.findByText("Copper Fern won five in a row");
    expect(posted.some(([p]) => p === "/api/explore")).toBe(false);
    fireEvent.click(screen.getByRole("tab", { name: /Record/ }));
    await screen.findByText("Hog Rider cycle");
    expect(screen.getByText("25 won, 16 lost, 1 drawn")).toBeTruthy();
    expect(screen.getByText("+118")).toBeTruthy();
    expect(screen.getByText("7,600")).toBeTruthy();
    expect(screen.getByText("3,100")).toBeTruthy();
    expect(screen.getByText(/42 of about 44 battles/)).toBeTruthy();
    expect(
      posted
        .filter(([p]) => p === "/api/explore")
        .map(([, b]) => b.tool)
        .sort(),
    ).toEqual(["players_profile", "players_summary"]);
    expect(posted.find(([p]) => p === "/api/explore")[1].args.player_tag).toBe(
      "#QQ8822",
    );
    expect(document.body.textContent).not.toContain("Hidden Moss");
  },
);

test("?tab=record opens the Record tab", { timeout: 20000 }, async () => {
  window.history.pushState({}, "", "/home/player/QQ8822?tab=record");
  render(<App />);
  await screen.findByText("Hog Rider cycle");
  expect(
    screen.getByRole("tab", { name: /Record/ }).getAttribute("aria-selected"),
  ).toBe("true");
});

test(
  "the Record tab: not recorded is an absent half, a failed read is an error with a retry",
  { timeout: 20000 },
  async () => {
    const real = global.fetch;
    let fail = "query_timeout";
    global.fetch = vi.fn(async (path, init) => {
      if (String(path) === "/api/explore") {
        const { tool } = JSON.parse(init.body);
        if (tool === "players_summary")
          return reply({ is_error: true, body: { error: { code: fail } } });
      }
      return real(path, init);
    });
    window.history.pushState({}, "", "/home/player/QQ8822?tab=record");
    render(<App />);
    await screen.findByText("This record could not be read just now");
    expect(screen.queryByText(/No battles recorded/)).toBeNull();
    fail = "not_recorded";
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    await screen.findByText("No battles recorded in the last 30 days.");
    expect(screen.getByText("7,600")).toBeTruthy();
  },
);
