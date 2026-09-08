/**
 * Daily battle rollups — DESIGN §4.5, §5.4.
 *
 * Delete-then-reinsert per (player, UTC day): rollups are derived, battles
 * are the truth. mode_group is data, not code — one mapping shared by the
 * SQL. Completeness is computed at read time from matched observation
 * intervals; calendar-day rollups cannot represent a multi-day profile gap.
 */

import { MODE_GROUP_BY_TYPE } from "@elixir-mcp/contracts";

const MODE_GROUP_CASE = `case b.type ${Object.entries(MODE_GROUP_BY_TYPE)
  .map(([t, g]) => `when '${t}' then '${g}'`)
  .join(" ")} else 'casual' end`;

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
          crowns_for, crowns_against, trophy_delta, battles_captured)
       select bp.player_tag, $2::date, ${MODE_GROUP_CASE}, coalesce(b.game_mode_id, 0),
              count(*) filter (where bp.outcome = 'win'),
              count(*) filter (where bp.outcome = 'loss'),
              count(*) filter (where bp.outcome = 'draw'),
              coalesce(sum(bp.crowns), 0),
              coalesce(sum(opp.crowns), 0),
              coalesce(sum(bp.trophy_change), 0),
              count(*)
       from battle_participant bp
       join battle b on b.battle_id = bp.battle_id
       left join lateral (
         select max(o.crowns) as crowns from battle_participant o
         where o.battle_id = bp.battle_id and o.side <> bp.side
       ) opp on true
       where bp.player_tag = $1
         and bp.battle_time >= $2::date and bp.battle_time < $2::date + 1
       group by bp.player_tag, ${MODE_GROUP_CASE}, coalesce(b.game_mode_id, 0)`,
      [playerTag, day],
    );
  }
}
