import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../src/migrate.mjs";
import { duelOutcomeRepair } from "../src/ops-diagnostics.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const SCRATCH = `elixir_mcp_test_duel_${process.pid}`;
const SCRATCH_URL = ADMIN_URL.replace(/\/postgres$/, `/${SCRATCH}`);
const ME = "#2PP0V9PP";
const OPP = "#2PP0V9QQ";
const AT = "2026-09-20T12:00:00Z";
let db;

async function duel(id, mine, theirs, recorded) {
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class)
     values ($1, $2, 'riverRaceDuel', 'pvp')`,
    [id, AT],
  );
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  for (const [tag, side, rounds, outcome] of [
    [ME, 0, mine, recorded],
    [OPP, 1, theirs, { win: "loss", loss: "win", draw: "draw" }[recorded]],
  ]) {
    await db.query(
      `insert into battle_participant (battle_id, player_tag, side, outcome, crowns, battle_time, type, type_class)
       values ($1, $2, $3, $4, $5, $6, 'riverRaceDuel', 'pvp')`,
      [id, tag, side, outcome, sum(rounds), AT],
    );
    for (const [i, c] of rounds.entries())
      await db.query(
        `insert into battle_participant_round (battle_id, player_tag, round, crowns) values ($1, $2, $3, $4)`,
        [id, tag, i + 1, c],
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
  for (const tag of [ME, OPP])
    await db.query(`insert into player (player_tag) values ($1)`, [tag]);
  await duel("d1", [0, 1, 1], [3, 0, 0], "loss"); // won 2-1 on games
  await duel("d2", [3, 0, 0], [1, 1, 1], "draw"); // lost 1-2 on games
  await duel("d3", [2, 1], [0, 0], "win"); // right already
  await duel("d4", [1, 0], [0, 1], "loss"); // games tie: left alone
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${SCRATCH} with (force)`);
  await admin.end();
});

test("duel_outcome_repair recomputes duels from games won and re-derives the day's rollup", async () => {
  const dry = await duelOutcomeRepair(SCRATCH_URL, {});
  assert.equal(dry.dry_run, true);
  assert.equal(dry.battles, 2, "d1 and d2, both sides");
  assert.equal(dry.rows, 4);
  const done = await duelOutcomeRepair(SCRATCH_URL, { apply: true });
  assert.equal(done.rows, 4);
  const { rows } = await db.query(
    `select battle_id, outcome from battle_participant where player_tag = $1 order by battle_id`,
    [ME],
  );
  assert.deepEqual(
    rows.map((r) => r.outcome),
    ["win", "loss", "win", "loss"],
  );
  const {
    rows: [roll],
  } = await db.query(
    `select sum(wins)::int w, sum(losses)::int l, sum(draws)::int d
       from player_daily_battle_rollup where player_tag = $1 and day = '2026-09-20'`,
    [ME],
  );
  assert.deepEqual(roll, { w: 2, l: 2, d: 0 });
  const again = await duelOutcomeRepair(SCRATCH_URL, { apply: true });
  assert.equal(again.rows, 0);
});
