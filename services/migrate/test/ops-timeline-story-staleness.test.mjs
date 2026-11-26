/**
 * {timeline_story_staleness} (stage 2 of the stored Timeline, 2026-11-23):
 * a read in every shape it takes, counts only, in a read-only
 * transaction, and refusals for anything else. On a scratch database;
 * every tag is invented (docs/invented-tags.json).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { classifyOp } from "../../../infra/scripts/lib/ops-invoke.mjs";
import {
  storySpan,
  writeSubjectStories,
} from "@elixir-mcp/tools/activity/story-store";
import {
  readStalenessSpec,
  timelineStoryStaleness,
} from "../src/ops-timeline-story-staleness.mjs";

const WRITTEN = "#0L98VL0Y";
const UNWRITTEN = "#0PYLQ2";
const MIN = 60_000;
const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();

let ctx, db;

before(async () => {
  ctx = await scratchDb("timeline_story_staleness");
  db = ctx.db;
  const {
    rows: [{ account_id }],
  } = await db.query(
    `insert into account (email_hash, status) values ('staleness', 'approved')
     returning account_id`,
  );
  for (const tag of [WRITTEN, UNWRITTEN]) {
    await db.query(`insert into player (player_tag, name) values ($1, 'Ash')`, [
      tag,
    ]);
    await db.query(
      `insert into recording (subject_type, subject_tag, requested_by, origin)
       values ('player', $1, $2, 'claim')`,
      [tag, account_id],
    );
  }
  for (const [i, ms] of [
    NOW - 3 * 60 * MIN,
    NOW - 3 * 60 * MIN + 5 * MIN,
  ].entries()) {
    await db.query(
      `insert into battle (battle_id, battle_time, type, type_class, created_at)
       values ($1, $2, 'PvP', 'pvp', $3)`,
      [`stale-${i}`, iso(ms), iso(ms + MIN)],
    );
    await db.query(
      `insert into battle_participant
         (battle_id, player_tag, battle_time, side, type, type_class, crowns, trophy_change, outcome)
       values ($1, $2, $3, 0, 'PvP', 'pvp', 3, 30, 'win')`,
      [`stale-${i}`, WRITTEN, iso(ms)],
    );
  }
  await writeSubjectStories(db, "player", WRITTEN, storySpan(NOW));
});

after(async () => {
  await ctx?.drop();
});

test("it is a read in both shapes the catalogue gives, and a write in no other", () => {
  assert.equal(
    classifyOp("migrate", { timeline_story_staleness: true }).kind,
    "read",
  );
  assert.equal(
    classifyOp("migrate", { timeline_story_staleness: { budget_ms: 5000 } })
      .kind,
    "read",
  );
  assert.equal(
    classifyOp("migrate", { timeline_story_staleness: { after: "x" } }).kind,
    "write",
  );
});

test("the request is checked", () => {
  assert.deepEqual(readStalenessSpec(true), { budgetMs: 45_000 });
  assert.deepEqual(readStalenessSpec({ budget_ms: 2000 }), { budgetMs: 2000 });
  assert.equal(readStalenessSpec({ budget_ms: 5 }).error.length > 0, true);
  assert.deepEqual(readStalenessSpec({ tag: WRITTEN }), {
    error: "unknown_keys",
    keys: ["tag"],
  });
  assert.ok(readStalenessSpec([]).error);
});

test("the answer counts players, writes and gaps, with no tag", async () => {
  const out = await timelineStoryStaleness(db, { budgetMs: 10_000 });
  assert.deepEqual(Object.keys(out).sort(), [
    "build_ms_avg",
    "build_ms_max",
    "clans",
    "complete",
    "ms",
    "oldest_gap_s",
    "oldest_write_s",
    "open_quiet",
    "players_recorded",
    "players_stale",
    "players_unwritten",
    "players_with_rows",
    "players_written",
    "probed",
  ]);
  assert.equal(out.players_recorded, 2);
  assert.equal(out.players_with_rows, 1);
  assert.equal(out.players_written, 1);
  assert.equal(out.players_unwritten, 1);
  assert.equal(out.players_stale, 0);
  assert.equal(out.oldest_gap_s, null);
  assert.equal(out.complete, true);
  for (const tag of [WRITTEN, UNWRITTEN])
    assert.ok(!JSON.stringify(out).includes(tag));
  // The record learns a battle after the write: one stale player.
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class, created_at)
     values ('stale-late', $1, 'PvP', 'pvp', now())`,
    [iso(Date.now() - 10 * MIN)],
  );
  await db.query(
    `insert into battle_participant
       (battle_id, player_tag, battle_time, side, type, type_class, crowns, trophy_change, outcome)
     values ('stale-late', $1, $2, 0, 'PvP', 'pvp', 3, 30, 'win')`,
    [WRITTEN, iso(Date.now() - 10 * MIN)],
  );
  const later = await timelineStoryStaleness(
    db,
    { budgetMs: 10_000 },
    { now: Date.now() + 1000 },
  );
  assert.equal(later.players_stale, 1);
  assert.ok(later.oldest_gap_s >= 0);
});

test("it runs in a read-only transaction and leaves none open", async () => {
  let seen = null;
  const spy = {
    query: async (sql, params) => {
      if (/read only/i.test(String(sql))) seen = sql;
      return db.query(sql, params);
    },
  };
  await timelineStoryStaleness(spy, { budgetMs: 1000 });
  assert.match(seen, /begin transaction read only/);
  const {
    rows: [{ state }],
  } = await db.query(
    "select (case when now() = statement_timestamp() then 'none' else 'open' end) as state",
  );
  assert.equal(state, "none");
});
