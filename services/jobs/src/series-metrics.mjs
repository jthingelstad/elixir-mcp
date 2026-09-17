/**
 * The daily series' growth as one EMF line a night ({series_metrics:
 * true}, and after {shape_census} in the same invocation; 2026-09-17,
 * for the elixir-mcp dashboard). What the roster and the profile wrote
 * on the current game day, one row per kind of writer, and the three
 * series tables' sizes: the storage projection in the time-series
 * review (4.5) is a number here rather than a guess in a document.
 * Read-only against the tables; stdout EMF like every other emitter.
 */

import pg from "pg";

const NAMESPACE = "ElixirMCP/Series";

export function seriesEmf(stats, now = Date.now()) {
  return JSON.stringify({
    _aws: {
      Timestamp: now,
      CloudWatchMetrics: [
        {
          Namespace: NAMESPACE,
          Dimensions: [[]],
          Metrics: [
            { Name: "SnapshotRowsToday", Unit: "Count" },
            { Name: "RosterRowsToday", Unit: "Count" },
            { Name: "ProfileRowsToday", Unit: "Count" },
            { Name: "ClanRowsToday", Unit: "Count" },
            { Name: "ProgressRowsToday", Unit: "Count" },
            { Name: "SnapshotTableMB", Unit: "Megabytes" },
            { Name: "ClanTableMB", Unit: "Megabytes" },
            { Name: "ProgressTableMB", Unit: "Megabytes" },
          ],
        },
      ],
    },
    SnapshotRowsToday: stats.snapshot_rows_today ?? 0,
    RosterRowsToday: stats.roster_rows_today ?? 0,
    ProfileRowsToday: stats.profile_rows_today ?? 0,
    ClanRowsToday: stats.clan_rows_today ?? 0,
    ProgressRowsToday: stats.progress_rows_today ?? 0,
    SnapshotTableMB: stats.snapshot_table_mb ?? 0,
    ClanTableMB: stats.clan_table_mb ?? 0,
    ProgressTableMB: stats.progress_table_mb ?? 0,
    game_day: stats.game_day ?? null,
  });
}

/** The numbers, read once. `db` is injectable for the test. */
export async function seriesStats(db) {
  const { rows } = await db.query(
    `select game_day(now())::text as game_day,
       (select count(*)::int from player_snapshot_daily
         where snapshot_date = game_day(now()) and snapshot_kind = 'daily') as snapshot_rows_today,
       (select count(*)::int from player_snapshot_daily
         where snapshot_date = game_day(now()) and snapshot_kind = 'daily'
           and roster_observed_at is not null) as roster_rows_today,
       (select count(*)::int from player_snapshot_daily
         where snapshot_date = game_day(now()) and snapshot_kind = 'daily'
           and profile_observed_at is not null) as profile_rows_today,
       (select count(*)::int from clan_snapshot_daily
         where day = game_day(now()) and snapshot_kind = 'daily') as clan_rows_today,
       (select count(*)::int from player_progress_daily
         where day = game_day(now()) and snapshot_kind = 'daily') as progress_rows_today,
       round(pg_total_relation_size('player_snapshot_daily') / 1048576.0, 1)::float as snapshot_table_mb,
       round(pg_total_relation_size('clan_snapshot_daily') / 1048576.0, 1)::float as clan_table_mb,
       round(pg_total_relation_size('player_progress_daily') / 1048576.0, 1)::float as progress_table_mb`,
  );
  return rows[0];
}

export async function seriesMetrics(databaseUrl, deps = {}) {
  const emitMetrics =
    deps.emitMetrics ?? ((line) => process.stdout.write(line));
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query("set transaction_read_only = on");
    const stats = await seriesStats(db);
    emitMetrics(`${seriesEmf(stats, deps.now ?? Date.now())}\n`);
    return stats;
  } finally {
    await db.end();
  }
}
