/** Private Clan removal proof, batched and scoped to the current roster.
 * Lifetime play protects a member regardless of the clan where it occurred.
 * Read profile stamps, never roster observed_at or extra reset peaks. */
import { notBoatDefense } from "./boat-defense-sql.mjs";
export async function clanActivityEvidence(db, clanTag, tags) {
  if (!tags.length) return new Map();
  const { rows } = await db.query(
    `select cm.player_tag, cm.role, cm.joined_observed_at,
       (select max(bp.battle_time) from battle_participant bp
        where bp.player_tag=cm.player_tag and ${notBoatDefense("bp", { lookupByKey: true })}) as last_battle_time,
       (select jsonb_agg(jsonb_build_object(
          'snapshot_date', s.snapshot_date,
          'profile_observed_at', s.profile_observed_at,
          'battle_count', s.battle_count) order by s.snapshot_date)
        from player_snapshot_daily s
        where s.player_tag=cm.player_tag and s.snapshot_kind='daily'
          and s.profile_observed_at is not null
          and s.snapshot_date >= current_date - 212) as observations,
       (select jsonb_agg(jsonb_build_object('snapshot_date', d.day::date) order by d.day)
        from (select min(snapshot_date) filter (where profile_observed_at is not null) as first_day,
                     max(snapshot_date) as last_day
              from player_snapshot_daily
              where player_tag=cm.player_tag and snapshot_kind='daily'
                and snapshot_date >= current_date - 212) b
        cross join lateral generate_series(b.first_day::timestamp,b.last_day::timestamp,interval '1 day') d(day)
        where not exists (select 1 from player_snapshot_daily s
                          where s.player_tag=cm.player_tag and s.snapshot_kind='daily'
                            and s.snapshot_date=d.day::date and s.profile_observed_at is not null)) as profile_gaps
     from clan_membership cm
     where cm.clan_tag=$1 and cm.left_observed_at is null
       and cm.player_tag=any($2::text[])`,
    [clanTag, tags],
  );
  return new Map(
    rows.map((r) => [
      r.player_tag,
      {
        role: r.role,
        joined_observed_at: r.joined_observed_at?.toISOString() ?? null,
        last_battle_time: r.last_battle_time?.toISOString() ?? null,
        activity_evidence: {
          current_member: true,
          observations: r.observations ?? [],
          profile_gaps: r.profile_gaps ?? [],
        },
      },
    ]),
  );
}
