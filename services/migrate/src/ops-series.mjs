/**
 * The daily series status op. The archive backfill that filled the
 * series tables, its self census and the series EXPLAIN retired on
 * 2026-11-13 with their cursor table (0256).
 */

import pg from "pg";

/**
 * {series_status: {hours?: 1}} - read-only: the series tables' row
 * counts and day spans, the snapshot table split by writer (roster-only,
 * profile-only, both), and what the last N hours of admitted clan and
 * player receipts were worth (new_facts) now that a roster poll counts
 * the members that moved. The Phase 1 NOTES numbers and Phase 2's
 * before/after.
 */
export async function seriesStatus(databaseUrl, spec = {}) {
  const hours = Math.min(Math.max(Number(spec.hours ?? 1), 1), 168);
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query("set transaction_read_only = on");
    const {
      rows: [tables],
    } = await db.query(
      `select
         (select json_build_object('rows', count(*), 'clans', count(distinct clan_tag),
                 'first_day', min(day)::text, 'last_day', max(day)::text,
                 'kinds', (select json_object_agg(snapshot_kind, n) from
                           (select snapshot_kind, count(*)::int n from clan_snapshot_daily group by 1) k))
          from clan_snapshot_daily) as clan_snapshot_daily,
         (select json_build_object('rows', count(*), 'players', count(distinct player_tag),
                 'keys', count(distinct progress_key), 'first_day', min(day)::text, 'last_day', max(day)::text)
          from player_progress_daily) as player_progress_daily,
         (select json_build_object('rows', count(*), 'players', count(distinct player_tag),
                 'seasons', (select json_object_agg(season_month, n) from
                             (select season_month, count(*)::int n from player_pol_season group by 1) k))
          from player_pol_season) as player_pol_season,
         (select json_build_object('rows', count(*), 'clans', count(distinct clan_tag),
                 'sections', count(distinct (season_id, section_index)),
                 -- by war day (period_index % 7 - 2): day 4 was never kept
                 -- before 2026-09-18 (the projector's section scope rule).
                 'by_war_day', (select json_object_agg(d, n) from
                                (select period_index % 7 - 2 as d, count(*)::int as n
                                   from war_period_log group by 1 order by 1) w))
          from war_period_log) as war_period_log,
         (select json_build_object('rows', count(*),
                 'roster_only', count(*) filter (where roster_observed_at is not null and profile_observed_at is null),
                 'profile_only', count(*) filter (where roster_observed_at is null and profile_observed_at is not null),
                 'both', count(*) filter (where roster_observed_at is not null and profile_observed_at is not null),
                 'players', count(distinct player_tag),
                 'clans', count(distinct clan_tag),
                 'first_day', min(snapshot_date)::text, 'last_day', max(snapshot_date)::text,
                 'today_rows', count(*) filter (where snapshot_date = game_day(now())),
                 'today_roster_written', count(*) filter (where snapshot_date = game_day(now()) and roster_observed_at is not null))
          from player_snapshot_daily) as player_snapshot_daily,
         (select json_build_object('war_week_clan_with_score', count(*) filter (where clan_score is not null),
                 'war_week_clan_rows', count(*)) from war_week_clan) as war_week_clan,
         (select json_build_object('with_repairs', count(*) filter (where repair_points is not null),
                 'rows', count(*)) from war_participation) as war_participation,
         (select json_build_object('type', count(type), 'location', count(location_id), 'rows', count(*)) from clan) as clan_state,
         (select json_build_object('frozen', count(war_day_wins), 'rows', count(*)) from player) as player_state,
         (select json_build_object('keys', count(*), 'empty_key', count(*) filter (where progress_key = '')) from mode_season) as mode_season`,
    );
    const { rows: receipts } = await db.query(
      `select endpoint, count(*)::int as receipts,
              count(*) filter (where new_facts > 0)::int as with_facts,
              coalesce(sum(new_facts), 0)::int as facts,
              max(new_facts)::int as max_facts,
              round(avg(new_facts), 2)::float as avg_facts,
              round(avg(ingest_ms))::int as avg_ingest_ms,
              max(ingest_ms)::int as max_ingest_ms
       from api_receipt
       where admission = 'admitted' and fetched_at >= now() - make_interval(hours => $1)
         and endpoint in ('clan', 'player', 'currentriverrace', 'riverracelog')
       group by endpoint order by endpoint`,
      [hours],
    );
    // The arena moments of the last day and how many carry their
    // battle (Phase 2 correction 2: the log pins a roster-written one).
    const {
      rows: [arena],
    } = await db.query(
      `select count(*)::int as rows,
              count(battle_id)::int as with_battle,
              count(*) filter (where timing = 'exact')::int as exact,
              count(*) filter (where receipt_id in
                (select receipt_id from api_receipt where endpoint = 'clan'))::int as from_roster
       from player_event
       where event_type = 'arena_changed' and window_end > now() - interval '1 day'`,
    );
    return { hours, ...tables, arena_moments_24h: arena, receipts };
  } finally {
    await db.end();
  }
}
