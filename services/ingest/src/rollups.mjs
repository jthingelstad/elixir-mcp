/**
 * Daily battle rollups — DESIGN §4.5, §5.4.
 *
 * Delete-then-reinsert per (player, UTC day): rollups are derived, battles
 * are the truth. mode_group is data, not code — one mapping shared by the
 * SQL. Completeness is computed at read time from matched observation
 * intervals; calendar-day rollups cannot represent a multi-day profile gap.
 */

import { modeGroupSql } from "@elixir-mcp/contracts";

// A player's own record KEEPS their event battles - they played them -
// but files them under `event` rather than folding them into casual,
// which is what filed the Seasonal Trophy Road as casual play.
const MODE_GROUP_CASE = modeGroupSql("b.type", "b.event_tag");

// A boat battle this participant DEFENDED (0171, Gym #263): the API's
// boatBattleSide is the log owner's (side 0). Counted apart so a reader
// can leave out battles the member did not play.
const DEFENSE = `(b.boat_battle_side is not null and (b.boat_battle_side = 'defender') = (bp.side = 0))`;

/** Recompute rollups for a set of {playerTag, day} pairs. */
export async function refreshDailyRollups(db, pairs) {
  for (const { playerTag, day } of pairs) {
    await db.query(
      `delete from player_daily_battle_rollup where player_tag = $1 and day = $2`,
      [playerTag, day],
    );
    await db.query(
      `insert into player_daily_battle_rollup
         (player_tag, day, mode_group, game_mode_id, wins, losses, draws,
          crowns_for, crowns_against, trophy_delta, battles_captured,
          boat_defenses, boat_defense_wins, boat_defense_losses)
       select bp.player_tag, $2::date, ${MODE_GROUP_CASE}, coalesce(b.game_mode_id, 0),
              count(*) filter (where bp.outcome = 'win'),
              count(*) filter (where bp.outcome = 'loss'),
              count(*) filter (where bp.outcome = 'draw'),
              coalesce(sum(bp.crowns), 0),
              coalesce(sum(opp.crowns), 0),
              coalesce(sum(bp.trophy_change), 0),
              count(*),
              count(*) filter (where ${DEFENSE}),
              count(*) filter (where ${DEFENSE} and bp.outcome = 'win'),
              count(*) filter (where ${DEFENSE} and bp.outcome = 'loss')
       from battle_participant bp
       join battle b on b.battle_id = bp.battle_id
       left join lateral (
         select max(o.crowns) as crowns from battle_participant o
         where o.battle_id = bp.battle_id and o.side <> bp.side
       ) opp on true
       where bp.player_tag = $1
         -- The day is a UTC day, spelled so. The KEY is written in UTC
         -- (pipeline.mjs takes battle_time.slice(0,10) off the ISO
         -- string), but a plain date cast compared against a timestamptz
         -- resolves at the SESSION zone, so on a non-UTC session the
         -- window and the key describe different days and a battle in
         -- the offset hours lands in neither. Production runs UTC and
         -- was never wrong; a developer machine on America/Chicago is,
         -- for the five hours after UTC midnight, which is what made
         -- the clans_standings test red only at night (2026-09-23).
         and bp.battle_time >= ($2::date)::timestamp at time zone 'UTC'
         and bp.battle_time < ($2::date + 1)::timestamp at time zone 'UTC'
       group by bp.player_tag, ${MODE_GROUP_CASE}, coalesce(b.game_mode_id, 0)`,
      [playerTag, day],
    );
  }
}
