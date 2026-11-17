/**
 * You (2026-11-15, Jamie: "when you tap You it should go to your account,
 * not your primary player"): You is your own account page, with Your
 * stats one tap away; Stats keeps a tab back to Profile. With no player yet,
 * You says Add your player. Invented players only.
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
// The route chunks compile while this file loads, not inside a wait.
import "./warm-routes.js";

configure({ asyncUtilTimeout: 5000 });

const VERIFIED = {
  player_tag: "#0GVJ9V",
  name: "Birch Lantern",
  nickname: "Private Owl",
  is_primary: true,
  relationship: "primary",
  status: "verified",
};
const ALT = {
  player_tag: "#00L0",
  name: "Umber",
  is_primary: false,
  relationship: "alt",
  status: "pending",
};
const FRIEND = {
  player_tag: "#0VJ2QV",
  name: "Copper Fern",
  is_primary: false,
  relationship: "friend",
};
const ME = {
  authenticated: true,
  is_admin: false,
  role: "member",
  timezone: "America/Chicago",
  claims: [VERIFIED, ALT, FRIEND],
  recordings: [],
  signals: {},
};
const PAGE = {
  player: {
    tag: "#0GVJ9V",
    name: "Birch Lantern",
    clan_tag: null,
    clan_name: null,
    trophies: 7400,
    recorded: true,
  },
  you: { own: true, following: false, relationship: "primary" },
  badges: { verified_player: true, discord: false },
  follows: { count: 0, players: [] },
  followers: { count: 0, players: [], unnamed: 0 },
  window_days: 30,
  timeline: [
    {
      id: "t1",
      kind: "battle_streak",
      at: "2026-11-10T14:00:00.000Z",
      text: "Birch Lantern won five in a row",
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

let me;
beforeEach(() => {
  cleanup();
  me = ME;
  vi.spyOn(console, "error").mockImplementation(() => {});
  global.fetch = vi.fn(async (path) => {
    const p = String(path);
    if (p === "/api/me") return reply(me);
    if (p.startsWith("/api/player?")) return reply(PAGE);
    return reply({});
  });
});
// Unmount after each test, the last one too: a page left mounted when the
// file's window is torn down gets the query cache's batched notify after
// it, and React throws "window is not defined" (seen under load, 11-12).
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ACCOUNT_PAGE = {
  account: {
    id: "abcdefghjkmn",
    handle: "birch",
    name: "Birch Lantern",
    player: { tag: "#0GVJ9V", name: "Birch Lantern", state: "verified" },
    state: "verified",
    players: [
      {
        tag: "#0GVJ9V",
        name: "Birch Lantern",
        relationship: "primary",
        state: "verified",
      },
      { tag: "#00L0", name: "Umber", relationship: "alt", state: "claimed" },
    ],
    badges: { verified_player: true, discord: false },
    place: null,
    follows: { count: 0, players: [] },
    followers: 0,
    following_accounts: 0,
  },
  you: { self: true, following: false, to_follow: [], plan: null },
  passport: null,
  window_days: 30,
  timeline: [
    {
      id: "t1",
      kind: "battle_streak",
      at: "2026-11-10T14:00:00.000Z",
      text: "Birch Lantern won five in a row",
    },
  ],
  timeline_more: 0,
};

test(
  "You: your account page, @handle first, your players each to its page, Your stats one tap away",
  { timeout: 20000 },
  async () => {
    me = { ...ME, page_id: "abcdefghjkmn", handle: "birch" };
    const asked = [];
    global.fetch = vi.fn(async (path) => {
      const p = String(path);
      asked.push(p);
      if (p === "/api/me") return reply(me);
      if (p === "/api/accounts/abcdefghjkmn") return reply(ACCOUNT_PAGE);
      return reply({});
    });
    window.history.pushState({}, "", "/home/you");
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "@birch" });
    expect(screen.getByText("Birch Lantern won five in a row")).toBeTruthy();
    const players = screen.getByRole("heading", {
      name: "Players",
    }).parentElement;
    expect(players.textContent).toContain("Umber");
    expect(players.textContent).not.toContain("Copper Fern");
    expect(
      screen.getByRole("link", { name: "Your stats" }).getAttribute("href"),
    ).toBe("/home/you/stats");
    // Your own page offers no Follow, and You never reads a player page.
    expect(screen.queryByRole("button", { name: "Follow" })).toBeNull();
    expect(asked.some((p) => p.startsWith("/api/player?"))).toBe(false);
  },
);

test(
  "no player yet: You says Add your player",
  { timeout: 20000 },
  async () => {
    me = { ...ME, claims: [], page_id: "abcdefghjkmn" };
    global.fetch = vi.fn(async (path) => {
      const p = String(path);
      if (p === "/api/me") return reply(me);
      if (p === "/api/accounts/abcdefghjkmn")
        return reply({
          ...ACCOUNT_PAGE,
          account: {
            ...ACCOUNT_PAGE.account,
            handle: null,
            player: null,
            state: null,
            players: [],
          },
          timeline: [],
        });
      return reply({});
    });
    window.history.pushState({}, "", "/home/you");
    render(<App />);
    const add = await screen.findByRole("link", { name: "Add your player" });
    expect(add.getAttribute("href")).toBe("/settings/players#add-player-tag");
    expect(screen.queryByRole("link", { name: "Your stats" })).toBeNull();
  },
);

test("Stats keeps a tab back to You", { timeout: 20000 }, async () => {
  window.history.pushState({}, "", "/home/you/stats");
  render(<App />);
  const tabs = await screen.findByRole("tablist", { name: "Profile" });
  const you = Array.from(tabs.querySelectorAll("a")).find(
    (a) => a.textContent === "Profile",
  );
  expect(you?.getAttribute("href")).toBe("/home/you");
});

test(
  "a player you follow: their page opens Their stats, which read through Stats' own door, with no You tabs",
  { timeout: 20000 },
  async () => {
    // Jamie, 2026-11-12: "Stats opens for the players you follow".
    const posted = [];
    global.fetch = vi.fn(async (path, init) => {
      const p = String(path);
      if (p === "/api/me") return reply(me);
      if (p.startsWith("/api/player?"))
        return reply({
          ...PAGE,
          player: {
            ...PAGE.player,
            tag: FRIEND.player_tag,
            name: "Copper Fern",
          },
          you: { own: false, following: true, relationship: "friend" },
        });
      if (p === "/api/me/stats" || p === "/api/me/tool") {
        posted.push([p, JSON.parse(init.body)]);
        return reply({ is_error: false, body: {} });
      }
      return reply({});
    });
    window.history.pushState({}, "", "/home/player/0vj2qv");
    render(<App />);
    const door = await screen.findByRole("link", { name: "Their stats" });
    expect(door.getAttribute("href")).toBe("/home/you/stats?player=0VJ2QV");
    expect(screen.queryByRole("link", { name: "Your stats" })).toBeNull();

    cleanup();
    window.history.pushState({}, "", "/home/you/stats?player=0VJ2QV");
    render(<App />);
    const back = await screen.findByRole("navigation", { name: "Whose stats" });
    expect(back.textContent).toContain("Copper Fern");
    expect(screen.queryByRole("tablist", { name: "Profile" })).toBeNull();
    await waitFor(() => expect(posted.length).toBeGreaterThan(0));
    // Every read names the followed player, and none rides the open bridge.
    expect(posted.every(([p]) => p === "/api/me/stats")).toBe(true);
    expect(
      posted.every(([, b]) => b.args.player_tag === FRIEND.player_tag),
    ).toBe(true);
  },
);

test(
  "a watched player's tag in ?player never opens their Stats",
  { timeout: 20000 },
  async () => {
    me = {
      ...ME,
      claims: [
        ...ME.claims,
        {
          player_tag: "#WW2299",
          name: "Slate Heron",
          relationship: "watching",
        },
      ],
    };
    window.history.pushState({}, "", "/home/you/stats?player=WW2299");
    render(<App />);
    await screen.findByRole("tablist", { name: "Profile" });
    expect(
      screen.queryByRole("navigation", { name: "Whose stats" }),
    ).toBeNull();
  },
);
