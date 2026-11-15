/**
 * Account pages (2026-11-15): an account's players with their states, its
 * badges and Stamps, its timeline, Follow in one tap; a Claimed player
 * wears the grey ring and names the account claiming it. Invented players
 * and page ids only.
 */
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  configure,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { App, barArea, titleFor } from "../src/App.jsx";
import "./warm-routes.js";
import { accountHref, accountIdOf, accountOf } from "../src/lib/account.js";

configure({ asyncUtilTimeout: 5000 });

const MINE = "abcdefghjkmn";
const THEIRS = "pqrstuvwxyz2";
const MAIN = "#0GVJ9V";
const ALT = "#0VJ2QV";

const ME = {
  authenticated: true,
  is_admin: false,
  role: "member",
  timezone: "America/Chicago",
  page_id: MINE,
  claims: [
    {
      player_tag: "#0LJ2C",
      name: "Birch Lantern",
      is_primary: true,
      relationship: "primary",
      status: "verified",
    },
  ],
  recordings: [],
};

const PAGE = (following = false) => ({
  account: {
    id: THEIRS,
    name: "Copper Fern",
    player: {
      tag: MAIN,
      name: "Copper Fern",
      relationship: "primary",
      state: "verified",
      avatar_card_id: null,
    },
    state: "verified",
    players: [
      {
        tag: MAIN,
        name: "Copper Fern",
        relationship: "primary",
        state: "verified",
        clan_tag: null,
        clan_name: null,
        avatar_card_id: null,
      },
      {
        tag: ALT,
        name: "Moss Kettle",
        relationship: "alt",
        state: "claimed",
        clan_tag: null,
        clan_name: "Grove",
      },
    ],
    badges: { verified_player: true, discord: true },
    place: { city: "Duluth", region: "Minnesota", country: "United States" },
    follows: { count: 3 },
    followers: following ? 1 : 0,
    following_accounts: 0,
  },
  you: { self: false, following },
  passport: {
    id: THEIRS,
    count: 1,
    marks: [{ stamp_id: "on_the_map", level: 1 }],
  },
  window_days: 30,
  timeline: [
    {
      id: "tl_00000000000000000001",
      kind: "player_verified",
      section: "people",
      at: "2026-11-15T12:00:00.000Z",
      text: "Copper Fern is verified on Elixir. Nobody else can claim #0GVJ9V now.",
      facts: { account_id: THEIRS, player_tag: MAIN },
      subjects: [{ kind: "player", tag: MAIN, name: "Copper Fern" }],
    },
  ],
  timeline_more: 0,
  player_verifications: { [MAIN]: true, [ALT]: false },
  player_claims: { [MAIN]: false, [ALT]: true },
});

const reply = (body, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

let routes;
let writes;
beforeEach(() => {
  cleanup();
  writes = [];
  let following = false;
  routes = {
    "GET /api/me": () => reply(ME),
    [`GET /api/accounts/${THEIRS}`]: () => reply(PAGE(following)),
    "POST /api/me/account-follows": () => {
      following = true;
      return reply({ ok: true, following: true });
    },
    "GET /api/me/clans": () => reply({ clans: [], home_clan: null }),
  };
  vi.spyOn(console, "error").mockImplementation(() => {});
  global.fetch = vi.fn(async (path, init = {}) => {
    const method = init.method ?? "GET";
    const p = String(path).split("?")[0];
    if (method !== "GET") writes.push(`${method} ${p} ${init.body ?? ""}`);
    const route = routes[`${method} ${p}`];
    return route ? route() : reply({ error: "not_found" }, 404);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  window.history.pushState({}, "", "/");
});

const at = (path) => {
  window.history.pushState({}, "", path);
  render(<App />);
};

test("addresses: an account by its page id, its passport under it", () => {
  expect(accountHref(THEIRS)).toBe(`/home/account/${THEIRS}`);
  expect(accountIdOf(`/home/account/${THEIRS}`)).toBe(THEIRS);
  expect(accountIdOf(`/home/account/${THEIRS}/passport`)).toBeNull();
  expect(accountIdOf("/home/account/not-an-id")).toBeNull();
  expect(barArea(`/home/account/${THEIRS}`)).toBe("find");
  expect(titleFor(`/home/account/${THEIRS}`)).toBe("Account - Home - Elixir");
  expect(titleFor(`/home/account/${THEIRS}/passport`)).toBe(
    "Passport - Home - Elixir",
  );
  expect(accountOf({ section: "people", facts: { account_id: THEIRS } })).toBe(
    THEIRS,
  );
  expect(accountOf({ section: "player", facts: { account_id: THEIRS } })).toBe(
    null,
  );
});

test(
  "an account's page: players with their states, a grey ring on the claimed alt, and Follow",
  { timeout: 20000 },
  async () => {
    at(`/home/account/${THEIRS}`);
    await screen.findByRole("heading", { level: 1, name: /Copper Fern/ });
    expect(screen.getByText(/Duluth, Minnesota, United States/)).toBeTruthy();
    expect(screen.getByText(/Main · Verified/)).toBeTruthy();
    expect(screen.getByText(/Alt · Claimed/)).toBeTruthy();
    expect(screen.getByText("Verified in Discord")).toBeTruthy();
    expect(screen.getByText("1 Stamp")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /Open passport/ }).getAttribute("href"),
    ).toBe(`/home/account/${THEIRS}/passport`);
    expect(screen.getByText(/Nobody else can claim/)).toBeTruthy();
    // The claimed alt wears grey, never gold.
    const moss = screen.getByRole("link", { name: /Moss Kettle/ });
    const ring = moss.parentElement.querySelector(".kit-av");
    expect(ring.className).toContain("kit-av--claimed");
    expect(ring.className).not.toContain("kit-av--verified");
    fireEvent.click(screen.getByRole("button", { name: "Follow" }));
    await waitFor(() =>
      expect(writes).toEqual([
        `POST /api/me/account-follows ${JSON.stringify({ id: THEIRS })}`,
      ]),
    );
    await screen.findByRole("button", { name: /Following/ });
  },
);

test(
  "your own account page offers no Follow, and You links to it",
  { timeout: 20000 },
  async () => {
    routes[`GET /api/accounts/${MINE}`] = () =>
      reply({ ...PAGE(), you: { self: true, following: false } });
    at(`/home/account/${MINE}`);
    await screen.findByRole("heading", { level: 1, name: /Copper Fern/ });
    expect(screen.queryByRole("button", { name: "Follow" })).toBeNull();
  },
);

test("an unknown account says so", { timeout: 20000 }, async () => {
  at("/home/account/zzzzzzzzzzzz");
  await screen.findByText("No Elixir account at this address");
});
