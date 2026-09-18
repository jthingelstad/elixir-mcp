/**
 * The SQL behind clans_participation, in one place: the tool runs it and
 * the migrate Lambda's `explain_participation` diagnostic EXPLAIN
 * ANALYZEs it, so the plan being read is the plan being served. Every
 * slow page in Elixir Clan is one call to this tool (live, 2026-09-13:
 * 8.7 s for one week, 20 s for eight), and without a psql path the plan
 * is the only way to see which of these seven is the one.
 *
 * `participationQueries()` returns the six per-clan reads that follow
 * the member list, each `{ name, text, values }`; MEMBERS_SQL is the
 * list itself, which the others take the tags from.
 */

import { WAR_BATTLE_TYPES } from "./war-battles-sql.mjs";

export const MEMBERS_SQL = `select cm.player_tag, p.name, cm.role, cm.joined_observed_at,
       (select max(bp.battle_time) from battle_participant bp
        where bp.player_tag = cm.player_tag) as last_battle,
       -- The last recorded battle IN this clan (3.16.0): the participant
       -- row's clan_tag is the clan the player was in when it was played.
       (select max(bp.battle_time) from battle_participant bp
        where bp.player_tag = cm.player_tag and bp.clan_tag = cm.clan_tag) as last_battle_in_clan
from clan_membership cm
join player p on p.player_tag = cm.player_tag
where cm.clan_tag = $1 and cm.left_observed_at is null
order by cm.player_tag`;

export function participationQueries({
  clanTag,
  tags,
  from,
  rankedTypes,
  warTypes = WAR_BATTLE_TYPES,
}) {
  return [
    {
      // Battles per member per ISO week, ranked counted beside all, AND
      // the war-day battles per member, from ONE pass over the
      // participant rows: the two used to be separate reads and each
      // scanned the same 26k rows (8.4 s apiece on the live database,
      // 2026-09-13). The CTE is index-only on
      // battle_participant_player_time_cover (0100 carries type); the
      // war half resolves each battle against the calendar (0105) by
      // range instead of the stamps three quarters of them never had,
      // and nothing joins battle any more.
      name: "battles_by_week_and_war_day",
      text: `with bp as (
               select bp.player_tag, bp.battle_time, bp.clan_tag, bp.type
               from battle_participant bp
               where bp.player_tag = any($1) and bp.battle_time >= $2
             )
             select 'week' as kind, player_tag,
                    date_trunc('week', battle_time) as week_start,
                    null::int as season_id, null::int as section_index, null::int as war_day,
                    count(*)::int as battles,
                    count(*) filter (where type = any($3))::int as ranked_battles
             from bp
             group by player_tag, date_trunc('week', battle_time)
             union all
             select 'war_day', bp.player_tag, null,
                    p.war_season_id, p.section_index, p.war_day,
                    count(*)::int, 0
             from bp
             join war_period p
               on bp.battle_time >= p.starts_at and bp.battle_time < p.ends_at
             where bp.clan_tag = $4 and bp.type = any($5) and p.war_day is not null
             group by bp.player_tag, p.war_season_id, p.section_index, p.war_day`,
      values: [tags, from, rankedTypes, clanTag, warTypes],
    },
    {
      // The donation counter at the end of each ISO week: the largest
      // daily snapshot inside it (the counter resets Mondays).
      name: "donations_by_week",
      text: `select player_tag, date_trunc('week', snapshot_date::timestamp) as week_start,
                    max(donations)::int as donations, count(*)::int as snapshots
             from player_snapshot_daily
             where player_tag = any($1) and snapshot_kind = 'daily' and snapshot_date >= $2::date
             group by player_tag, date_trunc('week', snapshot_date::timestamp)`,
      values: [tags, from],
    },
    {
      // War weeks the clan recorded inside the window.
      name: "war_weeks",
      text: `select w.season_id, w.section_index, w.is_colosseum,
                    w.started_observed_at, w.finished_observed_at
             from war_week w
             where w.clan_tag = $1
               and coalesce(w.finished_observed_at, w.started_observed_at, now()) >= $2
             order by w.season_id, w.section_index`,
      values: [clanTag, from],
    },
    {
      name: "war_participation",
      text: `select wp.player_tag, wp.season_id, wp.section_index, wp.decks_used, wp.points
             from war_participation wp
             where wp.clan_tag = $1 and wp.player_tag = any($2)
               and (wp.season_id, wp.section_index) in (
                 select w.season_id, w.section_index from war_week w
                 where w.clan_tag = $1
                   and coalesce(w.finished_observed_at, w.started_observed_at, now()) >= $3)`,
      values: [clanTag, tags, from],
    },
    {
      name: "war_attendance",
      text: `select ad.player_tag, ad.season_id, ad.section_index, ad.war_day,
                    ad.decks_used_today
             from war_attendance_day ad
             where ad.clan_tag = $1 and ad.player_tag = any($2)
               and (ad.season_id, ad.section_index) in (
                 select w.season_id, w.section_index from war_week w
                 where w.clan_tag = $1
                   and coalesce(w.finished_observed_at, w.started_observed_at, now()) >= $3)`,
      values: [clanTag, tags, from],
    },
  ];
}
