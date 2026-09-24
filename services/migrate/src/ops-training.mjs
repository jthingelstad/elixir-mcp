/**
 * Training-day practice decks rebuilt from recorded battles (Jamie
 * 2026-09-24: "you could backfill training day decks from the battle
 * logs"). {training_backfill: {season_id, apply?}}
 *
 * A river-race battle (the war types, not a boat defense) whose
 * battle_time falls on a TRAINING day of the policy grid (war_period,
 * 10:00Z days) is practice for the clan the player was in when it was
 * played: the same four war decks, played for reps (Jamie). A 1v1 is one deck; a duel one per round played
 * (battle_participant_round), or two when no round rows were recorded
 * (counted as duels_without_rounds). A day is capped at four decks, as
 * the game caps decksUsedToday. Only clan-weeks whose race the record
 * holds, and only that race's participants: a player seen in someone
 * else's battle is not a member row.
 *
 * Dry run by default (per-week counts); apply inserts with source
 * 'battlelog' and never touches a row the race poll wrote. One season
 * per call so a run stays inside the Lambda's time.
 */

import pg from "pg";

const DUEL_TYPES = ["riverRaceDuel", "riverRaceDuelColosseum"];
const WAR_TYPES = [
  "riverRacePvP",
  "riverRaceDuel",
  "riverRaceDuelColosseum",
  "boatBattle",
];

const PRACTICE_SQL = `
  with rounds as (
    select battle_id, player_tag, count(*)::int as n
      from battle_participant_round
     group by battle_id, player_tag),
  played as (
    select p.war_season_id as season_id, p.section_index,
           p.day_in_section,
           bp.clan_tag, bp.player_tag,
           case when bp.type = any($2::text[])
                then coalesce(r.n, 2) else 1 end as decks,
           (bp.type = any($2::text[]) and r.n is null) as duel_no_rounds
      from war_period p
      join battle_participant bp
        on bp.battle_time >= p.starts_at and bp.battle_time < p.ends_at
      left join rounds r on r.battle_id = bp.battle_id and r.player_tag = bp.player_tag
     where p.war_season_id = $1 and p.kind = 'training'
       and bp.type = any($3::text[])
       and bp.clan_tag is not null
       and not exists (
         select 1 from battle bd
          where bd.battle_id = bp.battle_id and bd.boat_battle_side is not null
            and (bd.boat_battle_side = 'defender') = (bp.side = 0))
       and exists (
         select 1 from war_participation wp
          where wp.clan_tag = bp.clan_tag and wp.season_id = p.war_season_id
            and wp.section_index = p.section_index and wp.player_tag = bp.player_tag))
  select season_id, section_index, day_in_section, clan_tag, player_tag,
         least(4, sum(decks))::int as decks_used_today,
         count(*) filter (where duel_no_rounds)::int as duels_without_rounds
    from played
   group by season_id, section_index, day_in_section, clan_tag, player_tag`;

export async function trainingBackfill(databaseUrl, spec = {}) {
  const seasonId = Number(spec.season_id);
  if (!Number.isInteger(seasonId) || seasonId < 1)
    throw new Error("training_backfill needs season_id");
  const apply = spec.apply === true;
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query("set statement_timeout = '600s'");
    const params = [seasonId, DUEL_TYPES, WAR_TYPES];
    const { rows: weeks } = await db.query(
      `select section_index, count(distinct clan_tag)::int as clans,
              count(*)::int as member_days,
              sum(decks_used_today)::int as decks,
              sum(duels_without_rounds)::int as duels_without_rounds
         from (${PRACTICE_SQL}) x
        group by section_index order by section_index`,
      params,
    );
    // Where the race poll saw the same member-day, how the rebuild
    // compares: the evidence that battles reproduce decksUsedToday.
    const {
      rows: [vsPoll],
    } = await db.query(
      `select count(*)::int as rows,
              count(*) filter (where x.decks_used_today = t.decks_used_today)::int as equal,
              count(*) filter (where x.decks_used_today < t.decks_used_today)::int as rebuilt_lower,
              count(*) filter (where x.decks_used_today > t.decks_used_today)::int as rebuilt_higher
         from (${PRACTICE_SQL}) x
         join war_attendance_day t
           on t.clan_tag = x.clan_tag and t.season_id = x.season_id
          and t.section_index = x.section_index and t.day_in_section = x.day_in_section
          and t.player_tag = x.player_tag and t.source = 'poll'`,
      params,
    );
    let inserted = 0;
    if (apply) {
      const { rowCount } = await db.query(
        `insert into war_attendance_day
           (clan_tag, season_id, section_index, day_in_section, player_tag,
            decks_used_today, source)
         select clan_tag, season_id, section_index, day_in_section, player_tag,
                decks_used_today, 'battlelog'
           from (${PRACTICE_SQL}) x
          where decks_used_today > 0
         on conflict (clan_tag, season_id, section_index, day_in_section, player_tag)
         do nothing`,
        params,
      );
      inserted = rowCount;
    }
    return { season_id: seasonId, apply, weeks, vs_poll: vsPoll, inserted };
  } finally {
    await db.end();
  }
}
