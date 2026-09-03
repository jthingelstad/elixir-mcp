/**
 * Daily battle rollups — DESIGN §4.5, §5.4.
 *
 * Delete-then-reinsert per (player, UTC day): rollups are derived, battles
 * are the truth. mode_group is data, not code — one mapping shared by the
 * SQL. Rollups carry their own completeness rather than pretending:
 * expected_battle_delta comes from bracketing snapshots (battleCount is
 * lifetime-monotonic), captured is what we hold; the ratio is day-level
 * and duplicated across the day's mode rows by design.
 */

import { MODE_GROUP_BY_TYPE } from '@elixir-mcp/contracts';

export { MODE_GROUP_BY_TYPE };

const MODE_GROUP_CASE = `case b.type ${Object.entries(MODE_GROUP_BY_TYPE)
  .map(([t, g]) => `when '${t}' then '${g}'`)
  .join(' ')} else 'casual' end`;

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
         and b.battle_time >= $2::date and b.battle_time < $2::date + 1
       group by bp.player_tag, ${MODE_GROUP_CASE}, coalesce(b.game_mode_id, 0)`,
      [playerTag, day],
    );
  }
}

/**
 * Fill the day-level completeness estimate for (player, day) when
 * bracketing snapshots exist: expected = battleCount(day) - battleCount
 * (previous snapshot day); captured = the day's rollup total.
 */
export async function refreshCompleteness(db, { playerTag, day }) {
  const { rows } = await db.query(
    `with here as (
       select (lifetime->>'battleCount')::int as bc
       from player_snapshot_daily
       where player_tag = $1 and snapshot_date = $2::date and snapshot_kind = 'daily'
     ), prev as (
       select (lifetime->>'battleCount')::int as bc
       from player_snapshot_daily
       where player_tag = $1 and snapshot_date < $2::date and snapshot_kind = 'daily'
       order by snapshot_date desc limit 1
     )
     select here.bc - prev.bc as expected from here, prev`,
    [playerTag, day],
  );
  const expected = rows[0]?.expected;
  if (expected === undefined || expected === null || expected < 0) return { expected: null };

  await db.query(
    `with captured as (
       select coalesce(sum(battles_captured), 0)::int as n
       from player_daily_battle_rollup where player_tag = $1 and day = $2::date
     )
     update player_daily_battle_rollup r
     set expected_battle_delta = $3,
         completeness_ratio = case when $3 = 0 then 1 else least(1, (select n from captured)::numeric / $3) end,
         is_complete = (select n from captured) >= $3
     from captured
     where r.player_tag = $1 and r.day = $2::date`,
    [playerTag, day, expected],
  );
  return { expected };
}
