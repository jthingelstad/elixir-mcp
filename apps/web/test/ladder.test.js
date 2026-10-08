/**
 * Ladder's routing and shaping (ladder/ladder.js). Every number a Ladder
 * page shows is one a tool returned, so these pin the seams where the
 * page could invent one: the rate shown for a deck played in several
 * modes, the tile that stands in for a trophy range, the bars' scale.
 */
import { test, expect } from "vitest";
import {
  LADDER_PAGES,
  clockTime,
  dateLabel,
  deckModes,
  floorNote,
  fourthTile,
  isLadder,
  ladderHere,
  ladderHref,
  ladderLegal,
  ladderPlayers,
  ladderTitle,
  longDay,
  monthName,
  pickMode,
  pickPlayer,
  seasonHead,
  shortDay,
  signed,
  weekBars,
} from "../src/ladder/ladder.js";
import { DOC_LINKS, legalRoute, titleFor } from "../src/App.jsx";

const CHI = "America/Chicago";

test("Ladder owns /ladder and its pages, and nothing beside them", () => {
  expect(isLadder("/ladder")).toBe(true);
  expect(isLadder("/ladder/days")).toBe(true);
  expect(isLadder("/ladders")).toBe(false);
  expect(isLadder("/console/ladder")).toBe(false);

  expect(ladderLegal("/ladder")).toBe("/ladder");
  // The season home is the bare path; its slug and a trailing slash
  // resolve to it, as does a page that does not exist.
  expect(ladderLegal("/ladder/")).toBe("/ladder");
  expect(ladderLegal("/ladder/season")).toBe("/ladder");
  expect(ladderLegal("/ladder/nonsense")).toBe("/ladder");
  expect(ladderLegal("/ladders")).toBe(null);
  for (const p of LADDER_PAGES.filter((p) => p.slug !== "season")) {
    expect(ladderLegal(`/ladder/${p.slug}`)).toBe(`/ladder/${p.slug}`);
    expect(ladderLegal(`/ladder/${p.slug}/extra`)).toBe(`/ladder/${p.slug}`);
  }

  // The app's guard hands Ladder its own paths and still sends a
  // look-alike to the static site.
  expect(legalRoute("/ladder")).toBe("/ladder");
  expect(legalRoute("/ladder/season")).toBe("/ladder");
  expect(legalRoute("/ladders")).toBe(null);
});

test("every Ladder page has a rail position, a title and a docs strip entry", () => {
  for (const p of LADDER_PAGES) {
    const path = p.slug === "season" ? "/ladder" : `/ladder/${p.slug}`;
    const here = ladderHere(path);
    expect(here).toEqual({
      key: p.slug,
      product: "ladder",
      doc: `ladder:${p.slug}`,
    });
    expect(DOC_LINKS[here.doc], `${path} has no docs strip`).toBeTruthy();
    expect(ladderTitle(path)).toBe(`${p.label} - Ladder - Elixir MCP`);
    expect(titleFor("ladder", {}, path)).toBe(
      `${p.label} - Ladder - Elixir MCP`,
    );
  }
  for (const [, links] of LADDER_PAGES.map(
    (p) => DOC_LINKS[`ladder:${p.slug}`],
  ))
    expect(
      links.some(([, href]) => href.split("#")[0] === "/docs/ladder"),
    ).toBe(true);
});

test("an address carries the player without its hash and only what was given", () => {
  expect(ladderHref("season")).toBe("/ladder");
  expect(ladderHref("season", { player: "#VJQV8G8RL" })).toBe(
    "/ladder?player=VJQV8G8RL",
  );
  expect(ladderHref("days", { mode: "ranked" })).toBe(
    "/ladder/days?mode=ranked",
  );
  expect(ladderHref("decks", { player: undefined, mode: undefined })).toBe(
    "/ladder/decks",
  );
});

const CLAIMS = [
  { player_tag: "#FRIEND1", relationship: "friend" },
  { player_tag: "#VJQV8G8RL", name: "thingles", relationship: "alt" },
  {
    player_tag: "#20JJJ2CCRU",
    name: "King Thing",
    is_primary: true,
    relationship: "primary",
  },
  { player_tag: "#WATCHED", relationship: "watching" },
];

