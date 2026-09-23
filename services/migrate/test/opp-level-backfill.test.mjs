import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../src/migrate.mjs";
import { oppLevelBackfill } from "../src/deck-backfill.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const SCRATCH = `elixir_mcp_test_opplevel_${process.pid}`;
const SCRATCH_URL = ADMIN_URL.replace(/\/postgres$/, `/${SCRATCH}`);

let db;

// b1 1v1; b2 2v2 with one opponent's level unknown; b3 the other side has
// no level at all; b4 a boat with one side only.
const ROWS = [
  ["b1", "#2PP0V9PP", 0, 13.5],
  ["b1", "#2PP0V9QQ", 1, 14.25],
  ["b2", "#2PP0V9RR", 0, 12],
  ["b2", "#2PP0V9UU", 0, 13],
  ["b2", "#2PP0V9YY", 1, 15.5],
  ["b2", "#2PP0V9CC", 1, null],
  ["b3", "#2PP0V9GG", 0, 14],
  ["b3", "#2PP0V9JJ", 1, null],
  ["b4", "#2PP0V9LL", 0, 11],
];

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
  for (const id of ["b1", "b2", "b3", "b4"])
    await db.query(
      `insert into battle (battle_id, battle_time, type, type_class) values ($1, now(), 'PvP', 'pvp')`,
      [id],
    );
  for (const [battle, tag, side, level] of ROWS) {
    await db.query(
      `insert into player (player_tag) values ($1) on conflict do nothing`,
      [tag],
    );
    await db.query(
      `insert into battle_participant (battle_id, player_tag, side, deck_avg_level, battle_time, type, type_class)
       values ($1, $2, $3, $4, now(), 'PvP', 'pvp')`,
      [battle, tag, side, level],
    );
  }
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${SCRATCH} with (force)`);
  await admin.end();
});

test("opp_level_backfill stamps what the lateral computed, resumes by cursor, and a re-run writes nothing", async () => {
  // Two battles a batch: the cursor must carry across batches.
  const first = await oppLevelBackfill(SCRATCH_URL, { batch: 2 });
  assert.equal(first.done, true);
  assert.equal(first.battles, 4);
  assert.ok(first.batches >= 2);
  const { rows } = await db.query(
    `select bp.player_tag, bp.opp_deck_avg_level as stamped,
            (select avg(o.deck_avg_level) from battle_participant o
              where o.battle_id = bp.battle_id and o.side <> bp.side) as lateral
       from battle_participant bp order by bp.player_tag`,
  );
  for (const r of rows)
    assert.equal(
      r.stamped === null ? null : Number(r.stamped),
      r.lateral === null ? null : Number(r.lateral),
      r.player_tag,
    );
  const byTag = Object.fromEntries(rows.map((r) => [r.player_tag, r.stamped]));
  assert.equal(
    Number(byTag["#2PP0V9RR"]),
    15.5,
    "a null opponent is ignored, not zero",
  );
  assert.equal(
    Number(byTag["#2PP0V9YY"]),
    12.5,
    "2v2 takes the other side's mean",
  );
  assert.equal(byTag["#2PP0V9GG"], null, "no level on the other side: null");
  assert.equal(byTag["#2PP0V9LL"], null, "no other side: null");
  const again = await oppLevelBackfill(SCRATCH_URL, {});
  assert.equal(again.filled, 0);
});
