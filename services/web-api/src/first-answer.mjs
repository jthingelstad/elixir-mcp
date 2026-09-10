// Readiness is derived from the record, never a second onboarding state to
// reconcile. Keep this separate from the HTTP/auth routing layer.
export async function firstAnswer(db, accountId) {
  // One client is one connection: pg queues concurrent queries on it
  // anyway, so Promise.all bought no parallelism and only tripped the
  // deprecation (docs/ENGINEERING.md: one client, one query at a time).
  const player = await db.query(
    `select c.player_tag, p.name,
              exists (select 1 from player_snapshot_daily where player_tag = c.player_tag) as profile_available,
              -- Whoever asked for it: a recording belongs to the SUBJECT.
              -- Scoped to requested_by, an account claiming a player some
              -- other account already records was told it had no data,
              -- with the battles right there in the same query.
              (select status from recording
               where subject_type = 'player' and subject_tag = c.player_tag
               order by (status = 'active') desc limit 1) as recording_status,
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
  );
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
    player: player.rows[0] ?? null,
    connection: connection.rows[0],
    clan: clan.rows[0] ?? null,
  };
}
