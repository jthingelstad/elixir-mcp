import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../src/migrate.mjs";
import { trainingBackfill } from "../src/ops-training.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const SCRATCH = `elixir_mcp_test_training_${process.pid}`;
const SCRATCH_URL = ADMIN_URL.replace(/\/postgres$/, `/${SCRATCH}`);
const CLAN = "#J2RGCRVG";
const ME = "#2PP0V9PP";
const MATE = "#2PP0V9UU";
const OPP = "#2PP0V9QQ";
let db;

async function battle(id, type, at, rows) {
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class) values ($1, $2, $3, 'pvp')`,
    [id, at, type],
  );
  for (const [tag, side, clan, rounds] of rows) {
    await db.query(
      `insert into battle_participant (battle_id, player_tag, side, outcome, crowns, battle_time, type, type_class, clan_tag)
       values ($1, $2, $3, 'win', 1, $4, $5, 'pvp', $6)`,
      [id, tag, side, at, type, clan],
    );
    for (let r = 1; r <= rounds; r += 1)
      await db.query(
        `insert into battle_participant_round (battle_id, player_tag, round, crowns) values ($1, $2, $3, 0)`,
        [id, tag, r],
      );
  }
}

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`create database ${SCRATCH}`);
  await admin.end();
  await migrate({
    databaseUrl: SCRATCH_URL,
    migrationsDir: path.join(repoRoot, "db/migrations"),
  });
  db = new pg.Client({ connectionString: SCRATCH_URL });
  await db.connect();
  await db.query(`insert into clan (clan_tag) values ($1)`, [CLAN]);
  for (const tag of [ME, MATE, OPP])
    await db.query(`insert into player (player_tag) values ($1)`, [tag]);
  await db.query(
    `insert into war_week (clan_tag, season_id, section_index) values ($1, 136, 1)`,
    [CLAN],
  );
  for (const tag of [ME, MATE])
    await db.query(
      `insert into war_participation (clan_tag, season_id, section_index, player_tag) values ($1, 136, 1, $2)`,
      [CLAN, tag],
    );
  // S136 section 1 opens Monday 2026-09-14 10:00Z: training days 1-3.
  await battle("t1", "riverRacePvP", "2026-09-14T12:00:00Z", [
    [ME, 0, CLAN, 0],
    [OPP, 1, "#9Q9QRCPP", 0],
  ]);
  await battle("t2", "riverRaceDuel", "2026-09-14T13:00:00Z", [
    [ME, 0, CLAN, 3],
    [OPP, 1, "#9Q9QRCPP", 3],
  ]);
  await battle("t3", "riverRacePvP", "2026-09-14T14:00:00Z", [
    [ME, 0, CLAN, 0],
  ]);
  // Training day 2: the poll already saw MATE; the backfill must not touch it.
  await battle("t4", "riverRacePvP", "2026-09-15T12:00:00Z", [
    [MATE, 0, CLAN, 0],
  ]);
  await db.query(
    `insert into war_attendance_day (clan_tag, season_id, section_index, day_in_section, player_tag, decks_used_today)
     values ($1, 136, 1, 1, $2, 3)`,
    [CLAN, MATE],
  );
  // The race closes at 09:38Z (Gym #306): a 09:50Z battle on the 15th is
  // training day 2 in the game, though the 10:00Z grid says day 1.
  await db.query(
    `update war_week set closed_at = '2026-09-21T09:38:05Z' where clan_tag = $1 and season_id = 136 and section_index = 1`,
    [CLAN],
  );
  await battle("t5", "riverRacePvP", "2026-09-15T09:50:00Z", [
    [ME, 0, CLAN, 0],
  ]);
  // A war day battle is not practice.
  await battle("w1", "riverRacePvP", "2026-09-17T12:00:00Z", [
    [ME, 0, CLAN, 0],
  ]);
});

after(async () => {
  await db?.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${SCRATCH} with (force)`);
  await admin.end();
});

test("dry run counts practice decks without writing", async () => {
  const r = await trainingBackfill(SCRATCH_URL, { season_id: 136 });
  assert.equal(r.apply, false);
  assert.equal(r.inserted, 0);
  // MATE's poll row (3) against one rebuilt deck.
  assert.deepEqual(r.vs_poll, {
    rows: 1,
    equal: 0,
    rebuilt_lower: 1,
    rebuilt_higher: 0,
  });
  // ME: day 1 1 + 3 + 1 = 5, capped at 4; day 2 1 (t5); MATE: 1.
  assert.deepEqual(r.weeks, [
    {
      section_index: 1,
      clans: 1,
      member_days: 3,
      decks: 6,
      duels_without_rounds: 0,
    },
  ]);
});

test("apply writes battlelog rows, only for race participants, never over a poll row", async () => {
  const r = await trainingBackfill(SCRATCH_URL, {
    season_id: 136,
    apply: true,
  });
  assert.equal(r.inserted, 2);
  const { rows } = await db.query(
    `select player_tag, day_in_section, decks_used_today, source from war_attendance_day order by player_tag, day_in_section`,
  );
  assert.deepEqual(rows, [
    {
      player_tag: ME,
      day_in_section: 0,
      decks_used_today: 4,
      source: "battlelog",
    },
    {
      player_tag: ME,
      day_in_section: 1,
      decks_used_today: 1,
      source: "battlelog",
    },
    {
      player_tag: MATE,
      day_in_section: 1,
      decks_used_today: 3,
      source: "poll",
    },
  ]);
  const again = await trainingBackfill(SCRATCH_URL, {
    season_id: 136,
    apply: true,
  });
  assert.equal(again.inserted, 0, "idempotent");
});
