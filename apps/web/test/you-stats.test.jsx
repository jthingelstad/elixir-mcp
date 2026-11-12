/**
 * You with Stats (2026-11-12, Jamie's go: "You with Stats"): You is your
 * primary verified player's page with a Stats tab, Stats is Ladder
 * unchanged, every old Ladder address lands on Stats, and with no verified
 * player You says how to verify one. Invented players only.
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
import { youPlayer } from "../src/home/You.jsx";

configure({ asyncUtilTimeout: 5000 });

const VERIFIED = {
  player_tag: "#PYLQ88",
  name: "Birch Lantern",
  nickname: "Private Owl",
  is_primary: true,
  relationship: "primary",
  status: "verified",
};
const ALT = {
  player_tag: "#UUU2",
  name: "Umber",
  is_primary: false,
  relationship: "alt",
  status: "pending",
};
const FRIEND = {
  player_tag: "#QQ8822",
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
    tag: "#PYLQ88",
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
afterEach(() => vi.restoreAllMocks());

test("You is the primary player only when it is verified", () => {
  expect(youPlayer(ME.claims)).toBe(VERIFIED);
  expect(youPlayer([{ ...VERIFIED, status: "pending" }, ALT])).toBeNull();
  expect(youPlayer([FRIEND])).toBeNull();
  expect(youPlayer(undefined)).toBeNull();
});

test(
  "You: your player's page with Stats as a tab, your other players to you alone, no friend",
  { timeout: 20000 },
  async () => {
    window.history.pushState({}, "", "/home/you");
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Birch Lantern" });
    expect(screen.getByText("Birch Lantern won five in a row")).toBeTruthy();
    const stats = screen.getByRole("tab", { name: "Stats" });
    expect(
      stats.closest("a")?.getAttribute("href") ?? stats.getAttribute("href"),
    ).toBe("/home/you/stats");
    const others = screen.getByRole("heading", { name: "Your other players" })
      .parentElement.parentElement;
    expect(others.textContent).toContain("Umber");
    expect(others.textContent).toContain("not verified");
    expect(others.textContent).not.toContain("Copper Fern");
    // Your own page sends you to Stats by its tab, not a second door.
    expect(screen.queryByRole("link", { name: "Your stats" })).toBeNull();
  },
);

test(
  "no verified player: You says how to verify one, and Stats stays reachable",
  { timeout: 20000 },
  async () => {
    me = { ...ME, claims: [{ ...VERIFIED, status: "pending" }] };
    window.history.pushState({}, "", "/home/you");
    render(<App />);
    await screen.findByRole("heading", { name: "Verify your player" });
    expect(
      screen
        .getByRole("link", { name: /Verify a player/ })
        .getAttribute("href"),
    ).toBe("/settings/players/verify");
    expect(
      screen.getByRole("link", { name: /Your stats/ }).getAttribute("href"),
    ).toBe("/home/you/stats");
  },
);

test(
  "an old Ladder address lands on the same Stats page, its query kept",
  { timeout: 20000 },
  async () => {
    window.history.pushState({}, "", "/ladder/decks?player=PYLQ88");
    render(<App />);
    await waitFor(() =>
      expect(window.location.pathname).toBe("/home/you/stats/decks"),
    );
    expect(window.location.search).toBe("?player=PYLQ88");
    const tabs = await screen.findByRole("tablist", { name: "You" });
    const stats = [...tabs.querySelectorAll("[aria-selected='true']")].map(
      (t) => t.textContent,
    );
    expect(stats).toEqual(["Stats"]);
  },
);
