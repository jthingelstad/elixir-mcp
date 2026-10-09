/**
 * Ladder's routing and shaping (ladder/ladder.js). Every number a Ladder
 * page shows is one a tool returned, so these pin the seams where the
 * page could invent one: the rate shown for a deck played in several
 * modes, the tile that stands in for a trophy range, the bars' scale.
 */
import { describe, test, expect } from "vitest";
import {
  LADDER_PAGES,
  captureLanded,
  capturePending,
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
  pickSeason,
  recordedSeasons,
  seasonArg,
  seasonName,
  seasonWords,
  zoneShort,
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
    expect(ladderTitle(path)).toBe(`${p.label} - Ladder - Elixir`);
    expect(titleFor("ladder", {}, path)).toBe(`${p.label} - Ladder - Elixir`);
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

test("a time Ladder prints names its clock, as the battle page's does", () => {
  expect(zoneShort("2026-10-08T19:14:00.000Z", CHI)).toBe("CDT");
  expect(zoneShort("2026-12-08T19:14:00.000Z", CHI)).toBe("CST");
  // An account with no zone set reads UTC, and says so.
  expect(zoneShort("2026-10-08T19:14:00.000Z", null)).toBe("UTC");
  expect(zoneShort("2026-10-08T19:14:00.000Z", "Mars/Olympus")).toBe("UTC");
  expect(zoneShort(null, CHI)).toBe("");
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
    running: true,
  });
  // Named as the rest of Elixir names a season, once the row has its
  // river race number; a closed season's window has an end.
  const closed = {
    window: {
      ...APPLIED.window,
      to: "2026-10-05T10:00:00.000Z",
      season: { ...APPLIED.window.season, war: 136 },
    },
  };
  expect(seasonHead(closed)).toMatchObject({
    name: "Season 136",
    running: false,
  });
  expect(seasonHead(undefined).name).toBe("This season");
});

