/**
 * {rollup_fill} over a scratch database (2026-10-07): the tracked-only
 * correction kept battles but deleted their opponents' rollup rows. The
 * op finds the (player, day) pairs with a battle and no rollup, fills
 * them through ingest's own writer a batch at a time from a cursor,
 * leaves a pair that has its rows alone, and a rerun writes nothing.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { refreshDailyRollups } from "@elixir-mcp/ingest/rollups";
import { rollupFill } from "../src/ops-rollup-fill.mjs";

let ctx;
const A = "#2PYLQGR";
const O = "#2PYLQGU";
const P = "#2PYLQGV";

let n = 0;
async function battle(player, opponent, at) {
  const id = `rf-${++n}`;
  await ctx.db.query(
    `insert into battle (battle_id, battle_time, type, type_class)
     values ($1, $2::timestamptz, 'PvP', 'pvp')`,
    [id, at],
  );
  await ctx.db.query(
    `insert into battle_participant (battle_id, player_tag, side, outcome, battle_time, type, type_class, crowns)
     values ($1, $2, 0, 'win', $3::timestamptz, 'PvP', 'pvp', 2),
            ($1, $4, 1, 'loss', $3::timestamptz, 'PvP', 'pvp', 1)`,
    [id, player, at, opponent],
  );
}

const state = async () =>
  (
    await ctx.db.query(
      `select player_tag, day::text as day, wins::int as w, losses::int as l,
              battles_captured::int as n
         from player_daily_battle_rollup order by 1, 2`,
    )
  ).rows;

before(async () => {
  ctx = await scratchDb("rollup_fill");
  await ctx.db.query("set timezone to 'UTC'");
  for (const t of [A, O, P])
    await ctx.db.query("insert into player (player_tag) values ($1)", [t]);
  await battle(A, O, "2026-08-01T12:00:00Z");
  await battle(A, O, "2026-08-01T13:00:00Z");
  await battle(A, P, "2026-08-02T23:30:00Z");
  // A is tracked: its rows are there. The opponents' were purged.
  await refreshDailyRollups(ctx.db, [
    { playerTag: A, day: "2026-08-01" },
    { playerTag: A, day: "2026-08-02" },
  ]);
});

after(async () => {
  await ctx?.drop();
});

test("census counts the pairs with a battle and no rollup", async () => {
  const c = await rollupFill(ctx.url, { census: true });
  assert.equal(c.missing_pairs, 2);
  assert.equal(c.players, 2);
});

test("fills a batch at a time from the cursor, then converges", async () => {
  const first = await rollupFill(ctx.url, { batch: 1, max_batches: 1 });
  assert.equal(first.done, false);
  assert.equal(first.pairs_filled, 1);
  assert.deepEqual(first.after, [O, "2026-08-01"]);

  let cursor = first.after;
  let pairs = first.pairs_filled;
  for (let i = 0; i < 10; i++) {
    const r = await rollupFill(ctx.url, { after: cursor, batch: 1 });
    pairs += r.pairs_filled;
    cursor = r.after;
    if (r.done) break;
  }
  assert.equal(pairs, 2, "only the pairs that had no row");
  assert.deepEqual(await state(), [
    { player_tag: A, day: "2026-08-01", w: 2, l: 0, n: 2 },
    { player_tag: A, day: "2026-08-02", w: 1, l: 0, n: 1 },
    { player_tag: O, day: "2026-08-01", w: 0, l: 2, n: 2 },
    { player_tag: P, day: "2026-08-02", w: 0, l: 1, n: 1 },
  ]);

  const c = await rollupFill(ctx.url, { census: true });
  assert.equal(c.missing_pairs, 0);
  const again = await rollupFill(ctx.url, {});
  assert.equal(again.done, true);
  assert.equal(again.pairs_filled, 0, "a rerun writes nothing");
});
