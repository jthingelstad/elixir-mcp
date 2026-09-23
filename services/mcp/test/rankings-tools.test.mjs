/**
 * The recorded leaderboards, read back (0068).
 *
 * Two snapshots an hour apart, then the questions the tools exist for:
 * the latest board, the board as it was before the movement (as_of), a
 * page past the first, the clans counted over the whole board with the
 * tie broken by best rank, and a location named by country code.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import {
  projectRankingBoard,
  projectClanBoard,
  projectEvents,
} from "../../ingest/src/rankings.mjs";
import { makeRegistry } from "../src/tools.mjs";
import { makeInvoker } from "../src/invoker.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_rankings_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);

let db;
let invoke;

const T1 = "2026-09-11T10:00:00Z";
const T2 = "2026-09-11T11:00:00Z";

const player = (rank, tag, name, elo, clan) => ({
  rank,
  tag,
  name,
  eloRating: elo,
  ...(clan ? { clan: { tag: clan[0], name: clan[1] } } : {}),
});

// Alpha has three rated, Beta and Gamma two each; Gamma's best is #1 and
// Beta's #4, so Gamma takes the tie. Zed has no clan.
const BOARD_1 = {
  items: [
    player(1, "#2G0GG", "g-one", 2200, ["#2GGGG", "Gamma"]),
    player(2, "#2P0PP", "a-one", 2150, ["#2PPPP", "Alpha"]),
    player(3, "#2P0P2", "a-two", 2100, ["#2PPPP", "Alpha"]),
    player(4, "#2Y0YY", "b-one", 2050, ["#2YYYY", "Beta"]),
    player(5, "#2P0P8", "a-three", 2000, ["#2PPPP", "Alpha"]),
    player(6, "#2G0G2", "g-two", 1950, ["#2GGGG", "Gamma"]),
    player(7, "#2Y0Y2", "b-two", 1900, ["#2YYYY", "Beta"]),
    player(8, "#2U0UU", "zed", 1850, null),
  ],
  paging: {},
};
// An hour later a-one takes #1.
const BOARD_2 = {
  items: [
    player(1, "#2P0PP", "a-one", 2210, ["#2PPPP", "Alpha"]),
    player(2, "#2G0GG", "g-one", 2200, ["#2GGGG", "Gamma"]),
    ...BOARD_1.items.slice(2),
  ],
  paging: {},
};

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.query(`create database ${NAME}`);
  await admin.end();
  await migrate({
    databaseUrl: DB_URL,
    migrationsDir: path.join(repoRoot, "db/migrations"),
  });
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  const {
    rows: [owner],
  } = await db.query(
    `insert into account (email_hash, status, is_owner) values ('rk-owner', 'approved', true) returning account_id`,
  );
  // The global board records its top 200 (seeded); keep the test's
  // recordings out of the way by reading a country board that records none.
  for (const [payload, at] of [
    [BOARD_1, T1],
    [BOARD_2, T2],
  ]) {
    await projectRankingBoard(db, {
      board: "pol",
      entityKey: "57000249",
      receiptId: null,
      payload,
      fetchedAt: at,
    });
  }
  // A clan ladder, two events days, and a season final (0069).
  await projectClanBoard(db, {
    board: "clans",
    entityKey: "global",
    receiptId: null,
    fetchedAt: T2,
    payload: {
      items: [
        {
          tag: "#2PPPP",
          name: "Alpha",
          rank: 1,
          previousRank: 2,
          clanScore: 90000,
          members: 50,
          badgeId: 7,
          location: { id: 57000249 },
        },
        {
          tag: "#2GGGG",
          name: "Gamma",
          rank: 2,
          previousRank: 1,
          clanScore: 89000,
          members: 49,
          badgeId: 8,
        },
      ],
      paging: {},
    },
  });
  await projectEvents(db, {
    fetchedAt: T1,
    payload: [
      { eventTag: "#R8U2RCJ", title: "C.H.A.O.S", description: "modifiers" },
      { eventTag: "#R8UURVL", title: "Merge Tactics", description: null },
    ],
  });
  await projectEvents(db, {
    fetchedAt: "2026-09-12T10:00:00Z",
    payload: [
      { eventTag: "#R8UURVL", title: "Merge Tactics", description: null },
    ],
  });
  // A third sighting before 10:00Z with its receipt on record: UTC day
  // 2026-09-13, game day 2026-09-12 (3.17.0, game_days_seen).
  const {
    rows: [gw],
  } = await db.query(
    `insert into gateway (owner_account_id, name, static_ip, status)
     values ($1, 'rk-gw', '127.0.0.1', 'active') returning gateway_id`,
    [owner.account_id],
  );
  // Every sighting comes from an admitted read, and game_events selects
  // by the reads inside its window (Gym #125), so each sighting above has
  // its receipt too.
  await db.query(
    `insert into api_receipt (endpoint, entity_key, fetched_at, payload_hash, gateway_id, admission)
     values ('events', 'GLOBAL', $2, 'h-events-1', $1, 'admitted'),
            ('events', 'GLOBAL', '2026-09-12T10:00:00Z', 'h-events-2', $1, 'admitted'),
            ('events', 'GLOBAL', '2026-09-13T04:00:00Z', 'h-events-3', $1, 'admitted')`,
    [gw.gateway_id, T1],
  );
  await projectEvents(db, {
    fetchedAt: "2026-09-13T04:00:00Z",
    payload: [
      { eventTag: "#R8UURVL", title: "Merge Tactics", description: null },
    ],
  });
  await projectRankingBoard(db, {
    board: "pol_final",
    entityKey: "135",
    receiptId: null,
    payload: {
      items: [player(1, "#2G0GG", "g-one", 3914, ["#2GGGG", "Gamma"])],
      paging: {},
    },
    fetchedAt: "2026-09-07T10:30:00Z",
    seasonId: "135",
    seasonMonth: "2026-08",
  });
  invoke = makeInvoker({
    db,
    account: {
      accountId: owner.account_id,
      isOwner: true,
      timezone: "UTC",
    },
    registry: makeRegistry(),
  });
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

test("rankings_players: the latest board, by country code, with the snapshot's own clocks", async () => {
  const { body, isError } = await invoke("rankings_players", {
    location: "US",
    limit: 3,
  });
  assert.equal(isError, false, JSON.stringify(body));
  assert.equal(body.location.key, "57000249");
  assert.equal(body.location.country_code, "US");
  assert.equal(body.snapshot.observed_at, new Date(T2).toISOString());
  assert.equal(body.snapshot.entries, 8);
  assert.equal(body.snapshot.truncated, false);
  assert.deepEqual(
    body.players.map((p) => [p.rank, p.player_tag, p.name, p.clan_name]),
    [
      [1, "#2P0PP", "a-one", "Alpha"],
      [2, "#2G0GG", "g-one", "Gamma"],
      [3, "#2P0P2", "a-two", "Alpha"],
    ],
  );
  assert.deepEqual(body.applied, {
    board: "pol",
    location: "57000249",
    limit: 3,
    offset: 0,
    verbosity: "full",
  });
  // A page remains, and the note says how to get it.
  assert.ok(body.notes.some((n) => n.includes("offset 3")));
  assert.equal(body.docs, "recording#leaderboards");
});

test("rankings_players: as_of reads the board before the movement", async () => {
  const { body, isError } = await invoke("rankings_players", {
    location: "57000249",
    as_of: "2026-09-11T10:30:00Z",
    limit: 2,
    verbosity: "compact",
  });
  assert.equal(isError, false, JSON.stringify(body));
  assert.equal(body.snapshot.observed_at, new Date(T1).toISOString());
  assert.deepEqual(body.players, [
    { rank: 1, player_tag: "#2G0GG", rating: 2200 },
    { rank: 2, player_tag: "#2P0PP", rating: 2150 },
  ]);
  assert.equal(body.applied.as_of, "2026-09-11T10:30:00.000Z");
});

test("rankings_players: a page past the first, and the tail past the end", async () => {
  const { body } = await invoke("rankings_players", {
    location: "US",
    limit: 3,
    offset: 6,
  });
  assert.deepEqual(
    body.players.map((p) => p.player_tag),
    ["#2Y0Y2", "#2U0UU"],
  );
  assert.ok(!body.notes.some((n) => n.startsWith("Page")), "no further page");
  const { body: past } = await invoke("rankings_players", {
    location: "US",
    offset: 50,
  });
  assert.deepEqual(past.players, []);
});

test("rankings_clans: counted over the whole board, ties to the best-placed player", async () => {
  const { body, isError } = await invoke("rankings_clans", {
    location: "US",
    limit: 2,
  });
  assert.equal(isError, false, JSON.stringify(body));
  assert.deepEqual(
    body.clans.map((c) => [
      c.rank,
      c.clan_name,
      c.rated_players,
      c.best_rank,
      c.best_player_name,
    ]),
    [
      [1, "Alpha", 3, 1, "a-one"],
      // Gamma and Beta both have two; Gamma's best is #2 to Beta's #4.
      [2, "Gamma", 2, 2, "g-one"],
    ],
  );
  assert.equal(body.clans_total, 3);
  assert.equal(body.players_without_clan, 1);
  assert.ok(body.notes.some((n) => n.includes("best_rank")));
  // The field the counts were taken over (3.16.0).
  assert.equal(body.field_size, 8);
  assert.ok(body.notes.some((n) => /field_size: 8/.test(n)));
});

test("rankings_clans: as_of sees the earlier tie broken the other way", async () => {
  // Before the movement Gamma's best was #1, still ahead of Beta's #4 -
  // but Alpha's best was #2, so the order of the top two is unchanged;
  // what as_of proves here is that the aggregate reads the older snapshot.
  const { body } = await invoke("rankings_clans", {
    location: "US",
    as_of: "2026-09-11",
    timezone: "UTC",
    limit: 3,
  });
  assert.equal(
    body.snapshot.observed_at,
    new Date(T2).toISOString(),
    "end of the 11th UTC is after both",
  );
  const { body: earlier } = await invoke("rankings_clans", {
    location: "US",
    as_of: "2026-09-11T10:15:00Z",
    limit: 3,
  });
  assert.equal(earlier.snapshot.observed_at, new Date(T1).toISOString());
  assert.equal(earlier.clans[0].clan_name, "Alpha");
  assert.equal(earlier.clans[0].best_rank, 2);
  assert.equal(earlier.clans[1].clan_name, "Gamma");
  assert.equal(earlier.clans[1].best_rank, 1);
});

test("a board nobody has recorded yet says so, and an unknown location refuses", async () => {
  const { body, isError } = await invoke("rankings_players", {
    location: "JP",
  });
  assert.equal(isError, false);
  assert.equal(body.snapshot, null);
  assert.deepEqual(body.players, []);
  assert.ok(body.notes.some((n) => n.includes("not been recorded yet")));

  const { body: bad, isError: refused } = await invoke("rankings_players", {
    location: "Narnia",
  });
  assert.equal(refused, true);
  assert.equal(bad.error.code, "not_found");
});

test("mode board discovery lists recorded ids and unknown modes give an executable hint", async () => {
  await db.query(`insert into ranking_board (board, location_key, label, location_kind)
    values ('mode', '170000019', 'Merge Tactics', 'global'),
           ('mode', '170000020', 'Touchdown', 'global')`);
  await db.query(
    `insert into poll_state (subject_tag, endpoint, last_admitted_at)
     values ('GLOBAL', 'leaderboards', $1)
     on conflict (subject_tag, endpoint) do update
     set last_admitted_at = excluded.last_admitted_at`,
    [T2],
  );
  const { body, isError } = await invoke("rankings_players", {
    board: "mode",
    location: "list",
  });
  assert.equal(isError, false, JSON.stringify(body));
  assert.deepEqual(
    body.boards.map((b) => [b.location, b.name]),
    [
      ["170000019", "Merge Tactics"],
      ["170000020", "Touchdown"],
    ],
  );
  assert.equal(body.applied.location, "list");
  assert.equal(
    body.meta.source_polls.leaderboards.observed_at,
    new Date(T2).toISOString(),
  );
  const missing = await invoke("rankings_players", {
    board: "mode",
    location: "999",
  });
  assert.equal(missing.body.error.code, "not_found");
  assert.match(
    missing.body.error.hint,
    /rankings_players\(\{ board: "mode", location: "list" \}\)/,
  );
  const live = await invoke("rankings_players", {
    board: "mode",
    location: "list",
    live: true,
  });
  assert.equal(live.body.error.code, "bad_request");
});

test("live: true and as_of together are refused rather than guessed between", async () => {
  const { body, isError } = await invoke("rankings_players", {
    live: true,
    as_of: "2026-09-10",
  });
  assert.equal(isError, true);
  assert.equal(body.error.code, "bad_request");
});

test("a season's final board is read by season, not by date", async () => {
  const { body, isError } = await invoke("rankings_players", {
    board: "pol_final",
    season: 135,
    limit: 5,
  });
  assert.equal(isError, false, JSON.stringify(body));
  assert.equal(body.applied.season, 135);
  assert.equal(body.snapshot.season_id, "135");
  assert.equal(
    body.snapshot.season_month,
    "2026-08",
    "the API's own name for the season rides beside the ordinal (0070)",
  );
  assert.deepEqual(
    body.players.map((p) => [p.rank, p.name, p.rating]),
    [[1, "g-one", 3914]],
  );

  // The API's month names the same final.
  const { body: byMonth } = await invoke("rankings_players", {
    board: "pol_final",
    season: "2026-08",
    limit: 1,
  });
  assert.equal(byMonth.applied.season, 135);
  assert.equal(byMonth.snapshot.season_id, "135");
  const { body: bad, isError: badErr } = await invoke("rankings_players", {
    board: "pol_final",
    season: "Minion Academy",
  });
  assert.equal(badErr, true);
  assert.equal(bad.error.code, "bad_request");

  const { body: live, isError: refused } = await invoke("rankings_players", {
    board: "pol_final",
    live: true,
  });
  assert.equal(refused, true);
  assert.equal(live.error.code, "bad_request");
});

test("rankings_clan_ladder: the clan-side board, with the game's own previous rank", async () => {
  const { body, isError } = await invoke("rankings_clan_ladder", {
    location: "global",
  });
  assert.equal(isError, false, JSON.stringify(body));
  assert.deepEqual(
    body.clans.map((c) => [
      c.rank,
      c.name,
      c.score,
      c.previous_rank,
      c.members,
    ]),
    [
      [1, "Alpha", 90000, 2, 50],
      [2, "Gamma", 89000, 1, 49],
    ],
  );
  assert.equal(body.clans[0].location_id, 57000249);
  assert.ok(body.notes.some((n) => n.includes("clan score")));
});

test("rankings_timeline: a player's rank at every snapshot, null when below the floor", async () => {
  const { body, isError } = await invoke("rankings_timeline", {
    player_tag: "#2P0PP",
    location: "US",
    from: "2026-09-11T00:00:00Z",
    to: "2026-09-11T23:59:59Z",
  });
  assert.equal(isError, false, JSON.stringify(body));
  assert.equal(body.applied.subject, "player");
  assert.deepEqual(
    body.points.map((p) => [p.observed_at, p.rank, p.rating]),
    [
      [new Date(T1).toISOString(), 2, 2150],
      [new Date(T2).toISOString(), 1, 2210],
    ],
  );
  // Somebody never on this board: two snapshots, both off_board.
  const { body: ghost } = await invoke("rankings_timeline", {
    player_tag: "#2LLLL",
    location: "US",
    from: "2026-09-11",
    to: "2026-09-11",
  });
  assert.deepEqual(
    ghost.points.map((p) => p.on_board),
    [false, false],
  );
});

test("rankings_timeline: the board's own curve - floor, summit, field", async () => {
  const { body } = await invoke("rankings_timeline", {
    location: "US",
    from: "2026-09-11",
    to: "2026-09-11",
  });
  assert.equal(body.applied.subject, "board");
  assert.deepEqual(
    body.points.map((p) => [p.rated_players, p.floor_rating, p.first.name]),
    [
      [8, 1850, "g-one"],
      [8, 1850, "a-one"],
    ],
  );
  assert.ok(!body.notes.some((n) => /nobody was rated/.test(n)));
  // A clan with no rated player at any point: the zero-series note fires
  // (3.16.0), so a flat 0 is not read as a flat field.
  const { body: none } = await invoke("rankings_timeline", {
    clan_tag: "#2LLLL",
    location: "US",
    from: "2026-09-11",
    to: "2026-09-11",
  });
  assert.ok(none.points.every((p) => p.rated_players === 0));
  assert.match(none.notes[0], /rated_players is 0 at every point/);
});

test("game_events: what was on, by the days it was seen", async () => {
  const { body, isError } = await invoke("game_events", {
    from: "2026-09-11",
    to: "2026-09-12",
  });
  assert.equal(isError, false, JSON.stringify(body));
  const merge = body.events.find((e) => e.title === "Merge Tactics");
  const chaos = body.events.find((e) => e.title === "C.H.A.O.S");
  assert.deepEqual(merge.game_days_seen, ["2026-09-11", "2026-09-12"]);
  assert.deepEqual(chaos.game_days_seen, ["2026-09-11"]);
  assert.ok(!("days_seen" in merge), "4.0.0: the UTC-day list is gone");
  assert.equal(body.latest_sighting_day, "2026-09-13");
  assert.equal(body.first_sighting_day, "2026-09-11");
  assert.ok(
    body.notes.some((n) => n.startsWith("Sightings began 2026-09-11")),
    "the horizon note reads the table",
  );
  assert.equal(merge.running_on_latest_day, true);
  assert.equal(chaos.running_on_latest_day, false);
});

test("game_events: game_days_seen puts the same sightings on the game day grid, and the window says its season (3.17.0, call 6)", async () => {
  const { body, isError } = await invoke("game_events", {
    from: "2026-09-11",
    to: "2026-09-13",
  });
  assert.equal(isError, false, JSON.stringify(body));
  const merge = body.events.find((e) => e.title === "Merge Tactics");
  // Three UTC days; the 04:00Z read on the 13th is game day the 12th,
  // and the two reads without a receipt keep their UTC day.
  assert.deepEqual(merge.game_days_seen, ["2026-09-11", "2026-09-12"]);
  assert.ok(!("days_seen" in merge));
  assert.equal(merge.running_on_latest_day, true);
  assert.ok("season" in body.applied.window);
  assert.ok(Array.isArray(body.applied.window.crosses));
  assert.ok(body.notes.some((n) => /game_days_seen is the game days/.test(n)));
});

test("rankings_timeline: every point carries its game day, and the window says its season (3.17.0)", async () => {
  const { body, isError } = await invoke("rankings_timeline", {
    player_tag: "#2P0PP",
    location: "US",
    from: "2026-09-11T00:00:00Z",
    to: "2026-09-11T23:59:59Z",
  });
  assert.equal(isError, false, JSON.stringify(body));
  // T1 is 10:00Z exactly: the first instant of game day 2026-09-11.
  assert.deepEqual(
    body.points.map((p) => p.day),
    ["2026-09-11", "2026-09-11"],
  );
  assert.ok("season" in body.applied.window);
  assert.ok(Array.isArray(body.applied.window.crosses));
  const board = await invoke("rankings_timeline", { location: "US" });
  assert.ok(board.body.points.every((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.day)));
});

// --- 6.2.0: the Elixir Gym's rankings run (feedback #71-#74, #76) ---------

test("rankings_timeline: a window before the horizon says so, and a clipped one carries covers (6.2.0, #72)", async () => {
  // The US board's first snapshot is T1 (2026-09-11T10:00Z). All of the
  // month before it: empty, and the note says unrecorded, not unchanged.
  const { body, isError } = await invoke("rankings_timeline", {
    location: "US",
    from: "2026-08-03",
    to: "2026-09-07",
  });
  assert.equal(isError, false, JSON.stringify(body));
  assert.deepEqual(body.points, []);
  assert.match(body.notes[0], /No snapshots exist before 2026-09-11/);
  assert.match(body.notes[0], /unrecorded for the window, not unchanged/);
  assert.equal(body.applied.window.partial, true);
  assert.equal(body.applied.window.covers, null);
  assert.equal(body.meta.recorded_since, new Date(T1).toISOString());

  // A straddling window: the series covers the horizon onward, and
  // covers says from where.
  const { body: clipped } = await invoke("rankings_timeline", {
    location: "US",
    from: "2026-09-06",
    to: "2026-09-11",
  });
  assert.equal(clipped.points.length, 2);
  assert.match(clipped.notes[0], /this window starts 2026-09-06/);
  assert.match(clipped.notes[0], /covers 2026-09-11 onward/);
  assert.equal(clipped.applied.window.partial, true);
  assert.equal(clipped.applied.window.covers.from, new Date(T1).toISOString());
  assert.equal(clipped.applied.window.covers.to, clipped.applied.window.to);

  // Inside the record: the guard stays quiet, as the 3.13.0 guards do.
  const { body: inside } = await invoke("rankings_timeline", {
    location: "US",
    from: "2026-09-11",
    to: "2026-09-11",
  });
  assert.ok(!inside.notes.some((n) => /No snapshots exist/.test(n)));
  assert.ok(!("partial" in inside.applied.window));
  assert.equal(inside.meta.recorded_since, new Date(T1).toISOString());

  // The sibling: rankings_players and rankings_clans name the horizon
  // from the table on an as_of before it; a never-recorded board still
  // offers the live read.
  const { body: asOf } = await invoke("rankings_players", {
    location: "US",
    as_of: "2026-08-15",
  });
  assert.equal(asOf.snapshot, null);
  assert.ok(
    asOf.notes.some((n) =>
      /on or before as_of; recording began 2026-09-11/.test(n),
    ),
  );
  const { body: clansAsOf } = await invoke("rankings_clans", {
    location: "US",
    as_of: "2026-08-15",
  });
  assert.ok(
    clansAsOf.notes.some((n) =>
      /on or before as_of; recording began 2026-09-11/.test(n),
    ),
  );
  const { body: never } = await invoke("rankings_clans", { location: "JP" });
  assert.ok(never.notes.some((n) => /live: true reads it/.test(n)));
  assert.ok(!("recorded_since" in never.meta));
});

test("pol_final: three seasons, three different notes; live is never offered; season is always echoed (6.2.0, #73)", async () => {
  const current = 136; // the fixture's clock is the real one: S136 runs through 2026-10-05
  const read = async (season) =>
    (await invoke("rankings_players", { board: "pol_final", season })).body;
  const future = await read(999);
  const pass = await read(87);
  const running = await read(current);
  const settledMissing = await read(120);
  for (const b of [future, pass, running, settledMissing]) {
    assert.equal(b.snapshot, null);
    assert.deepEqual(b.players, []);
    assert.equal(b.applied.season, null, "resolved: nothing");
    assert.ok(
      !b.notes.some((n) => /live: true/.test(n)),
      JSON.stringify(b.notes),
    );
    assert.ok(
      !b.notes.some((n) => /at most 1,000 places/.test(n)),
      "no live-board floor talk on a final",
    );
  }
  assert.equal(future.applied.season_requested, 999);
  assert.match(
    future.notes[0],
    /Season 999 has not happened; the current season is \d+/,
  );
  assert.equal(pass.applied.season_requested, 87);
  assert.match(
    pass.notes[0],
    /Season 87 is before the ranked ladder began \(S89, October 2022\)/,
  );
  assert.match(pass.notes[0], /in-game Pass/);
  assert.match(
    running.notes[0],
    /is in progress; its final board is fetched after it rolls on \d{4}-\d{2}-\d{2}/,
  );
  assert.match(
    settledMissing.notes[0],
    /Season 120's final board \(2025-05\) has not been recorded yet; it is on the schedule/,
  );
  assert.equal(
    new Set([
      future.notes[0],
      pass.notes[0],
      running.notes[0],
      settledMissing.notes[0],
    ]).size,
    4,
  );

  // The hit path is untouched: season resolves, and the request is echoed beside it.
  const hit = await read("2026-08");
  assert.equal(hit.applied.season, 135);
  assert.equal(hit.applied.season_requested, "2026-08");
  assert.equal(hit.snapshot.depth, 9999);
  assert.equal(hit.snapshot.full, false);
  assert.ok(hit.notes.some((n) => /top 9,999 places/.test(n)));
  assert.ok(
    !hit.notes.some((n) => /rating floor/.test(n)),
    "no floor talk on a final",
  );
});

test("a full board is labelled a cutoff, not a floor; a small one is the whole field (6.2.0, #71/#76)", async () => {
  // A country board at the API's 1,000 places, the tail a six-way tie,
  // then a day later the same 1,000 places with the cutoff up 53 and one
  // player who did not move falling 248 places (the #8LPQRV8R8 case).
  const JP = "57000122"; // the seeded Japan board
  // A tag per place over the CR tag alphabet (the normalizer refuses others).
  const ALPHABET = "0289PYLQGRJCUV";
  const tagFor = (n) =>
    "#2" +
    [n % 14, Math.floor(n / 14) % 14, Math.floor(n / 196) % 14]
      .map((d) => ALPHABET[d])
      .join("");
  const full = (shift) => ({
    items: Array.from({ length: 1000 }, (_, i) => {
      const rank = i + 1;
      // 2058 at the tail on day one; ratings fall 3 a place from the top.
      const rating =
        rank >= 995 ? 2058 + shift : 2058 + shift + (1000 - rank) * 3;
      return player(rank, tagFor(rank), `p${rank}`, rating, ["#2PPP2", "Full"]);
    }),
    paging: {},
  });
  const day1 = full(0);
  // Day two: the same players, everyone above the tail up 53; the tail
  // tie is cut at 1000 again, and one player keeps 2112 exactly.
  const day2 = {
    items: day1.items.map((p) => ({ ...p, eloRating: p.eloRating + 53 })),
    paging: {},
  };
  // (Clanless, so the clan's count reads 999 of a 1,000-place board.)
  day2.items[993] = {
    rank: 994,
    tag: "#8LPQRV8R8",
    name: "flat",
    eloRating: 2112,
  };
  await projectRankingBoard(db, {
    board: "pol",
    entityKey: JP,
    receiptId: null,
    payload: day1,
    fetchedAt: "2026-09-18T10:07:00Z",
  });
  await projectRankingBoard(db, {
    board: "pol",
    entityKey: JP,
    receiptId: null,
    payload: day2,
    fetchedAt: "2026-09-19T10:05:00Z",
  });

  const { body, isError } = await invoke("rankings_players", {
    location: "JP",
    offset: 990,
    limit: 20,
    verbosity: "compact",
  });
  assert.equal(isError, false, JSON.stringify(body));
  assert.equal(body.snapshot.entries, 1000);
  assert.equal(body.snapshot.depth, 1000);
  assert.equal(body.snapshot.full, true);
  assert.equal(body.snapshot.truncated, false, "the API offered no cursor");
  assert.equal(body.snapshot.floor_rating, 2111);
  assert.equal(body.players.at(-1).rank, 1000);
  assert.deepEqual(
    body.players.slice(-6).map((p) => p.rating),
    [2111, 2111, 2111, 2111, 2111, 2111],
  );
  const cutoff = body.notes.find((n) =>
    /holds 1,000 places and is full/.test(n),
  );
  assert.ok(cutoff, JSON.stringify(body.notes));
  assert.match(
    cutoff,
    /the API serves 1,000 and offered nothing past them \(truncated: false\)/,
  );
  assert.match(
    cutoff,
    /floor_rating \(2111\) is the last place's rating, a cutoff that moves, not a qualification threshold/,
  );
  assert.match(cutoff, /can leave the board without losing rating/);
  // The standing note no longer describes only the pre-cap regime.
  const floor = body.notes.find((n) => n.startsWith("Path of Legends lists"));
  assert.match(floor, /at most 1,000 places/);
  assert.match(floor, /once it holds 1,000 it is full/);
  assert.ok(!body.notes.some((n) => /fills through the month/.test(n)));

  // The unmoved player: rank 746 -> 994 on an unchanged 2112.
  const { body: line } = await invoke("rankings_timeline", {
    player_tag: "#8LPQRV8R8",
    location: "JP",
    from: "2026-09-18",
    to: "2026-09-19",
  });
  assert.deepEqual(
    line.points.map((p) => [p.rank, p.rating, p.on_board]),
    [
      [null, null, false],
      [994, 2112, true],
    ],
  );

  // The board curve: pinned at 1,000, the cutoff up 53, and the notes
  // say cutoff, depth and delta.
  const { body: curve } = await invoke("rankings_timeline", {
    location: "JP",
    from: "2026-09-18",
    to: "2026-09-19",
  });
  assert.deepEqual(
    curve.points.map((p) => [
      p.rated_players,
      p.floor_rating,
      p.floor_delta,
      p.full,
      p.depth,
    ]),
    [
      [1000, 2058, null, true, 1000],
      [1000, 2111, 53, true, 1000],
    ],
  );
  assert.ok(
    curve.notes.some((n) =>
      /2 of 2 points are at the board's full 1,000 places/.test(n),
    ),
  );
  assert.ok(
    curve.notes.some((n) =>
      /the cutoff for the last of its 1,000 places/.test(n),
    ),
  );
  assert.ok(!curve.notes.some((n) => /the tide of the season/.test(n)));

  // A clan's count carries the board's state beside it, and the note no
  // longer claims a monotone rise.
  const { body: clan } = await invoke("rankings_timeline", {
    clan_tag: "#2PPP2",
    location: "JP",
    from: "2026-09-18",
    to: "2026-09-19",
  });
  assert.deepEqual(
    clan.points.map((p) => [
      p.rated_players,
      p.board_full,
      p.board_floor_rating,
    ]),
    [
      [1000, true, 2058],
      [999, true, 2111],
    ],
  );
  assert.ok(
    clan.notes.some((n) =>
      /can fall while every one of the clan's players improves/.test(n),
    ),
  );
  assert.ok(!clan.notes.some((n) => /rises through a season/.test(n)));
  const { body: clans } = await invoke("rankings_clans", {
    location: "JP",
    limit: 1,
  });
  assert.equal(clans.snapshot.full, true);
  assert.equal(clans.snapshot.floor_rating, 2111);
  assert.ok(
    clans.notes.some((n) => /field_size: 1000, the board's full 1,000/.test(n)),
  );
  assert.ok(!clans.notes.some((n) => /rises through a season/.test(n)));

  // The control: Iceland's whole board is two players, and stays that way.
  const { body: small } = await invoke("rankings_players", {
    location: "US",
    limit: 2,
  });
  assert.equal(small.snapshot.entries, 8);
  assert.equal(small.snapshot.full, false);
  assert.equal(small.snapshot.floor_rating, 1850);
  assert.ok(!small.notes.some((n) => /places and is full/.test(n)));
});
