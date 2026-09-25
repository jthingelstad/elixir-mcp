/**
 * The SQL behind clans_participation, in one place: the tool runs it and
 * the migrate Lambda's `explain_participation` diagnostic EXPLAIN
 * ANALYZEs it, so the plan being read is the plan being served. Every
 * slow page in Elixir Clan is one call to this tool (live, 2026-09-13:
 * 8.7 s for one week, 20 s for eight), and without a psql path the plan
 * is the only way to see which of these is the one.
 *
 * `participationQueries()` returns the four per-clan reads that follow
 * the member list, each `{ name, text, values }`; MEMBERS_SQL is the
 * list itself, which the others take the tags from. War is read as the
 * game's weekly counters only (Jamie 2026-09-25): the per-war-day
 * battle count and the per-day attendance rows went with the fields
 * they fed, since a war day's rollover cannot be placed reliably at
 * Elixir's scale.
 */

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

export function participationQueries({ clanTag, tags, from, rankedTypes }) {
  return [
    {
      // Battles per member per ISO week, ranked counted beside all, in
      // one pass index-only on battle_participant_player_time_cover (0100
      // carries type); nothing joins battle.
      name: "battles_by_week",
      text: `select player_tag, date_trunc('week', battle_time) as week_start,
                    count(*)::int as battles,
                    count(*) filter (where type = any($3))::int as ranked_battles
             from battle_participant
             where player_tag = any($1) and battle_time >= $2
             group by player_tag, date_trunc('week', battle_time)`,
      values: [tags, from, rankedTypes],
    },
    {
      // A week's donations are the highest counter value the record saw
      // in its game days (Jamie, 2026-09-23: the counter only climbs until
      // the weekly reset). snapshot_date is the game day, so the week is
      // Monday 10:00Z to Monday 10:00Z; the pre_reset row (the high-water
      // mark near the reset) counts beside the daily rows.
      name: "donations_by_week",
      text: `select player_tag, date_trunc('week', snapshot_date::timestamp) as week_start,
                    max(donations)::int as donations, count(*)::int as snapshots
             from player_snapshot_daily
             where player_tag = any($1) and snapshot_kind in ('daily', 'pre_reset')
               and snapshot_date >= $2::date
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
  ];
}
