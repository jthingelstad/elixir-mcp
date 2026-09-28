/**
 * {rollup_regroup} over a scratch database (#109): daily rollup rows
 * written before 9.12.8 filed a tagged clanmate battle under `event`.
 * The op finds the event pairs whose day holds one, recomputes them
 * through ingest's own writer a batch at a time from a cursor, leaves a
 * true event row alone, and a rerun writes nothing.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import { rollupRegroup } from "../src/ops-rollup-regroup.mjs";

let ctx;
const A = "#2PYLQG0";
const B = "#2PYLQG8";
const O = "#2PYLQGC";

let n = 0;
async function battle(player, type, tag, at) {
  const id = `rr-${++n}`;
  await ctx.db.query(
    `insert into battle (battle_id, battle_time, type, type_class, event_tag)
     values ($1, $2::timestamptz, $3, 'pvp', $4)`,
    [id, at, type, tag],
  );
  await ctx.db.query(
    `insert into battle_participant (battle_id, player_tag, side, outcome, battle_time, type, type_class, crowns)
     values ($1, $2, 0, 'win', $3::timestamptz, $4, 'pvp', 1),
            ($1, $5, 1, 'loss', $3::timestamptz, $4, 'pvp', 0)`,
    [id, player, at, type, O],
  );
}

/** A rollup row as the old fold wrote it. */
async function staleRow(player, day, group, wins) {
  await ctx.db.query(
    `insert into player_daily_battle_rollup
       (player_tag, day, mode_group, game_mode_id, wins, crowns_for, battles_captured)
     values ($1, $2, $3, 0, $4, $4, $4)`,
    [player, day, group, wins],
  );
}

const state = async () =>
  (
    await ctx.db.query(
      `select player_tag, day::text as day, mode_group, battles_captured::int as n
         from player_daily_battle_rollup order by 1, 2, 3`,
    )
  ).rows;

before(async () => {
  ctx = await scratchDb("rollup_regroup");
  await ctx.db.query("set timezone to 'UTC'");
  for (const t of [A, B, O])
    await ctx.db.query("insert into player (player_tag) values ($1)", [t]);
  // A, day 1: a clanmate friendly under an event's rules, alone.
  await battle(A, "clanMate", "#EV1", "2026-08-01T12:00:00Z");
  await staleRow(A, "2026-08-01", "event", 1);
  // A, day 2: a tagged 2v2 with a clanmate beside a real event battle,
  // which the old fold pooled into one event row.
  await battle(A, "clanMate2v2", "#EV1", "2026-08-02T12:00:00Z");
  await battle(A, "trail", "#EV2", "2026-08-02T13:00:00Z");
  await staleRow(A, "2026-08-02", "event", 2);
  // B, day 3: a real event battle; its row is right and stays.
  await battle(B, "unknown", "#EV3", "2026-08-03T12:00:00Z");
  await staleRow(B, "2026-08-03", "event", 1);
  // B, day 4: an untagged friendly, casual all along.
  await battle(B, "friendly", null, "2026-08-04T12:00:00Z");
  await staleRow(B, "2026-08-04", "casual", 1);
});

after(async () => {
  await ctx?.drop();
});

test("census counts the tagged clanmate battles and the pairs still to move", async () => {
  const c = await rollupRegroup(ctx.url, { census: true });
  assert.equal(c.tagged_clanmate_battles, 2);
  assert.equal(c.event_pairs_to_move, 2);
});

test("regroups a batch at a time from the cursor, then converges", async () => {
  const first = await rollupRegroup(ctx.url, { batch: 1, max_batches: 1 });
  assert.equal(first.done, false);
  assert.equal(first.pairs_recomputed, 1);
  assert.equal(first.event_battles_refiled, 1);
  assert.deepEqual(first.after, [A, "2026-08-01"]);
  assert.equal(first.event_rows_ahead, 2);

  let cursor = first.after;
  let pairs = first.pairs_recomputed;
  for (let i = 0; i < 10; i++) {
    const r = await rollupRegroup(ctx.url, { after: cursor, batch: 1 });
    pairs += r.pairs_recomputed;
    cursor = r.after;
    if (r.done) {
      assert.equal(r.event_rows_ahead, 0);
      break;
    }
  }
  assert.equal(pairs, 2, "only the pairs holding a tagged clanmate battle");
  assert.deepEqual(await state(), [
    { player_tag: A, day: "2026-08-01", mode_group: "casual", n: 1 },
    { player_tag: A, day: "2026-08-02", mode_group: "casual", n: 1 },
    { player_tag: A, day: "2026-08-02", mode_group: "event", n: 1 },
    { player_tag: B, day: "2026-08-03", mode_group: "event", n: 1 },
    { player_tag: B, day: "2026-08-04", mode_group: "casual", n: 1 },
  ]);

  const c = await rollupRegroup(ctx.url, { census: true });
  assert.equal(c.event_pairs_to_move, 0);
  const again = await rollupRegroup(ctx.url, {});
  assert.equal(again.done, true);
  assert.equal(again.pairs_recomputed, 0, "a rerun writes nothing");
  assert.equal(again.event_battles_refiled, 0);
});
