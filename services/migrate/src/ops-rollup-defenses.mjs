/**
 * Fill the rollups' boat-defense columns (0171) from recorded battles:
 * {rollup_boat_defenses: {from: "YYYY-MM-DD", to: "YYYY-MM-DD", apply?}}.
 * Dry run by default (how many rollup rows would change, and the
 * defenses in the range); apply writes. Idempotent; run in date chunks.
 * Ingest writes the columns for every day it recomputes from 0171 on.
 */

import pg from "pg";
import { modeGroupSql } from "@elixir-mcp/contracts";

const MODE_GROUP_CASE = modeGroupSql("b.type", "b.event_tag");

const DEFENSES_SQL = `
  select bp.player_tag, (bp.battle_time at time zone 'UTC')::date as day,
         ${MODE_GROUP_CASE} as mode_group, coalesce(b.game_mode_id, 0) as game_mode_id,
         count(*)::int as n,
         count(*) filter (where bp.outcome = 'win')::int as w,
         count(*) filter (where bp.outcome = 'loss')::int as l
    from battle b
    join battle_participant bp on bp.battle_id = b.battle_id
   where b.boat_battle_side is not null
     and (b.boat_battle_side = 'defender') = (bp.side = 0)
     and bp.battle_time >= ($1::date)::timestamp at time zone 'UTC'
     and bp.battle_time < ($2::date)::timestamp at time zone 'UTC'
   group by 1, 2, 3, 4`;

export async function rollupBoatDefenses(databaseUrl, spec = {}) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(String(spec.from)) || !re.test(String(spec.to)))
    throw new Error("rollup_boat_defenses needs from and to as YYYY-MM-DD");
  const apply = spec.apply === true;
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query("set statement_timeout = '600s'");
    const params = [spec.from, spec.to];
    const {
      rows: [plan],
    } = await db.query(
      `select count(*)::int as defense_groups, coalesce(sum(d.n), 0)::int as defenses,
              count(r.player_tag) filter (
                where r.boat_defenses <> d.n or r.boat_defense_wins <> d.w
                   or r.boat_defense_losses <> d.l)::int as rows_to_change
         from (${DEFENSES_SQL}) d
         left join player_daily_battle_rollup r
           on r.player_tag = d.player_tag and r.day = d.day
          and r.mode_group = d.mode_group and r.game_mode_id = d.game_mode_id`,
      params,
    );
    let updated = 0;
    if (apply) {
      const { rowCount } = await db.query(
        `update player_daily_battle_rollup r
            set boat_defenses = d.n, boat_defense_wins = d.w, boat_defense_losses = d.l
           from (${DEFENSES_SQL}) d
          where r.player_tag = d.player_tag and r.day = d.day
            and r.mode_group = d.mode_group and r.game_mode_id = d.game_mode_id
            and (r.boat_defenses <> d.n or r.boat_defense_wins <> d.w
                 or r.boat_defense_losses <> d.l)`,
        params,
      );
      updated = rowCount;
    }
    return { from: spec.from, to: spec.to, apply, ...plan, updated };
  } finally {
    await db.end();
  }
}
