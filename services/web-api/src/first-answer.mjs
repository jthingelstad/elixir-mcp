import { dailySql } from "@elixir-mcp/record/daily-sql";
import { recentCompleteness } from "@elixir-mcp/tools/coverage";

// Readiness is derived from the record, never a second onboarding state to
// reconcile. Keep this separate from the HTTP/auth routing layer.
export async function firstAnswer(db, accountId, playerTag = null) {
  // One client is one connection: pg queues concurrent queries on it
  // anyway, so Promise.all bought no parallelism and only tripped the
  // deprecation (docs/ENGINEERING.md: one client, one query at a time).
  const player = await db.query(
    `select c.player_tag, c.is_primary, c.relationship, p.name,
              exists (select 1 from player_snapshot_daily where player_tag = c.player_tag
                      and profile_observed_at is not null) as profile_available,
              -- Whoever asked for it: a recording belongs to the SUBJECT.
              -- Scoped to requested_by, an account claiming a player some
              -- other account already records was told it had no data,
              -- with the battles right there in the same query.
              (select status from recording
               where subject_type = 'player' and subject_tag = c.player_tag
               order by (status = 'active') desc, created_at desc limit 1) as recording_status,
              (select max(profile_observed_at) from player_snapshot_daily
               where player_tag = c.player_tag) as profile_observed_at,
              (select last_admitted_at from poll_state where subject_tag = c.player_tag
               and endpoint = 'player_battlelog') as battlelog_observed_at,
              (select max(battle_time) from battle_participant where player_tag = c.player_tag
               and battle_time <= now()) as last_battle_at,
              b.*
       from claim c join player p on p.player_tag = c.player_tag
       cross join lateral (
         -- The counters from the daily rollup for whole days and the
         -- raw rows for each window's edge day (daily-sql.mjs); the
         -- distinct decks stay raw, the rollup does not carry them.
         select (select coalesce(sum(battles), 0)::int
                   from ${dailySql({ players: "array[c.player_tag]", from: "(now() - interval '30 days')", to: "null" })} d) as battles_30d,
                (select coalesce(sum(battles), 0)::int
                   from ${dailySql({ players: "array[c.player_tag]", from: "(now() - interval '7 days')", to: "null" })} d) as battles_7d,
                (select coalesce(sum(battles), 0)::int
                   from ${dailySql({ players: "array[c.player_tag]", from: "(now() - interval '14 days')", to: "(now() - interval '7 days')" })} d) as battles_previous_7d,
                (select count(distinct deck_hash)::int from battle_participant
                  where player_tag = c.player_tag
                    and battle_time >= now() - interval '7 days' and battle_time <= now()) as distinct_decks_7d
       ) b
     where c.account_id = $1
       and (($2::text is null and c.is_primary) or c.player_tag = $2)`,
    [accountId, playerTag],
  );
  const capturedPlayer = player.rows[0] ?? null;
  if (capturedPlayer) {
    // Existing metadata only, restricted to this account's selected claim.
    // An error is an attempted fetch, not proof of an invalid tag, with
    // one exception the game itself states: a 404 on the profile is
    // "Player not found" (cr-agent-api-docs players.md), so the latest
    // failure's status rides with it (2026-10-08, record-journey.js).
    // Error retention is bounded; missing error metadata remains unknown.
    const { rows } = await db.query(
      `select e.endpoint, ps.last_admitted_at, ps.retry_at, ps.retry_tries,
              f.fetched_at as last_failed_at, f.http_status as last_failed_status
       from (values ('player'), ('player_battlelog')) e(endpoint)
       left join poll_state ps on ps.subject_tag = $1 and ps.endpoint = e.endpoint
       left join lateral (
         select fetched_at, http_status from collector_fetch_error f
          where f.entity_key = $1 and f.endpoint = e.endpoint
          order by fetched_at desc limit 1) f on true`,
      [capturedPlayer.player_tag],
    );
    capturedPlayer.capture_attempts = rows;
    capturedPlayer.capture_interval = await recentCompleteness(
      db,
      capturedPlayer.player_tag,
    );
  }
  const connection = await db.query(
    `select
         (select count(*)::int from oauth_family where account_id = $1
          and revoked_at is null and absolute_expires_at > now()) as active_connections,
         count(*)::int as successful_data_calls_7d,
         count(distinct (created_at at time zone 'UTC')::date)::int as data_read_days_7d,
         max(created_at) as last_data_read_at
       from mcp_call_audit where account_id = $1 and surface = 'mcp'
         and token_id is null and error_code is null and not truncated
         and created_at >= now() - interval '7 days'
       and tool ~ '^(players|battles|war)_'`,
    [accountId],
  );
  // The count, not just the existence: "POAP KINGS" says a clan is
  // tracked, "POAP KINGS - 27 war weeks" says what it can answer with.
  const clan = await db.query(
    `select ac.clan_tag, c.name,
            (select json_build_object('season_id', w.season_id, 'section_index', w.section_index)
               from war_week w where w.clan_tag = ac.clan_tag
               order by w.season_id desc, w.section_index desc limit 1) as latest_week,
            (select count(*)::int from war_week w where w.clan_tag = ac.clan_tag)
              as war_weeks
       from account_clan ac left join clan c on c.clan_tag = ac.clan_tag
       where ac.account_id = $1
         and exists (select 1 from war_week w where w.clan_tag = ac.clan_tag)
     order by ac.is_primary desc, ac.clan_tag limit 1`,
    [accountId],
  );
  return {
    as_of: new Date().toISOString(),
    player: capturedPlayer,
    connection: connection.rows[0],
    clan: clan.rows[0] ?? null,
  };
}
