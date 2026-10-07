import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { Overview } from "../src/views/account/Overview.jsx";

/**
 * Console › Overview, drawn to the 2026-09-29 canvas: across Elixir
 * (Ladder, your clan, the game), your players and clans as short lists
 * into Tracking, and today's calls. Every figure on it is one the
 * console already reads; these pin where each comes from, and that the
 * tiles carry no number the record does not hold.
 */

const NOW = Date.now();
const claim = (player_tag, name, relationship, extra = {}) => ({
  player_tag,
  name,
  relationship,
  is_primary: relationship === "primary",
  ...extra,
});
const ME = {
  role: "owner",
  claims: [
    claim("#20JJJ2CCRU", "King Thing", "primary", { status: "verified" }),
    claim("#U8RYG9Y2U", "King Levy", "friend"),
    claim("#VJQV8G8RL", "thingles", "alt"),
    claim("#200UL8LYUJ", "Lucky Red Panda", "watching"),
    claim("#VJG0J29QP", "Big Thing", "alt"),
    claim("#UL2V9QRG0", "raquaza", "friend"),
  ],
  recordings: [
    {
      subject_tag: "#20JJJ2CCRU",
      status: "active",
      freshest_poll: new Date(NOW - 4 * 60_000).toISOString(),
    },
  ],
};
const CLANS = {
  clans: [
    { clan_tag: "#GCYQR9VY", name: "Ship It!", scope: "activity" },
    {
      clan_tag: "#J2RGCRVG",
      name: "POAP KINGS",
      scope: "comprehensive",
      member_count: 46,
    },
  ],
  home_clan: { clan_tag: "#J2RGCRVG", name: "POAP KINGS" },
  slots: {},
};
const days = Array.from({ length: 40 }, (_, i) => ({
  day: new Date(NOW - (39 - i) * 86_400_000).toISOString().slice(0, 10),
  battles: 2,
  status: "recorded",
}));

function stub(routes) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path) => {
      const body = routes[path];
      if (body === undefined) throw new Error(`unmocked fetch: ${path}`);
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      };
    }),
  );
}

const ROUTES = {
  "/api/me/clans": CLANS,
  "/api/me/first-answer": { player: null, connection: null },
  "/api/me/usage": { today_calls: 2551, quota_max: null, live_today: 0 },
  "/api/me/battle-activity/20JJJ2CCRU": {
    player_tag: "#20JJJ2CCRU",
    computed_at: new Date(NOW).toISOString(),
    battles_28d: 80,
    rhythm: new Array(168).fill(0),
    days,
  },
};

beforeEach(() => cleanup());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("across Elixir: the Ladder, your clan's week and the game, with no number the record does not hold", async () => {
  stub(ROUTES);
  renderWithProviders(<Overview me={ME} navigate={vi.fn()} />);
  const across = (
    await screen.findByRole("heading", { name: "Across Elixir" })
  ).closest("section");
  // Until the clans arrive the clan tile goes to Elixir Clan's own home.
  await waitFor(() =>
    expect(
      within(across)
        .getAllByRole("link")
        .map((a) => a.getAttribute("href")),
    ).toEqual([
      "/ladder",
      "/clan/J2RGCRVG/week",
      "https://drop.poapkings.com/",
    ]),
  );
  const links = within(across).getAllByRole("link");
  expect(links[0].textContent).toContain("King Thing");
  expect(links[0].textContent).toContain("This season ›");
  // The clan's tile counts members the record holds, never war decks.
  await waitFor(() =>
    expect(links[1].textContent).toContain("46members on record"),
  );
  expect(links[1].textContent).toContain("Clan · POAP KINGS");
  // Drop is the game: its own host, a new window, and the label says so.
  expect(links[2].getAttribute("target")).toBe("_blank");
  expect(links[2].getAttribute("aria-label")).toBe(
    "Play Drop, the elixir-cost game (opens drop.poapkings.com in a new window)",
  );
  expect(links[2].className).toContain("max-wide:hidden");
});

test("players: you first, then your accounts, friends and the watched, four rows and who is next", async () => {
  stub(ROUTES);
  renderWithProviders(<Overview me={ME} navigate={vi.fn()} />);
  const panel = (
    await screen.findByRole("heading", { name: /^Players/ })
  ).closest("section");
  expect(within(panel).getByRole("heading").textContent).toBe("Players 6");
  const rows = within(panel).getAllByRole("link");
  // The head's Tracking link, four players, and the "more" line.
  expect(rows.map((a) => a.getAttribute("href"))).toEqual([
    "/console/account/tracking",
    "/console/account/tracking/20JJJ2CCRU",
    "/console/account/tracking/VJQV8G8RL",
    "/console/account/tracking/VJG0J29QP",
    "/console/account/tracking/U8RYG9Y2U",
    "/console/account/tracking",
  ]);
  // The primary's line is its last 28 days, from the activity reading.
  await waitFor(() =>
    expect(rows[1].textContent).toContain(
      "80 battles in 28 days · all captured",
    ),
  );
  expect(rows[2].textContent).toContain("you");
  expect(rows[4].textContent).toContain("friend");
  // Two spellings of the last line: the width's, and the phone's.
  expect(rows[5].textContent).toContain("raquaza, and 1 more");
  expect(rows[5].textContent).toContain("Big Thing, and 3 more");
  // Rows past the phone's two are hidden there, not removed.
  expect(rows[3].className).toContain("max-wide:hidden");
  expect(rows[2].className).not.toContain("max-wide:hidden");
});

test("clans lead with yours; today's calls say the cap and when the count resets", async () => {
  stub(ROUTES);
  renderWithProviders(<Overview me={ME} navigate={vi.fn()} />);
  const clans = (
    await screen.findByRole("heading", { name: /^Clans/ })
  ).closest("section");
  await waitFor(() =>
    expect(within(clans).getByRole("heading").textContent).toBe("Clans 2"),
  );
  const rows = within(clans).getAllByRole("link").slice(1);
  expect(rows[0].textContent).toContain("POAP KINGS");
  expect(rows[0].textContent).toContain("your clan · 46 members");
  expect(rows[1].textContent).toContain("activity");

  const today = (
    await screen.findByRole("heading", { name: /MCP calls today/ })
  ).closest("section");
  expect(today.textContent).toContain("2,551 MCP calls today");
  expect(today.textContent).toMatch(
    /No daily cap on the owner tier · the count resets /,
  );
  expect(
    within(today).getByRole("link", { name: "Usage ›" }).getAttribute("href"),
  ).toBe("/console/account/usage");
});

test("the pill says when the primary was last read, green within the hour", async () => {
  stub(ROUTES);
  renderWithProviders(<Overview me={ME} navigate={vi.fn()} />);
  const pill = await screen.findByText(/^live · last read /);
  expect(pill.className).toContain("chip--ok");
  cleanup();
  renderWithProviders(
    <Overview
      me={{
        ...ME,
        recordings: [
          {
            subject_tag: "#20JJJ2CCRU",
            freshest_poll: new Date(NOW - 3 * 3_600_000).toISOString(),
          },
        ],
      }}
      navigate={vi.fn()}
    />,
  );
  expect((await screen.findByText(/^last read /)).className).toContain(
    "chip--warn",
  );
});