describe("the season a page reads (2026-10-08)", () => {
  test("?season= becomes the tools' own season argument", () => {
    expect(seasonArg(undefined)).toBe("current");
    expect(seasonArg("")).toBe("current");
    expect(seasonArg("current")).toBe("current");
    expect(seasonArg("136")).toBe(136);
    expect(seasonArg(136)).toBe(136);
    expect(seasonArg("2026-09")).toBe("2026-09");
    expect(seasonArg("previous")).toBe("previous");
    expect(seasonArg("drop table")).toBe("current");
  });

  test("a season is named as Elixir names it, and an address carries it", () => {
    expect(seasonName({ war: 137, month: "2026-10" })).toBe("Season 137");
    expect(seasonName({ war: null, month: "2026-10" })).toBe("October season");
    expect(seasonName(null)).toBe("This season");
    expect(ladderHref("decks", { player: "#VJQV8G8RL", season: 136 })).toBe(
      "/ladder/decks?player=VJQV8G8RL&season=136",
    );
    expect(ladderHref("season", { season: "" })).toBe("/ladder");
  });

  const LISTED = {
    window: {
      from: "2026-08-20T00:00:00.000Z",
      to: null,
      season: { month: "2026-08", war: 135 },
      crosses: [
        {
          kind: "season",
          at: "2026-09-07T10:00:00.000Z",
          from_season: { month: "2026-08", war: 135 },
          to_season: { month: "2026-09", war: 136 },
        },
        {
          kind: "season",
          at: "2026-10-05T10:00:00.000Z",
          from_season: { month: "2026-09", war: 136 },
          to_season: { month: "2026-10", war: 137 },
        },
      ],
    },
  };

  test("the seasons on record are the window's own, newest first", () => {
    const seasons = recordedSeasons(LISTED);
    expect(seasons.map((s) => [s.key, s.name, s.current])).toEqual([
      ["137", "Season 137", true],
      ["136", "Season 136", false],
      ["135", "Season 135", false],
    ]);
    expect(recordedSeasons(undefined)).toEqual([]);
  });

  test("an address that names a season gets it, even an empty one", () => {
    const seasons = recordedSeasons(LISTED);
    expect(pickSeason("136", { seasons, currentBattles: 0 })).toMatchObject({
      arg: 136,
      key: "136",
      name: "Season 136",
      current: false,
      fallback: null,
      ready: true,
    });
    expect(pickSeason("137", { seasons })).toMatchObject({
      arg: 137,
      current: true,
      fallback: null,
    });
    // A season older than the record still reads; the tool answers it.
    expect(pickSeason("120", { seasons })).toMatchObject({
      arg: 120,
      name: "Season 120",
      current: false,
    });
  });

  test("an empty current season opens on the last one, and says so", () => {
    const seasons = recordedSeasons(LISTED);
    const picked = pickSeason(undefined, { seasons, currentBattles: 0 });
    expect(picked).toMatchObject({ arg: 136, key: "136", ready: true });
    expect(picked.fallback).toMatchObject({ key: "137", name: "Season 137" });
    expect(seasonWords(picked)).toBe("in Season 136");
    // A season with battles, a refused read, or no earlier season on
    // record: the current one.
    expect(pickSeason(undefined, { seasons, currentBattles: 4 })).toMatchObject(
      { arg: "current", key: "137", fallback: null },
    );
    expect(
      pickSeason(undefined, { seasons, currentBattles: null }),
    ).toMatchObject({ arg: "current", fallback: null });
    expect(
      pickSeason(undefined, {
        seasons: seasons.slice(0, 1),
        currentBattles: 0,
      }),
    ).toMatchObject({ arg: "current", fallback: null });
    expect(
      seasonWords(pickSeason(undefined, { seasons, currentBattles: 4 })),
    ).toBe("this season");
  });

  test("the page waits for what it needs to choose, and no longer", () => {
    expect(pickSeason(undefined, {}).ready).toBe(false);
    // Battles this season: no need to wait for the list.
    expect(pickSeason(undefined, { currentBattles: 3 }).ready).toBe(true);
    expect(pickSeason(undefined, { currentBattles: 0 }).ready).toBe(false);
    expect(pickSeason("136", {}).ready).toBe(true);
  });
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

test("a player with nothing captured yet is pending, never an error or an empty mode", () => {
  const polls = (at) => ({ player_battlelog: { observed_at: at } });
  const window = { from: "2026-09-08T12:00:00Z", to: "2026-10-08T12:00:00Z" };
  expect(
    capturePending({ isError: true, error: { code: "not_recorded" } }),
  ).toBe(true);
  expect(capturePending({ isError: true, error: { code: "internal" } })).toBe(
    false,
  );
  expect(capturePending({ isPending: true })).toBe(false);
  expect(
    capturePending({ data: { meta: { source_polls: polls(null) } } }),
  ).toBe(true);
  // A battle log that was read, even an empty one, is a record to show.
  expect(
    capturePending({
      data: { meta: { source_polls: polls("2026-10-08T12:00:00Z") } },
    }),
  ).toBe(false);
  // Retained history older than the summary's window is still history,
  // with no poll state.
  expect(
    capturePending({
      data: {
        applied: { window },
        last_30_days: { battles: 0 },
        meta: {
          recorded_since: "2026-07-01T00:00:00Z",
          source_polls: polls(null),
        },
      },
    }),
  ).toBe(false);
});

// 2026-10-08, the fresh-person journey: Ladder showed an empty season
// about 4 s after the add, because the profile read had set
// recorded_since. Each test below replays one real arrival order, as the
// page sees it: the summary it reads and the first-answer status Pending
// polls, at each step.
describe("a first capture, in the order its reads arrive", () => {
  const window = { from: "2026-09-08T12:05:00Z", to: "2026-10-08T12:05:00Z" };
  const answered = ({ battles = 0, battlelogAt = null } = {}) => ({
    data: {
      applied: { window },
      last_30_days: { battles },
      meta: {
        as_of: "2026-10-08T12:05:00Z",
        // The profile snapshot alone sets recorded_since (buildMeta).
        recorded_since: "2026-10-08T00:00:00Z",
        source_polls: {
          player: { observed_at: "2026-10-08T12:00:04Z" },
          player_battlelog: { observed_at: battlelogAt },
        },
      },
    },
  });
  const refused = { isError: true, error: { code: "not_recorded" } };
  const status = (p) => ({
    recording_status: "active",
    profile_available: false,
    battlelog_observed_at: null,
    last_battle_at: null,
    battles_30d: 0,
    ...p,
  });

  test("profile first, battles later: pending until the battle log is in", () => {
    // Just added: nothing.
    expect(capturePending(refused)).toBe(true);
    expect(captureLanded(status())).toBe(false);
    // 4 s later the profile lands: the summary answers, recorded_since is
    // set, and there is still nothing to show.
    expect(capturePending(answered())).toBe(true);
    expect(captureLanded(status({ profile_available: true }))).toBe(false);
    // The battle log lands with 30 battles: the page shows the season.
    const read = "2026-10-08T12:03:00Z";
    expect(
      captureLanded(
        status({
          profile_available: true,
          battlelog_observed_at: read,
          last_battle_at: "2026-10-08T11:40:00Z",
          battles_30d: 30,
        }),
      ),
    ).toBe(true);
    expect(capturePending(answered({ battles: 30, battlelogAt: read }))).toBe(
      false,
    );
  });

  test("battle log first: pending until the profile lands too", () => {
    const read = "2026-10-08T12:00:03Z";
    const battles = {
      battlelog_observed_at: read,
      last_battle_at: "2026-10-08T11:40:00Z",
      battles_30d: 30,
    };
    // The battle log is in, but the summary answers from the profile and
    // still refuses: one refresh spent now would leave the page pending.
    expect(capturePending(refused)).toBe(true);
    expect(captureLanded(status(battles))).toBe(false);
    // The profile lands: now it has landed, and the summary answers.
    expect(captureLanded(status({ ...battles, profile_available: true }))).toBe(
      true,
    );
    expect(capturePending(answered({ battles: 30, battlelogAt: read }))).toBe(
      false,
    );
  });

  test("an inactive real player: an empty battle log read ends pending", () => {
    const read = "2026-10-08T12:03:00Z";
    expect(
      captureLanded(
        status({ profile_available: true, battlelog_observed_at: read }),
      ),
    ).toBe(true);
    expect(capturePending(answered({ battlelogAt: read }))).toBe(false);
  });

  test("a typo'd tag never lands: its empty battle log is no capture", () => {
    // Clash Royale answers the profile 404 and the battle log of an
    // unknown tag 200 [], which is admitted. No profile, so the summary
    // keeps refusing and Pending says Tag not found (record-journey.js).
    const typo = status({ battlelog_observed_at: "2026-10-08T12:00:03Z" });
    expect(captureLanded(typo)).toBe(false);
    expect(capturePending(refused)).toBe(true);
  });
});
