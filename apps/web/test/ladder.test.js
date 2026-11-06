/**
 * Ladder's routing and shaping (ladder/ladder.js). Every number a Ladder
 * page shows is one a tool returned, so these pin the seams where the
 * page could invent one: the rate shown for a deck played in several
 * modes, the tile that stands in for a trophy range, the bars' scale.
 */
import { describe, test, expect } from "vitest";
import {
  modeChips,
  modeLabel,
  modeWords,
  readModes,
  warLine,
  weekRows,
  LADDER_PAGES,
  captureLanded,
  capturePending,
  clockTime,
  dateLabel,
  floorNote,
  formRows,
  fourthTile,
  isLadder,
  ladderHere,
  ladderHref,
  ladderLegal,
  ladderPlayers,
  ladderTitle,
  monthName,
  pickMode,
  pickPlayer,
  pickSeason,
  previousSeason,
  recordedSeasons,
  seasonArg,
  seasonName,
  seasonRows,
  seasonWords,
  zoneShort,
  seasonHead,
  shortDay,
  signed,
} from "../src/ladder/ladder.js";
import { legalRoute, titleFor } from "../src/App.jsx";
import { DOC_LINKS } from "../src/shell/doc-links.js";

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
    expect(DOC_LINKS[here.doc], `${path} has no read more`).toBeTruthy();
    expect(ladderTitle(path)).toBe(`${p.label} - Ladder - Elixir`);
    expect(titleFor("ladder", {}, path)).toBe(`${p.label} - Ladder - Elixir`);
  }
  for (const [, links] of LADDER_PAGES.map(
    (p) => DOC_LINKS[`ladder:${p.slug}`],
  ))
    expect(links.some(([, href]) => href.startsWith("/docs/ladder"))).toBe(
      true,
    );
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

test("Cards keeps a chosen order in its address, and only most losses", () => {
  expect(ladderHref("cards", { mode: "ladder", order: "losses" })).toBe(
    "/ladder/cards?mode=ladder&order=losses",
  );
  // The default order is no parameter at all.
  expect(ladderHref("cards", { mode: "ladder", order: "battles" })).toBe(
    "/ladder/cards?mode=ladder",
  );
  // Another page never carries Cards' order.
  expect(ladderHref("decks", { order: "losses" })).toBe("/ladder/decks");
});

