/**
 * {rollup_regroup} (#109, Jamie 2026-09-28): re-derives the daily rollup
 * rows the clanmate ruling moved. A clanmate battle (`clanMate`,
 * `clanMate2v2`) is casual even when it carries an event tag, and until
 * 9.12.8 the rollup filed a tagged one under `event`. The meta tables
 * need nothing: their population leaves out every tagged battle, so they
 * never held one. A tagged `unknown` was already `event` and stays so.
 *
 * Only `player_daily_battle_rollup` stores the group per battle, so this
 * walks its `event` rows by (player_tag, day), keeps the pairs whose day
 * holds a tagged clanmate battle and whose event rows count more battles
 * than the day holds event content, and recomputes each through the one
 * writer ingest uses (`refreshDailyRollups`, which rewrites a row only
 * when its numbers change and deletes the rows it no longer produces).
 * A re-run, an overlap with ingest and a resumed cursor all converge, and
 * a re-run writes nothing.
 *
 * The migration skill's anatomy: keyset on the primary key's leading
 * columns, a batch per statement, a 45 s budget, a cursor passed back
 * until `done`, a deadlock retried. Rows only: no event, no moment.
 * `{"rollup_regroup": {"census": true}}` counts instead: the tagged
 * clanmate battles, and the event rollup pairs still misfiled.
 * No `{vacuum}` after: the table is not on its allowlist, and the one
 * run (2026-09-28, about 2,400 pairs) is small enough for autovacuum.
 */

import pg from "pg";
import { CLANMATE_TYPES, eventContentSql } from "@elixir-mcp/contracts";
import { refreshDailyRollups } from "../../ingest/src/rollups.mjs";

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// A player's battles on the pair's UTC day, spelled as rollups.mjs does.
const onDay = (a) => `bp.player_tag = ${a}.player_tag
     and bp.battle_time >= (${a}.day)::timestamp at time zone 'UTC'
     and bp.battle_time < (${a}.day + 1)::timestamp at time zone 'UTC'`;

// The pair is misfiled: its day holds a tagged clanmate battle, and its
// event rows count more battles than the day holds event content. `a` is
// the alias of an event pair carrying `filed` (its event rows' summed
// battles_captured); `$1` carries CLANMATE_TYPES. A pair already right
// (a real event beside a regrouped friendly) is not.
const misfiled = (a) => `(exists (
    select 1 from battle_participant bp
      join battle b on b.battle_id = bp.battle_id
     where ${onDay(a)}
       and b.type = any($1::text[]) and b.event_tag is not null)
  and ${a}.filed <> (
    select count(*) from battle_participant bp
      join battle b on b.battle_id = bp.battle_id
     where ${onDay(a)}
       and ${eventContentSql("b.type", "b.event_tag")}))`;

async function census(db) {
  const {
    rows: [battles],
  } = await db.query(
    `select count(*)::int as tagged_clanmate_battles
       from battle b
      where b.type = any($1::text[]) and b.event_tag is not null`,
    [CLANMATE_TYPES],
  );
  const {
    rows: [pairs],
  } = await db.query(
    `select count(*)::int as event_pairs_to_move
       from (select r.player_tag, r.day, sum(r.battles_captured) as filed
               from player_daily_battle_rollup r
              where r.mode_group = 'event'
              group by r.player_tag, r.day) x
      where ${misfiled("x")}`,
    [CLANMATE_TYPES],
  );
  return { ...battles, ...pairs };
}

export async function rollupRegroup(
  databaseUrl,
  {
    after = null,
    batch = 500,
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
    let moved = 0;
    let done = false;
    while (Date.now() - started < budget && batches < max_batches) {
      // The next `size` event pairs past the cursor, and which of them
      // are misfiled (only those are recomputed).
      const { rows } = await db.query(
        `select p.player_tag, p.day::text as day, ${misfiled("p")} as moves
           from (select r.player_tag, r.day, sum(r.battles_captured) as filed
                   from player_daily_battle_rollup r
                  where r.mode_group = 'event'
                    and (r.player_tag, r.day) > ($2, $3::date)
                  group by r.player_tag, r.day
                  order by r.player_tag, r.day
                  limit $4) p
          order by p.player_tag, p.day`,
        [CLANMATE_TYPES, cursor[0], cursor[1], size],
      );
      batches += 1;
      if (rows.length > 0) {
        const last = rows[rows.length - 1];
        cursor = [last.player_tag, last.day];
      }
      const todo = rows.filter((r) => r.moves);
      if (todo.length > 0) {
        for (let attempt = 1; ; attempt += 1) {
          try {
            const tags = todo.map((r) => r.player_tag);
            const days = todo.map((r) => r.day);
            // The battles the pairs' event rows count, before and after.
            const count = async () =>
              (
                await db.query(
                  `select coalesce(sum(r.battles_captured), 0)::int as n
                     from player_daily_battle_rollup r
                     join unnest($1::text[], $2::date[]) as k(player_tag, day)
                       on k.player_tag = r.player_tag and k.day = r.day
                    where r.mode_group = 'event'`,
                  [tags, days],
                )
              ).rows[0].n;
            const before = await count();
            await refreshDailyRollups(
              db,
              todo.map((r) => ({ playerTag: r.player_tag, day: r.day })),
            );
            moved += before - (await count());
            pairs += todo.length;
            break;
          } catch (err) {
            // A batch Postgres picked as the deadlock victim against a
            // collector's submission is replayed after a beat.
            if (err?.code !== "40P01" || attempt >= 3) throw err;
            await pause(1000 * attempt);
          }
        }
      }
      if (rows.length < size) {
        done = true;
        break;
      }
    }
    const {
      rows: [{ ahead }],
    } = await db.query(
      `select count(*)::int as ahead from player_daily_battle_rollup r
        where r.mode_group = 'event' and (r.player_tag, r.day) > ($1, $2::date)`,
      cursor,
    );
    return {
      batches,
      pairs_recomputed: pairs,
      event_battles_refiled: moved,
      after: cursor,
      done,
      event_rows_ahead: ahead,
      ms: Date.now() - started,
    };
  } finally {
    await db.end();
  }
}
