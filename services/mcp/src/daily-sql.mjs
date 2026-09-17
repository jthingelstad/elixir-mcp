/**
 * Per-player daily sums from player_daily_battle_rollup (schema review
 * 2.4, plan step 14). The rollup is maintained on every battle ingest at
 * (player, UTC day, mode group, game mode) grain and had no reader; the
 * count-shaped reads (a clan's standings, a player's 30-day record, the
 * first-answer counters) summed the raw participant rows for it on
 * every call - clans_standings over the whole corpus's window, keeping
 * ~50 members of it.
 *
 * A window is an instant range and the rollup is whole days, so the
 * helper is exact by construction: whole days strictly inside the
 * window come from the rollup; the day the window starts in and the day
 * it ends in (when it ends before now) come from the raw rows for those
 * hours. With no `to`, today comes from the rollup too: it is rewritten
 * on every ingest and holds today so far. One CTE text, the same shape
 * from both sources: (player_tag, day, mode_group, battles, wins,
 * losses, draws, trophy_delta). Streaks, last-N and deck identity stay
 * on the raw rows; the rollup does not carry them.
 *
 * `$players` is a text[] parameter, `$from` a timestamptz, `$to` a
 * timestamptz or null; `types` (a text[] parameter) restricts the raw
 * half by battle type and `modeGroup` (text) the rollup half - the two
 * spellings of one mode filter (typesForModeGroup).
 */

import { MODE_GROUP_BY_TYPE } from "@elixir-mcp/contracts";

const MODE_GROUP_CASE = `case bp.type ${Object.entries(MODE_GROUP_BY_TYPE)
  .map(([t, g]) => `when '${t}' then '${g}'`)
  .join(" ")} else 'casual' end`;

export function dailySql({
  players,
  from,
  to,
  modeGroup = null,
  types = null,
}) {
  const modeRollup = modeGroup ? `and r.mode_group = ${modeGroup}` : "";
  const modeRaw = types ? `and bp.type = any(${types})` : "";
  return `(
    select r.player_tag, r.day, r.mode_group,
           sum(r.battles_captured)::int as battles,
           sum(r.wins)::int as wins, sum(r.losses)::int as losses,
           sum(r.draws)::int as draws, sum(r.trophy_delta)::int as trophy_delta
    from player_daily_battle_rollup r
    where r.player_tag = any(${players})
      and r.day > (${from})::date
      and (${to}::timestamptz is null or r.day < (${to})::date)
      ${modeRollup}
    group by r.player_tag, r.day, r.mode_group
    union all
    select bp.player_tag, bp.battle_time::date as day, ${MODE_GROUP_CASE} as mode_group,
           count(*)::int, count(*) filter (where bp.outcome = 'win')::int,
           count(*) filter (where bp.outcome = 'loss')::int,
           count(*) filter (where bp.outcome = 'draw')::int,
           coalesce(sum(bp.trophy_change), 0)::int
    from battle_participant bp
    where bp.player_tag = any(${players})
      and (
        -- The day the window starts in: a range the (player, time)
        -- index walks, never a cast the planner filters after the fact
        -- (live 2026-09-17: 12,961 rows read for 408 kept, 3.4 s of I/O).
        (bp.battle_time >= ${from}
         and bp.battle_time < (${from})::date + 1
         and (${to}::timestamptz is null or bp.battle_time < ${to}))
        or
        -- The day it ends in, when that is a different day.
        (${to}::timestamptz is not null
         and (${to})::date <> (${from})::date
         and bp.battle_time >= (${to})::date
         and bp.battle_time < ${to})
      )
      ${modeRaw}
    group by bp.player_tag, bp.battle_time::date, ${MODE_GROUP_CASE}
  )`;
}