test("the players are yours alone, primary first", () => {
  const players = ladderPlayers(CLAIMS);
  expect(players.map((p) => p.player_tag)).toEqual([
    "#20JJJ2CCRU",
    "#VJQV8G8RL",
  ]);
  expect(ladderPlayers(undefined)).toEqual([]);
});

test("?player picks one of yours, and anything else reads your primary", () => {
  const players = ladderPlayers(CLAIMS);
  expect(pickPlayer(players, "VJQV8G8RL").player_tag).toBe("#VJQV8G8RL");
  expect(pickPlayer(players, "#vjqv8g8rl").player_tag).toBe("#VJQV8G8RL");
  // A friend's tag is not yours: their season is not shown.
  expect(pickPlayer(players, "FRIEND1").player_tag).toBe("#20JJJ2CCRU");
  expect(pickPlayer(players, undefined).player_tag).toBe("#20JJJ2CCRU");
  expect(pickPlayer([], "X")).toBe(null);
});

test("the mode is the one asked for, else the one with the most recorded battles", () => {
  expect(pickMode("war", {})).toBe("war");
  expect(pickMode("bogus", undefined)).toBe("ladder");
  expect(
    pickMode(undefined, {
      ladder: { battles: 39 },
      ranked: { battles: 40 },
      war: { battles: 90 },
    }),
  ).toBe("war");
  expect(pickMode(undefined, { event: { battles: 3 } })).toBe("event");
  expect(pickMode(undefined, { war: { battles: 4 } })).toBe("war");
  expect(
    pickMode(undefined, { ladder: { battles: 3 }, ranked: { battles: 3 } }),
  ).toBe("ladder");
});

test("dates are prose in the account's zone", () => {
  // 10:00Z on a Monday is 5:00 am in Chicago in October.
  expect(longDay("2026-10-05T10:00:00.000Z", CHI)).toBe("Monday, October 5");
  expect(clockTime("2026-10-05T10:00:00.000Z", CHI)).toBe("5:00 am");
  // Late evening in Chicago is the next day in UTC.
  expect(shortDay("2026-09-19T04:01:25.000Z", CHI)).toBe("Sep 18");
  expect(shortDay("2026-09-19T04:01:25.000Z", null)).toBe("Sep 19");
  // A zone the browser does not know reads as UTC.
  expect(shortDay("2026-09-19T04:01:25.000Z", "Mars/Olympus")).toBe("Sep 19");
  expect(dateLabel("2026-09-07")).toBe("Sep 7");
  expect(monthName("2026-09")).toBe("September");
  expect(longDay(null, CHI)).toBe("");
});

test("signed numbers carry a true minus and no sign on zero", () => {
  expect(signed(29)).toBe("+29");
  expect(signed(-6)).toBe("−6");
  expect(signed(0)).toBe("0");
  expect(signed(0.57, 2)).toBe("+0.57");
  expect(signed(-1234)).toBe("−1,234");
  expect(signed(null)).toBe("—");
});

const APPLIED = {
  window: {
    season: {
      month: "2026-09",
      starts_at: "2026-09-07T10:00:00.000Z",
      ends_at: "2026-10-05T10:00:00.000Z",
    },
    season_age_days: 24,
  },
};

test("the season head is the tool's own window", () => {
  expect(seasonHead(APPLIED)).toEqual({
    month: "2026-09",
    name: "September season",
    age: 24,
    startsAt: "2026-09-07T10:00:00.000Z",
    endsAt: "2026-10-05T10:00:00.000Z",
  });
  expect(seasonHead(undefined).name).toBe("This season");
});

const FLOOR = {
  floor: 12500,
  arena: { name: "Ultimate Clash Pit" },
  floored: true,
  on_floor_losses: 6,
  trophy_range: { lowest: 12500, highest: 12562 },
};

