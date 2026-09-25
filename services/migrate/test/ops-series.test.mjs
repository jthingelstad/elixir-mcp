import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../src/migrate.mjs";
import { seriesStatus } from "../src/ops-series.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const SCRATCH = `elixir_mcp_test_series_${process.pid}`;
const SCRATCH_URL = ADMIN_URL.replace(/\/postgres$/, `/${SCRATCH}`);

let db;

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
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${SCRATCH} with (force)`);
  await admin.end();
});

async function snap(tag, day, kind, observedAt, trophies) {
  await db.query(
    `insert into player_snapshot_daily
       (player_tag, snapshot_date, snapshot_kind, observed_at, trophies, wins)
     values ($1, $2, $3, $4, $5, 100)`,
    [tag, day, kind, observedAt, trophies],
  );
}

test("series_status reads the series tables and the receipts' worth", async () => {
  await db.query(
    `insert into player (player_tag) values ('#2PP0V9PP'), ('#2PP0V9QQ')`,
  );
  await snap("#2PP0V9PP", "2026-09-09", "daily", "2026-09-09T23:00:00Z", 5000);
  await snap("#2PP0V9PP", "2026-09-10", "daily", "2026-09-10T15:00:00Z", 5010);
  await snap("#2PP0V9QQ", "2026-09-10", "daily", "2026-09-10T12:00:00Z", 6000);
  const status = await seriesStatus(SCRATCH_URL, { hours: 24 });
  assert.equal(status.hours, 24);
  assert.equal(Number(status.player_snapshot_daily.rows), 3);
  assert.equal(Number(status.player_snapshot_daily.players), 2);
  assert.equal(Number(status.player_snapshot_daily.profile_only), 0);
  assert.equal(status.player_snapshot_daily.first_day, "2026-09-09");
  assert.equal(status.player_snapshot_daily.last_day, "2026-09-10");
  assert.equal(Number(status.clan_snapshot_daily.rows), 0);
  assert.deepEqual(status.receipts, []);
});
