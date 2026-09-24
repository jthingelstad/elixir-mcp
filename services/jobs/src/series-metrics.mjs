/**
 * The daily series' growth, once a night ({series_metrics: true}, and
 * after {shape_census} in the same invocation; 2026-09-17). What the
 * roster and the profile wrote on the current game day, one row per kind
 * of writer, and the three series tables' sizes: the storage projection
 * in the time-series review (4.5) is a number here rather than a guess in
 * a document. Read-only against the tables; the caller logs what this
 * returns.
 */

import pg from "pg";

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

export async function seriesMetrics(databaseUrl) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query("set transaction_read_only = on");
    return await seriesStats(db);
  } finally {
    await db.end();
  }
}
