/**
 * The SQL behind clans_participation, in one place: the tool runs it and
 * the migrate Lambda's `explain_participation` diagnostic EXPLAIN
 * ANALYZEs it, so the plan being read is the plan being served. Every
 * slow page in Elixir Clan is one call to this tool (live, 2026-09-13:
 * 8.7 s for one week, 20 s for eight), and without a psql path the plan
 * is the only way to see which of these is the one.
 *
 * `participationQueries()` returns the per-clan reads that follow the
 * member lists, each `{ name, text, values }`; MEMBERS_SQL is the list
 * of open members and FORMER_MEMBERS_SQL the members who left inside the
 * window (issue #46), which the others take the tags from.
 * `rosterHistoryQueries()` reads what role-history.mjs rebuilds each
 * member's place at every war finish from. War is read as the
 * game's weekly counters only (Jamie 2026-09-25): the per-war-day
 * battle count and the per-day attendance rows went with the fields
 * they fed, since a war day's rollover cannot be placed reliably at
 * Elixir's scale.
 */

import { notBoatDefense } from "./boat-defense-sql.mjs";

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

/** Members who left inside the window and are not back (issue #46): one
 *  row per player, their latest interval here. Battles and donations are
 *  counted for them in this clan only, since after leaving they are
 *  another clan's. */
export const FORMER_MEMBERS_SQL = `select distinct on (cm.player_tag)
       cm.player_tag, p.name, cm.role as role_at_departure,
       cm.joined_observed_at, cm.left_observed_at,
       (select max(bp.battle_time) from battle_participant bp
        where bp.player_tag = cm.player_tag and bp.clan_tag = cm.clan_tag) as last_battle_in_clan
from clan_membership cm
join player p on p.player_tag = cm.player_tag
where cm.clan_tag = $1 and cm.left_observed_at >= $2
  and cm.left_observed_at > cm.joined_observed_at
  and not exists (select 1 from clan_membership o
                  where o.clan_tag = cm.clan_tag and o.player_tag = cm.player_tag
                    and o.left_observed_at is null)
order by cm.player_tag, cm.left_observed_at desc`;

export function participationQueries({
  clanTag,
  tags,
  formerTags = [],
  from,
  rankedTypes,
}) {
  return [
    {
      // Battles per member per ISO week, ranked counted beside all, in
      // one pass index-only on battle_participant_player_time_cover (0100
      // carries type); boat defenses are not the member's battle (0171),
      // and only boat rows look up their side, by primary key. Force the
      // bounded scalar lookup: EXISTS can hash a full battle-table scan.
      name: "battles_by_week",
      text: `select bp.player_tag, date_trunc('week', bp.battle_time) as week_start,
                    count(*)::int as battles,
                    count(*) filter (where bp.type = any($3))::int as ranked_battles
             from battle_participant bp
             where bp.player_tag = any($1) and bp.battle_time >= $2
               and ${notBoatDefense("bp", { lookupByKey: true })}
             group by bp.player_tag, date_trunc('week', bp.battle_time)`,
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
      values: [clanTag, [...tags, ...formerTags], from],
    },
    {
      // A former member's battles in THIS clan only (issue #46): the
      // participant row's clan_tag is the clan the battle was played for.
      name: "former_battles_by_week",
      text: `select bp.player_tag, date_trunc('week', bp.battle_time) as week_start,
                    count(*)::int as battles,
                    count(*) filter (where bp.type = any($4))::int as ranked_battles
             from battle_participant bp
             where bp.player_tag = any($1) and bp.battle_time >= $2
               and bp.clan_tag = $3
               and ${notBoatDefense("bp", { lookupByKey: true })}
             group by bp.player_tag, date_trunc('week', bp.battle_time)`,
      values: [formerTags, from, clanTag, rankedTypes],
    },
    {
      // And the donation counter only from this clan's roster rows.
      name: "former_donations_by_week",
      text: `select player_tag, date_trunc('week', snapshot_date::timestamp) as week_start,
                    max(donations)::int as donations, count(*)::int as snapshots
             from player_snapshot_daily
             where player_tag = any($1) and snapshot_kind in ('daily', 'pre_reset')
               and snapshot_date >= $2::date and clan_tag = $3
             group by player_tag, date_trunc('week', snapshot_date::timestamp)`,
      values: [formerTags, from, clanTag],
    },
  ];
}

/**
 * The reads behind each member's place at every war finish (issue #46),
 * for role-history.mjs: every membership interval the players have in
 * the clan, their role_changed events since `since`, the clan's roster
 * reads on either side of each finish, and where the clan's role history
 * begins.
 */
export function rosterHistoryQueries({ clanTag, tags, finishes, since }) {
  return [
    {
      name: "memberships",
      text: `select player_tag, joined_observed_at, left_observed_at, role
             from clan_membership
             where clan_tag = $1 and player_tag = any($2::text[])
             order by player_tag, joined_observed_at`,
      values: [clanTag, tags],
    },
    {
      // On clan_event_window (0088). An older roster admitted after a
      // newer one writes a window that runs backwards; role-history.mjs
      // refuses to rebuild across one.
      name: "role_events",
      text: `select event_id, player_tag, window_start, window_end, role_before, role_after
             from clan_event
             where clan_tag = $1 and event_type = 'role_changed'
               and window_end >= $2 and player_tag = any($3::text[])
             order by window_end, event_id`,
      values: [clanTag, since, tags],
    },
    {
      // The admitted roster reads either side of each finish, on
      // api_receipt_entity_time (0079). Backfilled reads count: they are
      // the reads the imported tenure was walked from.
      name: "finish_reads",
      text: `select t.i::int as i,
                    (select max(r.fetched_at) from api_receipt r
                      where r.entity_key = $1 and r.endpoint = 'clan'
                        and r.admission = 'admitted' and r.fetched_at <= t.at) as prev_read,
                    (select min(r.fetched_at) from api_receipt r
                      where r.entity_key = $1 and r.endpoint = 'clan'
                        and r.admission = 'admitted' and r.fetched_at >= t.at) as next_read
             from unnest($2::timestamptz[]) with ordinality as t(at, i)`,
      values: [clanTag, finishes],
    },
    {
      // Role changes are events only from the record's own first live
      // roster read: the imported history (the backfill gateway) wrote
      // tenure and no events. Per gateway on the receipt idempotency
      // index (0003), so the backfill's reads are never walked.
      name: "role_history_since",
      text: `select min(x.first_read) as role_history_since
             from gateway g
             cross join lateral (
               select min(r.fetched_at) as first_read from api_receipt r
               where r.gateway_id = g.gateway_id and r.endpoint = 'clan'
                 and r.entity_key = $1 and r.admission = 'admitted') x
             where g.name <> 'backfill-elixir-bot'`,
      values: [clanTag],
    },
  ];
}
