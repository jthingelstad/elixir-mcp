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
beforeEach(() => {
  cleanup();
  page = PAGE;
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
    expect(
      screen.getByRole("link", { name: "Full record" }).getAttribute("href"),
    ).toBe("/console/explore/player/QQ8822");
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