test("the fourth tile is the trophy range, else net trophies in a trophy mode, else crowns", () => {
  const w = { net_trophies: -10, crowns_for: 25, crowns_against: 37 };
  expect(fourthTile("ladder", w, FLOOR)).toEqual({
    label: "Trophy range",
    value: "12,500–12,562",
  });
  expect(fourthTile("ranked", w, null)).toEqual({
    label: "Net trophies",
    value: "−10",
  });
  // War moves no trophies: its net is not a number to show.
  expect(fourthTile("war", w, null)).toEqual({
    label: "Crowns",
    value: "25–37",
  });
  expect(fourthTile("event", {}, null)).toBe(null);
});

test("the floor note says where the player stood and what it cost", () => {
  expect(floorNote(FLOOR)).toBe(
    "You stood on the 12,500 floor (Ultimate Clash Pit) this season. Six losses there cost nothing, so net trophies say more about how recently you played than how well: read the range and the win rate.",
  );
  expect(floorNote({ ...FLOOR, on_floor_losses: 1 })).toContain(
    "One loss there cost nothing",
  );
  expect(floorNote({ ...FLOOR, on_floor_losses: 0 })).toBe(
    "You stood on the 12,500 floor (Ultimate Clash Pit) this season.",
  );
  expect(floorNote({ ...FLOOR, floored: false })).toBe(null);
  expect(floorNote(null)).toBe(null);
});

const WEEKLY = [
  {
    iso_week: "2026-W37",
    week_of: "2026-09-07",
    wins: 4,
    losses: 6,
    net_trophies: -6,
    win_rate: 0.4,
    partial: true,
  },
  {
    iso_week: "2026-W38",
    week_of: "2026-09-14",
    wins: 4,
    losses: 6,
    net_trophies: 29,
    win_rate: 0.4,
  },
  {
    iso_week: "2026-W39",
    week_of: "2026-09-21",
    wins: 4,
    losses: 7,
    net_trophies: -3,
    win_rate: 0.364,
  },
  {
    iso_week: "2026-W40",
    week_of: "2026-09-28",
    wins: 0,
    losses: 3,
    net_trophies: -30,
    win_rate: 0,
    partial: true,
  },
];

test("week bars keep the tool's order and share one scale for wins and losses", () => {
  const bars = weekBars(WEEKLY);
  expect(bars.map((b) => b.label)).toEqual([
    "Sep 7",
    "Sep 14",
    "Sep 21",
    "Sep 28",
  ]);
  // Seven losses is the tallest half: 16px a battle fits both halves.
  expect(bars.map((b) => [b.winH, b.lossH])).toEqual([
    [64, 96],
    [64, 96],
    [64, 112],
    [0, 48],
  ]);
  expect(bars.map((b) => b.note)).toEqual([
    "partial · −6",
    "+29",
    "−3",
    "partial · −30",
  ]);
  expect(bars[2].rate).toBe(0.364);
  // A bigger week shrinks the unit rather than overflowing the chart.
  const big = weekBars([{ week_of: "2026-09-07", wins: 35, losses: 14 }]);
  expect(big[0].winH).toBeLessThanOrEqual(70);
  expect(big[0].winH / 35).toBeCloseTo(big[0].lossH / 14, 0);
  // Where trophies do not move, the note leaves net trophies out.
  expect(weekBars(WEEKLY, { net: false }).map((b) => b.note)).toEqual([
    "partial",
    "",
    "",
    "partial",
  ]);
});

test("a deck's rate shows only when it is one mode's own", () => {
  const one = {
    win_rate: 0.375,
    modes: { ladder: { battles: 24, wins: 9, losses: 15 } },
  };
  expect(deckModes(one)).toEqual([
    { key: "ladder", label: "Trophy Road", wins: 9, losses: 15, rate: 0.375 },
  ]);
  // Played in two modes, win_rate pools them: no rate, a record each.
  const two = {
    win_rate: 0.5,
    modes: {
      ladder: { battles: 10, wins: 4, losses: 6 },
      war: { battles: 10, wins: 6, losses: 4 },
      event: { battles: 0, wins: 0, losses: 0 },
    },
  };
  expect(deckModes(two)).toEqual([
    { key: "ladder", label: "Trophy Road", wins: 4, losses: 6, rate: null },
    { key: "war", label: "War", wins: 6, losses: 4, rate: null },
  ]);
  expect(deckModes(null)).toEqual([]);
});
