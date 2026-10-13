import { RECORDED_PLAYERS_SQL } from "./tools/shared.mjs";

export async function calculatePublicStats(db) {
  const q = async (sql) => (await db.query(sql)).rows;
  const [totals] = await q(
    `select (select count(*)::int from battle) as battles,
          (select count(*)::int from player) as players,
          (select count(*)::int from clan) as clans,
          (select count(*)::int from war_week) as war_weeks,
          (select count(*)::int from player_snapshot_daily) as snapshots,
          (select min(battle_time) from battle) as oldest_battle,
          (select max(battle_time) from battle) as newest_battle,
          (select count(*)::int from gateway where status = 'active') as collectors_active,
          -- Recorded players as the tools count them: recorded
          -- directly or as a member of a comprehensively recorded
          -- clan. A player known only from a battle stub is a ghost
          -- entry and never the headline (Jamie, 2026-09-23).
          (select count(distinct player_tag)::int
           from (${RECORDED_PLAYERS_SQL}) rp) as players_recording,
          (select count(*) filter (where subject_type = 'clan')::int
           from recording where status = 'active') as clans_recording`,
  );
  const battlesDaily = await q(
    `select (battle_time at time zone 'UTC')::date::text as day,
          count(*)::int as battles
   from battle group by 1 order by 1`,
  );
  const observedDaily = await q(
    `select (first_seen_at at time zone 'UTC')::date::text as day,
          count(*)::int as players
   from player group by 1 order by 1`,
  );
  const fetchesDaily = await q(
    `select (r.fetched_at at time zone 'UTC')::date::text as day,
          count(*)::int as fetches,
          count(distinct r.gateway_id)::int as collectors
   from api_receipt r join gateway g on g.gateway_id = r.gateway_id
   where g.name <> 'backfill-elixir-bot'
   group by 1 order by 1`,
  );
  return {
    totals: {
      ...totals,
      oldest_battle: totals.oldest_battle?.toISOString() ?? null,
      newest_battle: totals.newest_battle?.toISOString() ?? null,
    },
    series: {
      battles_daily: battlesDaily,
      players_observed_daily: observedDaily,
      fetches_daily: fetchesDaily,
    },
    note: "Recorded history only - the corpus began 2026-09-03 plus imported archives; battle days predate observation days where archives were replayed.",
  };
}

export async function readPublicStats(db) {
  const { rows } = await db.query(
    "select payload, updated_at from public_stats_cache where cache_key = 1 and updated_at > now() - interval '2 hours'",
  );
  if (rows[0])
    return { ...rows[0].payload, as_of: rows[0].updated_at.toISOString() };
  return {
    ...(await calculatePublicStats(db)),
    as_of: new Date().toISOString(),
  };
}
