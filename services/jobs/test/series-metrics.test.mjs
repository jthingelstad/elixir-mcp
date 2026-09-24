import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { seriesStats } from "../src/series-metrics.mjs";
import { scratchDb } from "../../ingest/test/helpers.mjs";

let ctx;
before(async () => {
  ctx = await scratchDb("series_metrics");
});
after(async () => ctx.drop());

test("seriesStats reads today's rows by writer and the table sizes on the game day", async () => {
  const stats = await seriesStats(ctx.db);
  assert.match(stats.game_day, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(stats.snapshot_rows_today, 0);
  assert.equal(typeof stats.snapshot_table_mb, "number");
  await ctx.db.query(`insert into player (player_tag) values ('#2PP0V9QP')`);
  await ctx.db.query(
    `insert into player_snapshot_daily (player_tag, snapshot_date, snapshot_kind, observed_at, roster_observed_at, clan_tag)
     values ('#2PP0V9QP', game_day(now()), 'daily', now(), now(), null)`,
  );
  const after = await seriesStats(ctx.db);
  assert.equal(after.snapshot_rows_today, 1);
  assert.equal(after.roster_rows_today, 1);
  assert.equal(after.profile_rows_today, 0);
});
