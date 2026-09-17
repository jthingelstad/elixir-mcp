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
  rebuildSeason,
  INCREMENT_LAG_MS,
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
  const { rows: pairs } = await db.query(
    `select card_a, form_a, card_b, form_b, co_battles, players from card_pair_season
     where season_month = $1 and mode_group = 'all' order by card_a, form_a, card_b, form_b`,
    [current.season_month],
  );
  // Knight+Archers three ways (-1/0, 0/-1, 0/0), Archers+Giant likewise.
  assert.equal(pairs.length, 6);
  assert.deepEqual(
    pairs.filter(
      (p) => p.card_a === 26000000 && p.form_a === 0 && p.form_b === 0,
    ),
    [
      {
        card_a: 26000000,
        form_a: 0,
        card_b: 26000001,
        form_b: 0,
        co_battles: 3,
        players: 2,
      },
    ],
  );
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
  // Tonight's rebuild settles the players.
  await rebuildSeason(db, current);
  const {
    rows: [knight],
  } = await db.query(
    `select players from deck_meta_season where season_month = $1 and mode_group = 'all' and deck_hash = $2`,
    [current.season_month, hashFor(KNIGHT)],
  );
  assert.equal(knight.players, 3);
});
