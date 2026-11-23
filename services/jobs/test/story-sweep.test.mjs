/**
 * The stored stories' sweep rides Home's five-minute run (stage 2 of the
 * stored Timeline, 2026-11-23): it wakes a recorded player never written,
 * answers counts only, and a failure in it never fails the run. On a
 * scratch database; the tag is invented (docs/invented-tags.json).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { homeFeeds } from "../src/index.mjs";

const P = "#0PQ2VY";
let ctx;

before(async () => {
  ctx = await scratchDb("story_sweep");
  const {
    rows: [{ account_id }],
  } = await ctx.db.query(
    `insert into account (email_hash, status) values ('sweep', 'approved')
     returning account_id`,
  );
  await ctx.db.query(
    `insert into player (player_tag, name) values ($1, 'Fir')`,
    [P],
  );
  await ctx.db.query(
    `insert into recording (subject_type, subject_tag, requested_by, origin)
     values ('player', $1, $2, 'claim')`,
    [P, account_id],
  );
});

after(async () => {
  await ctx?.drop();
});

test("home_feeds wakes the stories of a recorded player never written", async () => {
  const sent = [];
  const out = await homeFeeds(ctx.url, {
    wakeOutbox: async (lane, msg, opts) => sent.push({ lane, msg, opts }),
  });
  assert.equal(out.stories.woken, 1, JSON.stringify(out));
  assert.equal(out.stories.unwritten, 1);
  assert.equal(out.stories.recorded, 1);
  assert.ok(!JSON.stringify(out).includes(P));
  const story = sent.filter((s) => s.msg.story_player);
  assert.equal(story.length, 1);
  assert.equal(story[0].lane, "timeline-sync");
  assert.equal(story[0].msg.story_player, P);
  assert.equal(story[0].opts.once, true);
});

test("a sweep that fails is counted, and the run still answers", async () => {
  const error = console.error;
  console.error = () => {};
  try {
    const out = await homeFeeds(ctx.url, {
      wakeOutbox: async (_lane, msg) => {
        if (msg.story_player)
          throw Object.assign(new Error("x"), { name: "S3" });
      },
    });
    assert.deepEqual(out.stories, { failed: "S3" });
    assert.equal(typeof out.woken, "number");
  } finally {
    console.error = error;
  }
});
