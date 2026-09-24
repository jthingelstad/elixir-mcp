/**
 * {war_gap_census: {}}: read-only. How many recorded war battles fell in
 * the gap between a race's own day roll and the 10:00Z policy grid, the
 * battles the grid files on the day before the game does (Jamie
 * 2026-09-24: "are there races that fall in that grey zone?").
 *
 * The roll slot is the week's own recorded close (war_week.closed_at):
 * the time of day, applied to each of that week's days. For every policy
 * day of a closed week, battles by the clan's members (participant
 * clan_tag, war types, not a boat defense) in [day end + slot offset, day
 * end) are counted, per clan and per day kind.
 */

import pg from "pg";

const WAR_TYPES = [
  "riverRacePvP",
  "riverRaceDuel",
  "riverRaceDuelColosseum",
  "boatBattle",
];

export async function warGapCensus(databaseUrl) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query("set statement_timeout = '600s'");
    const { rows } = await db.query(
      `with wk as (
         select w.clan_tag, w.season_id, w.section_index, w.closed_at,
                w.closed_at - (date_trunc('day', w.closed_at) + interval '10 hours') as shift
           from war_week w
          where w.closed_at is not null),
       gap as (
         select wk.clan_tag, wk.season_id, wk.section_index, p.kind, p.day_in_section,
                bp.player_tag, bp.battle_id
           from wk
           join war_period p
             on p.war_season_id = wk.season_id and p.section_index = wk.section_index
           join battle_participant bp
             on bp.battle_time >= p.ends_at + wk.shift and bp.battle_time < p.ends_at
            and bp.clan_tag = wk.clan_tag
          where wk.shift < interval '0'
            and bp.type = any($1::text[])
            and not exists (
              select 1 from battle bd
               where bd.battle_id = bp.battle_id and bd.boat_battle_side is not null
                 and (bd.boat_battle_side = 'defender') = (bp.side = 0)))
       select clan_tag, kind,
              count(*)::int as battles,
              count(distinct (season_id, section_index, day_in_section, player_tag))::int as member_days,
              count(distinct (season_id, section_index))::int as weeks
         from gap group by clan_tag, kind order by battles desc`,
      [WAR_TYPES],
    );
    const {
      rows: [totals],
    } = await db.query(
      `select count(*)::int as closed_weeks,
              count(distinct clan_tag)::int as clans
         from war_week where closed_at is not null`,
    );
    return { ...totals, by_clan_and_kind: rows };
  } finally {
    await db.end();
  }
}
