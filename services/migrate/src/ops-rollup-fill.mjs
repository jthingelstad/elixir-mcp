/**
 * {rollup_fill} (Jamie 2026-10-07): re-derives the daily rollup rows the
 * tracked-only correction removed from the battles it kept. The purge
 * deleted every rollup row of a player outside the keep set, opponents
 * included, but kept their battle rows; battle ingest writes a rollup
 * for every participant. So a kept battle's opponent had no rollup, and
 * if they were tracked later the count reads (the 30-day record,
 * standings) would disagree with the battle reads over the same days.
 *
 * Walks the (player_tag, UTC day) pairs that have a battle and no
 * rollup row, in key order a batch at a time, and recomputes each
 * through the one writer ingest uses (`refreshDailyRollups`). A pair
 * with a battle always produces a row, so the walk converges: a re-run,
 * an overlap with ingest and a resumed cursor all fill the same rows,
 * and once done the census reads zero.
 *
 * One-time: removed once the run is done (the correction's receipt in
 * docs/NOTES.md records it). `{"rollup_fill": {"census": true}}` counts.
 */

import pg from "pg";
import { refreshDailyRollups } from "@elixir-mcp/ingest/rollups";

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// The pairs with a battle and no rollup row; the day is a UTC day, as
// rollups.mjs keys it.
const MISSING = `select x.player_tag, x.day
     from (select distinct bp.player_tag,
                  (bp.battle_time at time zone 'UTC')::date as day
             from battle_participant bp
            where bp.player_tag >= $1) x
    where (x.player_tag, x.day) > ($1, $2::date)
      and not exists (
        select 1 from player_daily_battle_rollup r
         where r.player_tag = x.player_tag and r.day = x.day)`;

async function census(db) {
  const {
    rows: [row],
  } = await db.query(
    `select count(*)::int as missing_pairs,
            count(distinct m.player_tag)::int as players
       from (${MISSING}) m`,
    ["", "0001-01-01"],
  );
  return row;
}

export async function rollupFill(
  databaseUrl,
  {
    after = null,
    batch = 2000,
    budget_s = 45,
    max_batches = Infinity,
    census: countOnly = false,
  } = {},
) {
  const budget = Math.min(Math.max(Number(budget_s), 5), 280) * 1000;
  const size = Math.min(Math.max(Number(batch), 1), 5000);
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  const started = Date.now();
  try {
    if (countOnly) return { ...(await census(db)), ms: Date.now() - started };
    let cursor =
      Array.isArray(after) && after.length === 2 ? after : ["", "0001-01-01"];
    let batches = 0;
    let pairs = 0;
    let done = false;
    while (Date.now() - started < budget && batches < max_batches) {
      const { rows } = await db.query(
        `select m.player_tag, m.day::text as day from (${MISSING}) m
          order by m.player_tag, m.day limit $3`,
        [cursor[0], cursor[1], size],
      );
      batches += 1;
      if (rows.length > 0) {
        for (let attempt = 1; ; attempt += 1) {
          try {
            await refreshDailyRollups(
              db,
              rows.map((r) => ({ playerTag: r.player_tag, day: r.day })),
            );
            break;
          } catch (err) {
            // A batch Postgres picked as the deadlock victim against a
            // collector's submission is replayed after a beat.
            if (err?.code !== "40P01" || attempt >= 3) throw err;
            await pause(1000 * attempt);
          }
        }
        pairs += rows.length;
        const last = rows[rows.length - 1];
        cursor = [last.player_tag, last.day];
      }
      if (rows.length < size) {
        done = true;
        break;
      }
    }
    return {
      batches,
      pairs_filled: pairs,
      after: cursor,
      done,
      ms: Date.now() - started,
    };
  } finally {
    await db.end();
  }
}
