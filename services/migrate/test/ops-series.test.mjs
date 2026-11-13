import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { seriesStatus } from "../src/ops-series.mjs";
import {
  createScratch,
  dropScratch,
} from "../../../packages/ingest/test/helpers.mjs";

const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const SCRATCH = `elixir_mcp_test_series_${process.pid}`;
const SCRATCH_URL = ADMIN_URL.replace(/\/postgres$/, `/${SCRATCH}`);

let db;

before(async () => {
  await createScratch(SCRATCH);
  db = new pg.Client({ connectionString: SCRATCH_URL });
  await db.connect();
});

after(async () => {
  await db.end();
  await dropScratch(SCRATCH);
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
    `insert into player (player_tag) values ('#0VQRR8U0'), ('#0RY8UJUL')`,
  );
  await snap("#0VQRR8U0", "2026-09-09", "daily", "2026-09-09T23:00:00Z", 5000);
  await snap("#0VQRR8U0", "2026-09-10", "daily", "2026-09-10T15:00:00Z", 5010);
  await snap("#0RY8UJUL", "2026-09-10", "daily", "2026-09-10T12:00:00Z", 6000);
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
