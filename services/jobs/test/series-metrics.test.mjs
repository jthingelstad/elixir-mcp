import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { seriesEmf, seriesStats } from "../src/series-metrics.mjs";
import { scratchDb } from "../../ingest/test/helpers.mjs";

let ctx;
before(async () => {
  ctx = await scratchDb("series_metrics");
});
after(async () => ctx.drop());

test("seriesEmf: one undimensioned line; seven metrics, every number in the line", () => {
  const emf = JSON.parse(
    seriesEmf(
      {
        game_day: "2026-09-17",
        snapshot_rows_today: 5584,
        roster_rows_today: 5091,
        profile_rows_today: 881,
        clan_rows_today: 125,
        progress_rows_today: 236,
        snapshot_table_mb: 25.8,
      },
      1758100000000,
    ),
  );
  const decl = emf._aws.CloudWatchMetrics[0];
  assert.equal(decl.Namespace, "ElixirMCP/Series");
  assert.deepEqual(decl.Dimensions, [[]]);
  assert.equal(decl.Metrics.length, 7);
  assert.equal(emf.RosterRowsToday, 5091);
  assert.equal(emf.ClanTableMB, 0, "a missing number is 0, never NaN");
  assert.equal(emf.game_day, "2026-09-17");
});

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
