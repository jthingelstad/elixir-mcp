/**
 * The season meta rollups (0121) over a scratch database: the nightly
 * rebuild counts what the meta tools count (the tools2 test pins the two
 * paths equal on the fixture corpus; this one pins the mechanics), the
 * hourly increment adds only battles created since the cursor and never
 * touches `players`, and an ended season is filled once and marked final.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import { ensureSeasonsAround, seasonAt } from "../../ingest/src/season.mjs";
import { seedDeck, hashFor } from "../../mcp/test/deck-rows.mjs";
import {
  metaRollupNightly,
  metaRollupHourly,
  metaRollupEquivalence,
  rebuildSeason,
  INCREMENT_LAG_MS,
  SEAL_AFTER_MS,
} from "../src/meta-rollup.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_meta_rollup_${process.pid}`;
const URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);

let db;
const NOW = Date.now();
const A = "#2PPPP";
const B = "#2QQQQ";
const KNIGHT = [
  { id: 26000000, name: "Knight" },
  { id: 26000001, name: "Archers" },
];
const GIANT = [
  { id: 26000003, name: "Giant" },
  { id: 26000001, name: "Archers" },
];

async function battle(
  id,
  tag,
  cards,
  outcome,
  atMs,
  { type = "PvP", createdAt = null } = {},
) {
  const at = new Date(atMs);
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class, created_at)
     values ($1, $2, $3, 'pvp', coalesce($4, now()))`,
    [id, at, type, createdAt ? new Date(createdAt) : null],
  );
  const hash = await seedDeck(db, { battle_time: at, cards });
  await db.query(
    `insert into battle_participant (battle_id, player_tag, side, battle_time, outcome, deck_hash, type, type_class)
     values ($1, $2, 0, $3, $4, $5, $6, 'pvp')`,
    [id, tag, at, outcome, hash, type],
  );
}

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.query(`create database ${NAME}`);
  await admin.end();
  await migrate({
    databaseUrl: URL,
    migrationsDir: path.join(repoRoot, "db/migrations"),
  });
  db = new pg.Client({ connectionString: URL });
  await db.connect();
  await ensureSeasonsAround(db, NOW);
  for (const t of [A, B])
    await db.query(`insert into player (player_tag) values ($1)`, [t]);
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

test("nightly: the running season is rebuilt with distinct players; an ended season is filled once and final", async () => {
  const current = await seasonAt(db, NOW);
  const start = current.starts_at.getTime();
  // Three decided ladder battles in the running season (two pilots on
  // the Knight deck), one draw, one ranked; and two in the season before.
  await battle("cur-1", A, KNIGHT, "win", start + 3600_000);
  await battle("cur-2", A, KNIGHT, "loss", start + 7200_000);
  await battle("cur-3", B, KNIGHT, "win", start + 10800_000);
  await battle("cur-4", A, GIANT, "draw", start + 14400_000);
  await battle("cur-5", B, GIANT, "win", start + 18000_000, {
    type: "pathOfLegend",
  });
  await battle("prev-1", A, KNIGHT, "win", start - 86400_000 * 3);
  await battle("prev-2", B, GIANT, "loss", start - 86400_000 * 2);
  const empty = await metaRollupHourly(URL, { nowMs: NOW });
  assert.equal(
    empty.reason,
    "no_rollup_yet",
    "nothing to increment before the first rebuild",
  );

  const night = await metaRollupNightly(URL, { nowMs: NOW });
  const months = night.rebuilt.map((r) => [r.season_month, r.final]);
  const prev = await seasonAt(db, start - 1);
  assert.deepEqual(months, [
    [current.season_month, false],
    [prev.season_month, true],
  ]);
  const { rows: decks } = await db.query(
    `select mode_group, deck_hash, battles, wins, losses, players from deck_meta_season
     where season_month = $1 order by mode_group, battles desc`,
    [current.season_month],
  );
  const knight = hashFor(KNIGHT);
  const giant = hashFor(GIANT);
  assert.deepEqual(decks, [
    {
      mode_group: "all",
      deck_hash: knight,
      battles: 3,
      wins: 2,
      losses: 1,
      players: 2,
    },
    {
      mode_group: "all",
      deck_hash: giant,
      battles: 1,
      wins: 1,
      losses: 0,
      players: 1,
    },
    {
      mode_group: "ladder",
      deck_hash: knight,
      battles: 3,
      wins: 2,
      losses: 1,
      players: 2,
    },
    {
      mode_group: "ranked",
      deck_hash: giant,
      battles: 1,
      wins: 1,
      losses: 0,
      players: 1,
    },
  ]);
  const { rows: totals } = await db.query(
    `select mode_group, considered, draws, decided, wins from meta_season_totals
     where season_month = $1 order by mode_group`,
    [current.season_month],
  );
  assert.deepEqual(totals, [
    { mode_group: "all", considered: 5, draws: 1, decided: 4, wins: 3 },
    { mode_group: "ladder", considered: 4, draws: 1, decided: 3, wins: 2 },
    { mode_group: "ranked", considered: 1, draws: 0, decided: 1, wins: 1 },
  ]);
  // Cards: Archers is in both decks (4 decided, 2 players); form -1 is
  // the any-form row, equal to form 0 here.
  const { rows: archers } = await db.query(
    `select form, battles, players from card_meta_season
     where season_month = $1 and mode_group = 'all' and card_id = 26000001 order by form`,
    [current.season_month],
  );
  assert.deepEqual(archers, [
    { form: -1, battles: 4, players: 2 },
    { form: 0, battles: 4, players: 2 },
  ]);
  const { rows: state } = await db.query(
    `select season_month, final, rebuilt_at is not null as rebuilt from meta_season_state order by 1`,
  );
  assert.deepEqual(
    Object.fromEntries(
      state.map((s) => [s.season_month, [s.final, s.rebuilt]]),
    ),
    {
      [prev.season_month]: [true, true],
      [current.season_month]: [false, true],
    },
  );
  // The second night touches the running season only: the ended one is final.
  const again = await metaRollupNightly(URL, { nowMs: NOW });
  assert.deepEqual(
    again.rebuilt.map((r) => r.season_month),
    [current.season_month],
  );
});

test("hourly: battles created since the cursor add to the counters; players wait for the night", async () => {
  const current = await seasonAt(db, NOW);
  const start = current.starts_at.getTime();
  const {
    rows: [{ counters_through: before }],
  } = await db.query(
    `select counters_through from meta_season_state where season_month = $1`,
    [current.season_month],
  );
  // Created "now", so after the cursor the rebuild set; one more Knight
  // win by a THIRD pilot and a brand-new deck.
  const later = Date.now() + 1000;
  await db.query(`insert into player (player_tag) values ('#2RRRR')`);
  await battle("inc-1", "#2RRRR", KNIGHT, "win", start + 20000_000, {
    createdAt: later,
  });
  await battle(
    "inc-2",
    A,
    [{ id: 26000004, name: "Baby Dragon" }],
    "loss",
    start + 21000_000,
    {
      createdAt: later,
    },
  );
  const tooSoon = await metaRollupHourly(URL, { nowMs: later + 1000 });
  assert.equal(tooSoon.battles, 0, "inside the lag nothing is read yet");
  const run = await metaRollupHourly(URL, {
    nowMs: later + INCREMENT_LAG_MS + 60_000,
  });
  assert.equal(run.battles, 2);
  const { rows: decks } = await db.query(
    `select deck_hash, battles, wins, losses, players from deck_meta_season
     where season_month = $1 and mode_group = 'all' order by battles desc`,
    [current.season_month],
  );
  assert.deepEqual(decks, [
    { deck_hash: hashFor(KNIGHT), battles: 4, wins: 3, losses: 1, players: 2 },
    { deck_hash: hashFor(GIANT), battles: 1, wins: 1, losses: 0, players: 1 },
    {
      deck_hash: hashFor([{ id: 26000004 }]),
      battles: 1,
      wins: 0,
      losses: 1,
      players: null,
    },
  ]);
  const {
    rows: [{ decided, wins }],
  } = await db.query(
    `select decided, wins from meta_season_totals where season_month = $1 and mode_group = 'all'`,
    [current.season_month],
  );
  assert.deepEqual({ decided, wins }, { decided: 6, wins: 4 });
  const {
    rows: [{ counters_through: after }],
  } = await db.query(
    `select counters_through from meta_season_state where season_month = $1`,
    [current.season_month],
  );
  assert.ok(after > before, "the cursor moved");
  // Idempotent past the cursor.
  const nothing = await metaRollupHourly(URL, {
    nowMs: later + INCREMENT_LAG_MS + 120_000,
  });
  assert.equal(nothing.battles, 0);
  // Tonight's rebuild settles the players (its cursor past the rows'
  // created_at, as tonight is).
  await rebuildSeason(db, current, {
    nowMs: later + INCREMENT_LAG_MS + 180_000,
  });
  const {
    rows: [knight],
  } = await db.query(
    `select players from deck_meta_season where season_month = $1 and mode_group = 'all' and deck_hash = $2`,
    [current.season_month, hashFor(KNIGHT)],
  );
  assert.equal(knight.players, 3);
});

test("hourly: the war-calendar guard counts war-typed battles outside every period and emits the metric", async () => {
  const { warBattlesUnresolved, warUnresolvedEmf } =
    await import("../src/meta-rollup.mjs");
  const before = await warBattlesUnresolved(db);
  assert.equal(before, 0, "every seeded war battle sits in a period");
  // A war battle in a season the calendar does not hold (the seed ends
  // at 2026-10; a scheduler that stopped would leave such a gap).
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class) values ('gap-1', now() - interval '1 day', 'riverRacePvP', 'pvp')`,
  );
  await db.query(
    `delete from war_period where starts_at <= now() - interval '1 day' and ends_at > now() - interval '1 day'`,
  );
  assert.equal(await warBattlesUnresolved(db), 1);
  const lines = [];
  await metaRollupHourly(URL, { emitMetrics: (l) => lines.push(l) });
  const emf = JSON.parse(lines[0]);
  assert.equal(emf._aws.CloudWatchMetrics[0].Namespace, "ElixirMCP/Record");
  assert.equal(
    emf._aws.CloudWatchMetrics[0].Metrics[0].Name,
    "WarBattleUnresolved",
  );
  assert.equal(emf.WarBattleUnresolved, 1);
  assert.equal(JSON.parse(warUnresolvedEmf(0)).WarBattleUnresolved, 0);
});

test("the population table (0140): days build and seal, a late battle lands in its sealed day, the aggregates equal a raw rebuild, the final path drops the rows", async () => {
  const current = await seasonAt(db, NOW);
  const month = current.season_month;
  const start = current.starts_at.getTime();
  const DAY = 86_400_000;
  // The nights so far built every game day from the start to now; the
  // ones whose end is a day behind the cursor are sealed.
  const { rows: ledger } = await db.query(
    `select game_day::text as day, rows, sealed from meta_season_pop_day
      where season_month = $1 order by 1`,
    [month],
  );
  const {
    rows: [{ pop_through }],
  } = await db.query(
    `select pop_through from meta_season_state where season_month = $1`,
    [month],
  );
  const cursorMs = pop_through.getTime();
  const expectDays = Math.ceil((cursorMs - start) / DAY);
  assert.equal(
    ledger.length,
    expectDays,
    "one ledger row per game day to the cursor",
  );
  const expectSealed = ledger.filter(
    (_, i) => start + (i + 1) * DAY + SEAL_AFTER_MS <= cursorMs,
  ).length;
  assert.equal(ledger.filter((r) => r.sealed).length, expectSealed);
  assert.equal(ledger[0].sealed, true, "day 0 is sealed");
  assert.equal(
    ledger[0].day,
    new Date(start - 10 * 3600_000).toISOString().slice(0, 10),
  );
  // Day 0 holds the test's five battles plus the hourly test's two, all
  // pvp with a deck; the table is the aggregates' population.
  assert.equal(ledger[0].rows, 7);
  const {
    rows: [{ n: popRows }],
  } = await db.query(
    `select count(*)::int as n from meta_season_pop where season_month = $1`,
    [month],
  );
  assert.equal(popRows, 7);

  // A battle played on day 0 (sealed) but recorded only now: the next
  // night appends it and counts it; the sealed day is not rebuilt.
  const later = cursorMs + 60_000;
  await battle("late-1", B, GIANT, "win", start + 30_000_000, {
    createdAt: later,
  });
  const night = await rebuildSeason(db, current, { nowMs: later + 60_000 });
  assert.equal(
    night.days.late,
    1,
    "the late battle appended to its sealed day",
  );
  assert.equal(
    night.days.built,
    expectDays - expectSealed,
    "only the unsealed days rebuilt",
  );
  const {
    rows: [{ decided }],
  } = await db.query(
    `select decided from meta_season_totals where season_month = $1 and mode_group = 'all'`,
    [month],
  );
  assert.equal(decided, 7, "6 decided before, the late one counted");
  const {
    rows: [giant],
  } = await db.query(
    `select battles, wins, players from deck_meta_season
      where season_month = $1 and mode_group = 'all' and deck_hash = $2`,
    [month, hashFor(GIANT)],
  );
  assert.deepEqual(giant, { battles: 2, wins: 2, players: 1 });

  // The proof: the raw rows bounded at pop_through give the same
  // population and the same six tables, row for row.
  const eq = await metaRollupEquivalence(URL, { nowMs: NOW });
  assert.equal(eq.season_month, month);
  assert.equal(eq.hourly_ran, false);
  assert.deepEqual(eq.pop, {
    raw_rows: 8,
    pop_rows: 8,
    raw_not_in_pop: 0,
    pop_not_in_raw: 0,
    differing: 0,
  });
  for (const [table, t] of Object.entries(eq.tables))
    assert.equal(t.equal, true, `${table}: ${JSON.stringify(t)}`);
  assert.ok(eq.tables.deck_meta_season.live_rows > 0);

  // The final path builds the same way and drops the rows after.
  const fin = await rebuildSeason(db, current, {
    final: true,
    nowMs: later + 120_000,
  });
  assert.equal(fin.final, true);
  assert.equal(fin.days.dropped, expectDays);
  const {
    rows: [{ n: after }],
  } = await db.query(
    `select count(*)::int as n from meta_season_pop where season_month = $1`,
    [month],
  );
  assert.equal(after, 0);
  assert.equal(
    (
      await db.query(
        `select count(*)::int as n from meta_season_pop_day where season_month = $1`,
        [month],
      )
    ).rows[0].n,
    0,
  );
  const {
    rows: [{ decided: finalDecided }],
  } = await db.query(
    `select decided from meta_season_totals where season_month = $1 and mode_group = 'all'`,
    [month],
  );
  assert.equal(finalDecided, 7, "the final rollup counts the same population");
  // Un-final it for the tests that follow (none rebuild; kept honest).
  await db.query(
    `update meta_season_state set final = false where season_month = $1`,
    [month],
  );
});