const CLAIMS = [
  { player_tag: "#FRIEND1", relationship: "friend" },
  { player_tag: "#VJQV8G8RL", name: "Spry Kestrel", relationship: "alt" },
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
  expect(clockTime("2026-10-05T10:00:00.000Z", CHI)).toBe("5:00 am");
  // Late evening in Chicago is the next day in UTC.
  expect(shortDay("2026-09-19T04:01:25.000Z", CHI)).toBe("Sep 18");
  expect(shortDay("2026-09-19T04:01:25.000Z", null)).toBe("Sep 19");
  // A zone the browser does not know reads as UTC.
  expect(shortDay("2026-09-19T04:01:25.000Z", "Mars/Olympus")).toBe("Sep 19");
  expect(dateLabel("2026-09-07")).toBe("Sep 7");
  expect(monthName("2026-09")).toBe("September");
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
    war: null,
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

  test("each season on record carries the start the tool named for it", () => {
    const seasons = recordedSeasons(LISTED);
    expect(seasons.map((s) => [s.key, s.startsAt])).toEqual([
      ["137", "2026-10-05T10:00:00.000Z"],
      ["136", "2026-09-07T10:00:00.000Z"],
      // The window's own season began before the record: no start named.
      ["135", null],
    ]);
  });

  test("the season before is the next one on record, read by its number (2026-10-20)", () => {
    const seasons = recordedSeasons(LISTED);
    const at = (key) => seasons.find((s) => s.key === key);
    expect(previousSeason(seasons, at("137"))).toMatchObject({
      key: "136",
      arg: 136,
      name: "Season 136",
      startsAt: "2026-09-07T10:00:00.000Z",
    });
    expect(previousSeason(seasons, at("136"))).toMatchObject({
      key: "135",
      arg: 135,
    });
    // The first season on record, or one older than the record: none.
    expect(previousSeason(seasons, at("135"))).toBeNull();
    expect(previousSeason(seasons, { key: "120" })).toBeNull();
    expect(previousSeason([], { key: "137" })).toBeNull();
    // The list is still being read: not yet known.
    expect(previousSeason(undefined, at("137"))).toBeUndefined();
    // A season with no war number is read by its month.
    expect(
      previousSeason(
        [
          { key: "2026-10", war: null, month: "2026-10" },
          { key: "2026-09", war: null, month: "2026-09" },
        ],
        { key: "2026-10" },
      ),
    ).toMatchObject({ arg: "2026-09" });
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

test("week rows run newest first, each a record, a share and its facts", () => {
  const rows = weekRows(WEEKLY, { running: true });
  expect(rows[0].label).toBe("Week of Sep 28 (so far)");
  expect(rows.at(-1).label).toBe("Week of Sep 7 (part of a week)");
  expect(rows[1].label).toBe("Week of Sep 21");
  expect(rows.at(-1).note).toBe("4–6 · 40% won · −6");
  expect(rows.at(-1).winShare).toBe(40);
  // Where trophies do not move, the note leaves net trophies out.
  expect(weekRows(WEEKLY, { net: false }).at(-1).note).toBe("4–6 · 40% won");
  // A week on a closed season is never "so far".
  expect(weekRows(WEEKLY)[0].label).toBe("Week of Sep 28 (part of a week)");
  expect(weekRows(undefined)).toEqual([]);
});

test("Other is two games read apart, and a chip only when it holds a battle", () => {
  expect(readModes("other")).toEqual(["challenge", "tournament"]);
  expect(readModes("war")).toEqual(["war"]);
  expect(modeWords("other")).toBe("Challenge and Tournament");
  expect(modeLabel("tournament")).toBe("Tournament");
  const keys = (modes, current) => modeChips(modes, current).map((m) => m.key);
  const five = ["ladder", "ranked", "war", "event", "casual"];
  expect(keys(undefined)).toEqual(five);
  expect(keys({ challenge: { battles: 0 } })).toEqual(five);
  expect(keys({ tournament: { battles: 2 } })).toEqual([...five, "other"]);
  // An address standing on Other keeps its chip.
  expect(keys({}, "other")).toEqual([...five, "other"]);
  expect(pickMode("other", {})).toBe("other");
  expect(pickMode("casual", {})).toBe("casual");
});

test("the war line says what the week holds, and never an out-of", () => {
  const current = {
    season_id: 138,
    section_index: 0,
    day_kind: "war",
    period: { source_observed_at: "2026-11-05T02:00:00Z" },
    standings: [{ clan_tag: "#X" }],
  };
  const weeks = [
    { season_id: 138, section_index: 0, decks_used: 12, points: 2150 },
    { season_id: 137, section_index: 3, decks_used: 16, points: 3000 },
  ];
  const line = warLine({ current, weeks, seasonWar: 138 });
  expect(line.line).toBe("This week: 12 war decks used, 2,150 points.");
  expect(line.at).toBe("2026-11-05T02:00:00Z");
  expect(line.note).toBe("Season 138, week 1");
  expect(line.line).not.toMatch(/ of /);
  expect(warLine({ current, weeks: [], seasonWar: 138 }).line).toBe(
    "No war decks used yet this week.",
  );
  expect(
    warLine({
      current: { ...current, day_kind: "training" },
      weeks,
      seasonWar: 138,
    }).line,
  ).toBe("This week: training days, so no war decks count yet.");
  // The game has not drawn this season's race: the last one is not this week.
  expect(warLine({ current, weeks, seasonWar: 139 }).line).toBe(
    "The game hasn't drawn this week's race yet.",
  );
  expect(
    warLine({ current: { ...current, standings: [] }, weeks, seasonWar: 138 })
      .line,
  ).toBe("The game hasn't drawn this week's race yet.");
  expect(
    warLine({
      current: { ...current, race_finished_at: "2026-11-05T01:00:00Z" },
      weeks,
      seasonWar: 138,
    }).finished,
  ).toBe(true);
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

describe("formRows: the form tables lay the tool's numbers out, never rate them", () => {
  const side = (over = {}) => ({
    battles: 31,
    decided_battles: 30,
    win_rate: 0.548,
    head_to_head_battles: 28,
    three_crown_rate: 0.214,
    net_trophies: 45,
    ...over,
  });
  test("each number sits over the battles it is over", () => {
    const rows = formRows(
      side(),
      side({
        battles: 112,
        decided_battles: 110,
        win_rate: 0.48,
        head_to_head_battles: 100,
        three_crown_rate: 0.15,
        net_trophies: -12,
      }),
    );
    expect(rows.map((r) => r.label)).toEqual([
      "Win rate",
      "Three-crown rate",
      "Net trophies",
    ]);
    expect(rows[0].cells).toEqual([
      { value: "55%", count: "30 battles" },
      { value: "48%", count: "110 battles" },
    ]);
    expect(rows[1].cells[0]).toEqual({ value: "21%", count: "28 battles" });
    expect(rows[2].cells).toEqual([
      { value: "+45", count: "31 battles" },
      { value: "−12", count: "112 battles" },
    ]);
  });
  test("a number the shaping dropped has no row, and nothing is a verdict", () => {
    const rows = formRows(
      side({ three_crown_rate: null, net_trophies: null }),
      side({ three_crown_rate: null, net_trophies: null }),
    );
    expect(rows.map((r) => r.key)).toEqual(["win_rate"]);
    expect(JSON.stringify(rows)).not.toMatch(/better|worse|improv|good|bad/i);
    expect(formRows(null, side())).toEqual([]);
  });
});

describe("seasonRows: this season beside the last, the tool's numbers laid out (2026-10-20)", () => {
  const side = (over = {}) => ({
    battles: 31,
    wins: 17,
    losses: 14,
    draws: 0,
    decided_battles: 31,
    win_rate: 0.548,
    net_trophies: 45,
    decks: 4,
    deck_battles: 31,
    ...over,
  });
  test("every side shows its counts, each number over the battles it is over", () => {
    const rows = seasonRows([
      side(),
      side({
        battles: 40,
        wins: 18,
        losses: 21,
        draws: 1,
        decided_battles: 39,
        win_rate: 0.462,
        net_trophies: -30,
        decks: 7,
        deck_battles: 40,
      }),
      side({ battles: 1, wins: 1, losses: 0, decided_battles: 1 }),
    ]);
    expect(rows.map((r) => r.label)).toEqual([
      "Won–lost",
      "Win rate",
      "Net trophies",
      "Decks played",
    ]);
    expect(rows[0].cells[0]).toEqual({
      value: "17–14",
      said: "17 won, 14 lost",
      count: "31 battles",
    });
    expect(rows[0].cells[1]).toMatchObject({
      value: "18–21–1",
      said: "18 won, 21 lost, 1 drawn",
    });
    expect(rows[0].cells[2].count).toBe("1 battle");
    expect(rows[1].cells[1]).toEqual({ value: "46%", count: "39 battles" });
    expect(rows[2].cells.map((c) => c.value)).toEqual(["+45", "−30", "+45"]);
    expect(rows[3].cells[1]).toEqual({ value: "7", count: "40 battles" });
  });
  test("net trophies only where every side has them; decks not read say so", () => {
    const rows = seasonRows([
      side({ net_trophies: null }),
      side({ net_trophies: null, decks: null, deck_battles: 0 }),
    ]);
    expect(rows.map((r) => r.key)).toEqual(["record", "win_rate", "decks"]);
    expect(rows[2].cells[1]).toEqual({ value: "—", count: "not read" });
    expect(JSON.stringify(rows)).not.toMatch(
      /better|worse|improv|good|bad|up |down |ahead|behind/i,
    );
  });
  test("one side, or a side the shaping dropped, is no table", () => {
    expect(seasonRows([side()])).toEqual([]);
    expect(seasonRows([side(), null])).toEqual([]);
    expect(seasonRows(undefined)).toEqual([]);
  });
});
