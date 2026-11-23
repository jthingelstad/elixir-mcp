/**
 * {timeline_story_backfill} (0314; stage 1 of the stored Timeline,
 * 2026-11-23): batches follow an md5 cursor to done, the done batch
 * reports the table's rows and size, a second pass writes nothing, a
 * failing player is counted and passed, and the answer names no tag.
 * Every tag is invented (docs/invented-tags.json).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { classifyOp } from "../../../infra/scripts/lib/ops-invoke.mjs";
import { readSpec, timelineStoryBackfill } from "../src/ops-timeline-story.mjs";

const ONE = "#0L98VL0Y";
const TWO = "#0PYLQ2";
const QUIET = "#0Q2L8"; // recorded, no battles: no stories
const UNRECORDED = "#0JR2U89V";
const MIN = 60_000;
const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();

let ctx, db;

async function battle(id, tag, ms) {
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class, created_at)
     values ($1, $2, 'PvP', 'pvp', $3)`,
    [id, iso(ms), iso(ms + MIN)],
  );
  await db.query(
    `insert into battle_participant
       (battle_id, player_tag, battle_time, side, type, type_class, crowns, trophy_change, outcome)
     values ($1, $2, $3, 0, 'PvP', 'pvp', 3, 30, 'win')`,
    [id, tag, iso(ms)],
  );
}

before(async () => {
  ctx = await scratchDb("timeline_story_backfill");
  db = ctx.db;
  const owner = (
    await db.query(
      "insert into account(email_hash,status) values ('backfill-owner','approved') returning account_id",
    )
  ).rows[0].account_id;
  for (const tag of [ONE, TWO, QUIET, UNRECORDED])
    await db.query("insert into player(player_tag,name) values ($1,'Pine')", [
      tag,
    ]);
  for (const tag of [ONE, TWO, QUIET])
    await db.query(
      "insert into recording (subject_type,subject_tag,requested_by,status) values ('player',$1,$2,'active')",
      [tag, owner],
    );
  for (const tag of [ONE, TWO, UNRECORDED])
    for (const m of [130, 125])
      await battle(`backfill-${tag}-${m}`, tag, NOW - m * MIN);
});

after(async () => {
  await ctx?.drop();
});

test("the spec is checked, and the op is a write", () => {
  assert.deepEqual(readSpec({}), {
    after: null,
    limit: 100,
    budgetMs: 45_000,
  });
  assert.deepEqual(readSpec(true), readSpec({}));
  assert.equal(readSpec({ tag: ONE }).error, "unknown_keys");
  assert.match(readSpec({ after: ONE }).error, /cursor/);
  assert.match(readSpec({ limit: 0 }).error, /limit/);
  assert.match(readSpec({ limit: 1001 }).error, /limit/);
  assert.match(readSpec({ budget_ms: 999 }).error, /budget_ms/);
  assert.match(readSpec([]).error, /object/);
  assert.equal(
    classifyOp("migrate", { timeline_story_backfill: {} }).kind,
    "write",
  );
});

test("batches follow the cursor to done; done reports rows and size; a second pass writes nothing", async () => {
  const seen = [];
  let spec = readSpec({ limit: 2 });
  const first = await timelineStoryBackfill(db, spec, { now: NOW });
  assert.equal(first.players, 2);
  assert.equal(first.done, false);
  assert.equal(first.remaining, 1);
  assert.match(first.after, /^[0-9a-f]{32}$/);
  assert.equal(first.size.rows, undefined);
  seen.push(first);
  spec = readSpec({ limit: 2, after: first.after });
  const last = await timelineStoryBackfill(db, spec, { now: NOW });
  assert.equal(last.players, 1);
  assert.equal(last.done, true);
  assert.equal(last.after, null);
  assert.equal(last.remaining, 0);
  seen.push(last);
  const total = (k) => seen.reduce((n, r) => n + r[k], 0);
  // Two recorded players with a sitting each; the unrecorded one is not read.
  assert.equal(total("stories"), 2);
  assert.equal(total("written"), 2);
  assert.equal(total("failed"), 0);
  assert.equal(last.size.rows, 2);
  assert.ok(last.size.avg_item_bytes > 0);
  assert.ok(last.size.total_bytes >= last.size.heap_bytes);
  assert.ok(last.vacuumed);
  const { rows } = await db.query(
    "select distinct subject_tag from timeline_story order by 1",
  );
  assert.deepEqual(
    rows.map((r) => r.subject_tag),
    [ONE, TWO].sort(),
  );
  for (const r of seen)
    for (const tag of [ONE, TWO, QUIET])
      assert.ok(!JSON.stringify(r).includes(tag), "a tag in the answer");

  const again = await timelineStoryBackfill(db, readSpec({}), { now: NOW });
  assert.equal(again.players, 3);
  assert.equal(again.written, 0);
  assert.equal(again.deleted, 0);
  assert.equal(again.done, true);
});

test("a player whose build fails is counted and passed", async () => {
  let n = 0;
  const r = await timelineStoryBackfill(db, readSpec({}), {
    now: NOW,
    write: async () => {
      n += 1;
      if (n === 2) throw Object.assign(new Error(`bad ${TWO}`), { code: "X1" });
      return { stories: 0, written: 0, deleted: 0 };
    },
  });
  assert.equal(r.players, 3);
  assert.equal(r.failed, 1);
  assert.equal(r.done, true);
});
