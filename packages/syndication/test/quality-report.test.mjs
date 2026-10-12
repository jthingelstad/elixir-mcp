/**
 * The quality ledger read back for the Admin console and the
 * `{discord_review}` op (2026-10-11): a window's numbers by feature, the
 * destinations worth a look first, and one destination's rows whole
 * with their ratings and a clan's model runs. On a scratch database
 * (golden rule 9).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import { newLedgerId, recordPosts, recordRun } from "../src/quality.mjs";
import {
  detailScope,
  qualityDetail,
  qualitySummary,
  ratingsQueue,
} from "../src/quality-report.mjs";

const FP = "0123456789abcdef";
const CLAN = "#J2RGCRVG";
const NOW = Date.parse("2026-10-11T18:00:00Z");
let ctx;
let account;

before(async () => {
  ctx = await scratchDb("quality_report");
  account = (
    await ctx.db.query(
      `insert into account (email_hash, status) values ('qr', 'approved') returning account_id`,
    )
  ).rows[0].account_id;
});
after(async () => ctx?.drop());

const row = (extra = {}) => ({
  post_id: newLedgerId(),
  feature: "clan_activity",
  clan_tag: CLAN,
  destination: "1234567890",
  webhook_fp: FP,
  post_key: "tl_0123456789abcdef0123",
  revision: 1,
  action: "post",
  mode: "model",
  items: [{ id: "tl_0123456789abcdef0123", kind: "member_joined" }],
  content: "Ada joined us.",
  observed_at: "2026-10-11T12:00:00Z",
  handed_at: "2026-10-11T12:01:00Z",
  ...extra,
});

test("a window's numbers by feature, the runs, and the destinations with the most to look at", async () => {
  const good = row();
  const gone = row({ post_key: "tl_00000000000000000001" });
  const lost = row({ post_key: "tl_00000000000000000002" });
  const skip = row({ action: "skip", skip_reason: "A badge level." });
  const line = row({
    feature: "timeline",
    clan_tag: null,
    account_id: account,
    destination: account,
    mode: "line",
  });
  const old = row({ handed_at: "2026-09-01T00:00:00Z" });
  await recordPosts(ctx.db, [good, gone, lost, skip, line, old]);
  const set = (id, sql, args = []) =>
    ctx.db.query(`update discord_post set ${sql} where post_id = $1`, [
      id,
      ...args,
    ]);
  await set(
    good.post_id,
    `outcome = 'posted', outcome_at = '2026-10-11T12:01:30Z',
    checked_at = '2026-10-12T12:00:00Z', present = true, thread = true,
    reactions = '[{"emoji":"🔥","count":3},{"emoji":"👍","count":1}]'`,
  );
  await set(
    gone.post_id,
    `outcome = 'posted', outcome_at = '2026-10-11T12:02:00Z',
    checked_at = '2026-10-12T12:00:00Z', present = false`,
  );
  await set(
    lost.post_id,
    `outcome = 'unknown', outcome_at = '2026-10-11T12:02:00Z'`,
  );
  await set(
    line.post_id,
    `outcome = 'refused', http_status = 400, reason = 'Invalid Form Body'`,
  );
  const {
    rows: [fb],
  } = await ctx.db.query(
    `insert into feedback (account_id, surface, area, category, message, context)
     values ($1, 'web', 'clan', 'general', 'Off.', '{"rating":"down","noted":true}')
     returning feedback_id`,
    [account],
  );
  await ctx.db.query(
    `insert into feedback_ref (feedback_id, kind, ref) values ($1, 'discord_post', $2)`,
    [fb.feedback_id, good.post_id],
  );
  await recordRun(ctx.db, {
    run_id: "run-1",
    clan_tag: CLAN,
    at: new Date("2026-10-11T12:00:30Z"),
    outcome: "ok",
    posts: 2,
    refusals: [{ keys: ["tl_1"], why: "clock_time", text: "at 6:05" }],
    cost_usd: 0.012,
  });
  await recordRun(ctx.db, {
    run_id: "run-2",
    clan_tag: CLAN,
    at: new Date("2026-10-11T13:00:00Z"),
    outcome: "deadline",
  });

  const s = await qualitySummary(ctx.db, { days: 7, nowMs: NOW });
  assert.equal(s.days, 7);
  const activity = s.features.find((f) => f.feature === "clan_activity");
  assert.equal(activity.rows, 4, "the September row is outside the window");
  assert.equal(activity.posts, 3);
  assert.equal(activity.skips, 1);
  assert.equal(activity.outcomes.posted, 2);
  assert.equal(activity.outcomes.unknown, 1);
  assert.equal(activity.modes.model, 4);
  assert.deepEqual(activity.read_back, {
    read: 2,
    still_there: 1,
    deleted: 1,
    with_reactions: 1,
    reactions: 4,
    threads: 1,
  });
  assert.deepEqual(activity.ratings, { up: 0, down: 1, with_note: 1 });
  assert.equal(activity.latency_s.p50, 105);
  const timeline = s.features.find((f) => f.feature === "timeline");
  assert.equal(timeline.outcomes.refused, 1);
  assert.equal(s.runs.runs, 2);
  assert.equal(s.runs.refusals, 1);
  assert.deepEqual(s.runs.not_ok, { deadline: 1 });
  assert.equal(s.runs.cost_usd, 0.012);
  // The clan's channel has a lost post and a deleted one: it comes first.
  assert.equal(s.destinations[0].clan_tag, CLAN);
  assert.equal(s.destinations[0].lost, 1);
  assert.equal(s.destinations[0].deleted, 1);
  assert.equal(s.destinations[0].rated_down, 1);
  assert.equal(
    s.destinations.find((d) => d.feature === "timeline").account_id,
    account,
  );

  const clan = await qualityDetail(ctx.db, { key: "J2RGCRVG" });
  assert.equal(clan.clan_tag, CLAN);
  assert.equal(clan.posts.length, 5);
  const rated = clan.posts.find((p) => p.post_id === good.post_id);
  assert.equal(rated.ratings[0].rating, "down");
  assert.equal(rated.ratings[0].message, "Off.");
  assert.deepEqual(
    clan.runs.map((r) => r.run_id),
    ["run-2", "run-1"],
  );
  const mine = await qualityDetail(ctx.db, { key: account });
  assert.deepEqual(
    mine.posts.map((p) => p.post_id),
    [line.post_id],
  );
  assert.deepEqual(mine.runs, []);

  // The ratings for a review: a thumbs down or a note first, each with
  // the post it rates.
  const {
    rows: [up],
  } = await ctx.db.query(
    `insert into feedback (account_id, surface, area, category, message, context)
     values ($1, 'web', 'console', 'praise', 'Fine.', '{"rating":"up"}')
     returning feedback_id`,
    [account],
  );
  await ctx.db.query(
    `insert into feedback_ref (feedback_id, kind, ref) values ($1, 'discord_post', $2)`,
    [up.feedback_id, line.post_id],
  );
  const q = await ratingsQueue(ctx.db, { days: 7, nowMs: Date.now() });
  assert.deepEqual(
    q.ratings.map((r) => [r.rating, r.noted, r.feature]),
    [
      ["down", true, "clan_activity"],
      ["up", false, "timeline"],
    ],
  );
  assert.equal(q.ratings[0].content, "Ada joined us.");
  assert.equal(q.ratings[1].outcome, "refused");
  assert.equal(q.ratings[0].superseded, false);

  // Rated again, 👎 to 👍: the latest stands in every count, and the
  // first is still in the queue to answer, marked superseded.
  const {
    rows: [again],
  } = await ctx.db.query(
    `insert into feedback (account_id, surface, area, category, message, context, created_at)
     values ($1, 'web', 'clan', 'praise', 'Better.', '{"rating":"up"}', now() + interval '1 second')
     returning feedback_id`,
    [account],
  );
  await ctx.db.query(
    `insert into feedback_ref (feedback_id, kind, ref) values ($1, 'discord_post', $2)`,
    [again.feedback_id, good.post_id],
  );
  const s2 = await qualitySummary(ctx.db, { days: 7, nowMs: NOW + 5_000 });
  assert.deepEqual(
    s2.features.find((f) => f.feature === "clan_activity").ratings,
    { up: 1, down: 0, with_note: 0 },
  );
  assert.equal(s2.destinations.find((d) => d.clan_tag === CLAN).rated_down, 0);
  const q2 = await ratingsQueue(ctx.db, { days: 7, nowMs: Date.now() + 5_000 });
  assert.equal(
    q2.ratings.find((r) => r.feedback_id === fb.feedback_id).superseded,
    true,
  );
});

test("a detail key is a clan tag or an account id, nothing else", () => {
  assert.deepEqual(detailScope("#j2rgcrvg"), { clan_tag: CLAN });
  assert.deepEqual(detailScope("J2RGCRVG"), { clan_tag: CLAN });
  assert.equal(detailScope("'; drop table x"), null);
  assert.equal(detailScope(""), null);
});
