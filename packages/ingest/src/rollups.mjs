/**
 * Daily battle rollups — DESIGN §4.5, §5.4.
 *
 * Recomputed per (player, UTC day) from the battles in one statement:
 * rollups are derived, battles are the truth. mode_group is data, not
 * code — one mapping shared by the SQL. Completeness is computed at read time from matched observation
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

const COUNTS = [
  "wins",
  "losses",
  "draws",
  "crowns_for",
  "crowns_against",
  "trophy_delta",
  "battles_captured",
  "boat_defenses",
  "boat_defense_wins",
  "boat_defense_losses",
];

/**
 * Recompute rollups for a set of {playerTag, day} pairs, in ONE statement.
 * It used to delete and re-insert each
 * pair in the order the observer's battles arrived, and it is the one
 * multi-row write on the battle path: two observers holding the same
 * players' battles took those row locks in different orders, a
 * plausible source of the battlelog deadlocks on 09-18. Now the keys go
 * in sorted and deduplicated, the upsert locks rows in that one order,
 * a row whose numbers did not change is not rewritten (IS DISTINCT
 * FROM), and one DELETE removes the rows the recomputation no longer
 * produces for those keys. Every CTE reads the same snapshot, and the
 * upsert and the delete touch disjoint rows.
 */
export async function refreshDailyRollups(db, pairs) {
  const keys = [...new Set(pairs.map((p) => `${p.playerTag}|${p.day}`))]
    .map((k) => k.split("|"))
    .sort(([ta, da], [tb, db_]) =>
      ta < tb ? -1 : ta > tb ? 1 : da < db_ ? -1 : da > db_ ? 1 : 0,
    );
  if (keys.length === 0) return;
  await db.query(
    `with keys as (
       select k.player_tag, k.day
       from unnest($1::text[], $2::date[]) as k(player_tag, day)
     ),
     fresh as (
       select bp.player_tag, k.day, ${MODE_GROUP_CASE} as mode_group,
              coalesce(b.game_mode_id, 0) as game_mode_id,
              count(*) filter (where bp.outcome = 'win') as wins,
              count(*) filter (where bp.outcome = 'loss') as losses,
              count(*) filter (where bp.outcome = 'draw') as draws,
              coalesce(sum(bp.crowns), 0) as crowns_for,
              coalesce(sum(opp.crowns), 0) as crowns_against,
              coalesce(sum(bp.trophy_change), 0) as trophy_delta,
              count(*) as battles_captured,
              count(*) filter (where ${DEFENSE}) as boat_defenses,
              count(*) filter (where ${DEFENSE} and bp.outcome = 'win') as boat_defense_wins,
              count(*) filter (where ${DEFENSE} and bp.outcome = 'loss') as boat_defense_losses
       from keys k
       join battle_participant bp on bp.player_tag = k.player_tag
         -- The day is a UTC day, spelled so. The KEY is written in UTC
         -- (pipeline.mjs takes battle_time.slice(0,10) off the ISO
         -- string), but a plain date cast compared against a timestamptz
         -- resolves at the SESSION zone, so on a non-UTC session the
         -- window and the key describe different days and a battle in
         -- the offset hours lands in neither. Production runs UTC and
         -- was never wrong; a developer machine on America/Chicago is,
         -- for the five hours after UTC midnight, which is what made
         -- the clans_standings test red only at night (2026-09-23).
         and bp.battle_time >= (k.day)::timestamp at time zone 'UTC'
         and bp.battle_time < (k.day + 1)::timestamp at time zone 'UTC'
       join battle b on b.battle_id = bp.battle_id
       left join lateral (
         select max(o.crowns) as crowns from battle_participant o
         where o.battle_id = bp.battle_id and o.side <> bp.side
       ) opp on true
       group by bp.player_tag, k.day, ${MODE_GROUP_CASE}, coalesce(b.game_mode_id, 0)
     ),
     upserted as (
       insert into player_daily_battle_rollup
         (player_tag, day, mode_group, game_mode_id, ${COUNTS.join(", ")})
       select player_tag, day, mode_group, game_mode_id, ${COUNTS.join(", ")}
       from fresh
       order by player_tag, day, mode_group, game_mode_id
       on conflict (player_tag, day, mode_group, game_mode_id) do update set
         ${COUNTS.map((c) => `${c} = excluded.${c}`).join(",\n         ")}
       where (${COUNTS.map((c) => `player_daily_battle_rollup.${c}`).join(", ")})
         is distinct from (${COUNTS.map((c) => `excluded.${c}`).join(", ")})
       returning 1
     )
     delete from player_daily_battle_rollup r
     using keys k
     where r.player_tag = k.player_tag and r.day = k.day
       and not exists (
         select 1 from fresh f
         where f.player_tag = r.player_tag and f.day = r.day
           and f.mode_group = r.mode_group and f.game_mode_id = r.game_mode_id
       )`,
    [keys.map(([t]) => t), keys.map(([, d]) => d)],
  );
}
