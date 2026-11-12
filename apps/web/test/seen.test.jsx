/**
 * Settings › What members see (#769): the page gathers who sees what, the
 * slots come from /api/me as Players & tracking reads them, and the lens is
 * the battle page itself drawn for a viewer who is not you, from the public
 * battle answer. Invented players only.
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

// The whole App from a cold module graph: bound the wait as the other
// whole-App journeys do (profile.test.jsx).
configure({ asyncUtilTimeout: 5000 });

const SHORT = "abcdef012345";
const URL = `https://elixir.poapkings.com/battle/${SHORT}`;

const ME = {
  authenticated: true,
  is_admin: false,
  is_owner: false,
  role: "member",
  email: "someone@example.com",
  timezone: "America/Chicago",
  claims: [
    {
      player_tag: "#PYLQ88",
      name: "Birch Lantern",
      nickname: "Private Owl",
      is_primary: true,
      relationship: "primary",
      status: "verified",
      slot: "used",
    },
  ],
  recordings: [],
  entitlements: { player_slots: { used: 3, limit: 50, free: 2 } },
};

const side = (outcome, tag, name, crowns) => ({
  outcome,
  crowns,
  tower_hp: { king: outcome === "win" ? 5000 : 0, princess: [0, 0] },
  players: [
    {
      player_tag: tag,
      name,
      clan_tag: null,
      clan_name: null,
      starting_trophies: null,
      trophy_change: null,
      global_rank: null,
      elixir_leaked: null,
      deck: null,
      rounds: null,
    },
  ],
});

const BATTLE = {
  battle: {
    id: `${SHORT}${"0".repeat(52)}`,
    short_id: SHORT,
    url: URL,
    image: `${URL}.png`,
    battle_time: "2026-11-10T14:00:00.000Z",
    type: "PvP",
    kind: "1v1",
    mode_group: "ladder",
    game_mode: { id: 72000006, name: "Ladder" },
    arena: { id: 1, name: "Spirit Square" },
    duration: null,
    deck_level_edge: null,
  },
  sides: [
    side("win", "#PYLQ88", "Birch Lantern", 3),
    side("loss", "#QQ8822", "Copper Fern", 0),
  ],
  games: null,
  meetings: [],
  sitting: [],
  disclaimer: "unofficial",
};

let me;
let battles;
let explored;

const reply = (body, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

beforeEach(() => {
  cleanup();
  me = ME;
  battles = [{ battle_id: BATTLE.battle.id, url: URL }];
  explored = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
  global.fetch = vi.fn(async (path, init) => {
    const p = String(path);
    if (p === "/api/me") return reply(me);
    if (p === "/api/explore") {
      const body = JSON.parse(init.body);
      explored.push(body);
      return reply({ tool: body.tool, is_error: false, body: { battles } });
    }
    if (p === `/api/public/battles/${SHORT}`) return reply(BATTLE);
    if (p.startsWith("/api/me/highlights"))
      return reply({ can_highlight_as: ["#PYLQ88"], highlights: [] });
    return reply({});
  });
});
afterEach(() => vi.restoreAllMocks());

test(
  "the page says who sees what, with the slots /api/me holds",
  { timeout: 20000 },
  async () => {
    window.history.pushState({}, "", "/settings/what-members-see");
    render(<App />);
    await waitFor(() =>
      screen.getByRole("heading", { level: 1, name: "What members see" }),
    );
    for (const name of [
      "Members who are signed in",
      "Someone with a link you send",
      "Only you, or nobody",
      "Your choices",
      "Your follow slots",
      "See it as they do",
    ])
      expect(screen.getByRole("heading", { name })).toBeTruthy();
    const slots = screen.getByRole("group", { name: "Your follow slots" });
    expect(within(slots).getByText("3")).toBeTruthy();
    expect(within(slots).getByText("of 50")).toBeTruthy();
    expect(within(slots).getByText("2")).toBeTruthy();
    // The choices link to the pages that own them; no control lives here.
    expect(
      screen.getByRole("link", { name: /Discord/ }).getAttribute("href"),
    ).toBe("/settings/connections/discord");
  },
);

test(
  "the lens is the battle page for a member, then for someone with the link",
  { timeout: 20000 },
  async () => {
    window.history.pushState({}, "", "/settings/what-members-see");
    render(<App />);
    // A member: names link to the players' pages, and nothing says "you".
    const name = await screen.findByRole("link", { name: "Birch Lantern" });
    expect(name.getAttribute("href")).toBe("/home/player/PYLQ88");
    // (The top bar names the reader; the lens is the panel under its heading.)
    const lens = screen
      .getByRole("heading", { name: "See it as they do" })
      .closest("section");
    expect(within(lens).queryByText("you")).toBeNull();
    // The page keeps one h1; the battle drawn inside it is a section.
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(within(lens).queryByText(/Private Owl/)).toBeNull();
    expect(explored).toEqual([
      {
        tool: "battles_query",
        args: { player_tag: "#PYLQ88", limit: 1, verbosity: "compact" },
      },
    ]);
    // Someone with the link: plain names and the way in.
    fireEvent.click(
      screen.getByRole("button", { name: "Someone with the link" }),
    );
    await waitFor(() => screen.getByRole("link", { name: "Join Elixir" }));
    expect(screen.queryByRole("link", { name: "Birch Lantern" })).toBeNull();
    expect(screen.getAllByText("Birch Lantern").length).toBeGreaterThan(0);
    // Your nickname for your own player is yours: neither lens shows it
    // (your own top bar does, to you).
    expect(within(lens).queryByText(/Private Owl/)).toBeNull();
    // A stand-in viewer never reads your own highlights: the battle page's
    // Highlight panel is yours, not theirs.
    expect(
      global.fetch.mock.calls.some(([p]) =>
        String(p).startsWith("/api/me/highlights"),
      ),
    ).toBe(false);
    expect(within(lens).queryByLabelText("Highlight this battle")).toBeNull();
  },
);

test(
  "with no main player the lens says how to get one",
  { timeout: 20000 },
  async () => {
    me = { ...ME, claims: [] };
    window.history.pushState({}, "", "/settings/what-members-see");
    render(<App />);
    await waitFor(() => screen.getByText("No main player yet"));
    expect(explored).toEqual([]);
  },
);

test(
  "a player with no recorded battle reads as none yet",
  { timeout: 20000 },
  async () => {
    battles = [];
    window.history.pushState({}, "", "/settings/what-members-see");
    render(<App />);
    await waitFor(() => screen.getByText("No recorded battle yet"));
  },
);
