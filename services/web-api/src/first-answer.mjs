// Readiness is derived from the record, never a second onboarding state to
// reconcile. Keep this separate from the HTTP/auth routing layer.
export async function firstAnswer(db, accountId) {
  const [player, connection] = await Promise.all([
    db.query(
      `select c.player_tag, p.name,
              exists (select 1 from player_snapshot_daily where player_tag = c.player_tag) as profile_available,
              (select status from recording where requested_by = $1
               and subject_type = 'player' and subject_tag = c.player_tag) as recording_status,
              (select max(observed_at) from player_snapshot_daily
               where player_tag = c.player_tag) as profile_observed_at,
              (select last_admitted_at from poll_state where subject_tag = c.player_tag
               and endpoint = 'player_battlelog') as battlelog_observed_at,
              (select max(battle_time) from battle_participant where player_tag = c.player_tag
               and battle_time <= now()) as last_battle_at,
              b.*
       from claim c join player p on p.player_tag = c.player_tag
       cross join lateral (
         select count(*)::int as battles_30d,
                count(*) filter (where battle_time >= now() - interval '7 days')::int as battles_7d,
                count(*) filter (where battle_time < now() - interval '7 days'
                  and battle_time >= now() - interval '14 days')::int as battles_previous_7d,
                count(distinct deck_hash) filter (where battle_time >= now() - interval '7 days')::int as distinct_decks_7d
         from battle_participant where player_tag = c.player_tag
           and battle_time >= now() - interval '30 days' and battle_time <= now()
       ) b
       where c.account_id = $1 and c.is_primary`,
      [accountId],
    ),
    db.query(
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
    ),
  ]);
  return {
    as_of: new Date().toISOString(),
    player: player.rows[0] ?? null,
    connection: connection.rows[0],
  };
}
