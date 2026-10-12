/**
 * The quality ledger of Elixir's Discord posts (0222): rows written as
 * posts are handed over, the relay's answers filled in from receipts
 * (a delivery's answer over a duplicate's "unchanged", never another
 * over it), an edit that found its message deleted marking the post,
 * a write that fails never aborting the delivery's transaction, and the
 * 90-day keep. On a scratch database (golden rule 9).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import {
  QUALITY_KEEP_DAYS,
  aside,
  applyReceipts,
  newLedgerId,
  postRow,
  purgeQuality,
  readbackCandidates,
  receiptsOf,
  recordPosts,
  recordRun,
  runRawKey,
} from "../src/quality.mjs";

const FP = "0123456789abcdef";
const ACCOUNT = "0b6b5a59-0e4f-4f39-9d55-58e41b6a3e7a";
let ctx;

before(async () => {
  ctx = await scratchDb("quality");
});
after(async () => ctx?.drop());

const row = (extra = {}) => ({
  post_id: newLedgerId(),
  feature: "timeline",
  account_id: ACCOUNT,
  destination: ACCOUNT,
  webhook_fp: FP,
  post_key: "tl_0123456789abcdef0123",
  revision: 3,
  action: "post",
  mode: "line",
  items: [{ id: "tl_0123456789abcdef0123", kind: "battle" }],
  content: "Ada won a ladder battle.",
  event_at: "2026-10-11T12:00:00Z",
  observed_at: "2026-10-11T12:05:00Z",
  handed_at: "2026-10-11T12:06:00Z",
  ...extra,
});
const read = async (id) =>
  (await ctx.db.query("select * from discord_post where post_id = $1", [id]))
    .rows[0];

test("a row that is not one is dropped, never written: no webhook, no stray fields", async () => {
  assert.equal(postRow(row({ webhook_fp: "https://discord.com/x" })), null);
  assert.equal(postRow(row({ feature: "email" })), null);
  assert.equal(postRow(row({ post_id: "nope" })), null);
  const kept = postRow(
    row({ webhook: "https://discord.com/api/webhooks/1/x" }),
  );
  assert.equal("webhook" in kept, false);
  // A skip is settled when it is decided.
  const skip = postRow(row({ action: "skip", skip_reason: "Told before." }));
  assert.equal(skip.outcome, "skipped");
});

test("receipts fill a post in; a duplicate's 'unchanged' never overwrites a delivery's answer, and a delivery's replaces it", async () => {
  const a = row();
  const b = row({ post_key: "tl_00000000000000000001" });
  const skip = row({ action: "skip", skip_reason: "A badge level." });
  assert.equal(await recordPosts(ctx.db, [a, b, skip, { nope: true }]), 3);
  assert.equal((await read(skip.post_id)).outcome, "skipped");

  // The second copy of a notification is read first: "unchanged", then
  // the delivery's own "posted" replaces it.
  await applyReceipts(ctx.db, [
    { ledger_id: a.post_id, outcome: "unchanged", at: "2026-10-11T12:06:30Z" },
  ]);
  await applyReceipts(ctx.db, [
    { ledger_id: a.post_id, outcome: "posted", at: "2026-10-11T12:06:10Z" },
    {
      ledger_id: b.post_id,
      outcome: "refused",
      at: "2026-10-11T12:06:12Z",
      http_status: 400,
      reason: "Invalid Form Body",
    },
  ]);
  // And never the other way round.
  await applyReceipts(ctx.db, [
    { ledger_id: a.post_id, outcome: "unchanged", at: "2026-10-11T12:09Z" },
    { ledger_id: b.post_id, outcome: "posted", at: "2026-10-11T12:09Z" },
    { ledger_id: skip.post_id, outcome: "posted", at: "2026-10-11T12:09Z" },
  ]);
  const ra = await read(a.post_id);
  assert.equal(ra.outcome, "posted");
  assert.equal(ra.outcome_at.toISOString(), "2026-10-11T12:06:10.000Z");
  const rb = await read(b.post_id);
  assert.equal(rb.outcome, "refused");
  assert.equal(rb.http_status, 400);
  assert.equal(rb.reason, "Invalid Form Body");
  assert.equal((await read(skip.post_id)).outcome, "skipped");
});

test("an edit that found its message deleted marks the post it edits as gone", async () => {
  const post = row({ post_key: "tl_00000000000000000002" });
  const edit = row({
    post_key: post.post_key,
    action: "edit",
    revision: 5,
    handed_at: "2026-10-11T13:00:00Z",
  });
  await recordPosts(ctx.db, [post, edit]);
  await applyReceipts(ctx.db, [
    { ledger_id: post.post_id, outcome: "posted", at: "2026-10-11T12:06Z" },
  ]);
  await applyReceipts(ctx.db, [
    {
      ledger_id: edit.post_id,
      outcome: "unchanged",
      at: "2026-10-11T13:00:05Z",
      reason: "Deleted in the channel.",
      deleted: true,
    },
  ]);
  const p = await read(post.post_id);
  assert.equal(p.present, false);
  assert.equal(p.checked_at.toISOString(), "2026-10-11T13:00:05.000Z");
});

test("an edit's 'deleted' read before its post's own answer still marks the post gone (Codex, #511)", async () => {
  const post = row({ post_key: "tl_00000000000000000004" });
  const edit = row({
    post_key: post.post_key,
    action: "edit",
    revision: 4,
    handed_at: "2026-10-11T13:00:00Z",
  });
  await recordPosts(ctx.db, [post, edit]);
  await applyReceipts(ctx.db, [
    {
      ledger_id: edit.post_id,
      outcome: "unchanged",
      at: "2026-10-11T13:00:05Z",
      reason: "Deleted in the channel.",
      deleted: true,
    },
  ]);
  await applyReceipts(ctx.db, [
    { ledger_id: post.post_id, outcome: "posted", at: "2026-10-11T12:06Z" },
  ]);
  const p = await read(post.post_id);
  assert.equal(p.outcome, "posted");
  assert.equal(p.present, false);
  assert.equal(p.checked_at.toISOString(), "2026-10-11T13:00:05.000Z");
});

test("a receipt object is read only when it is one", () => {
  assert.equal(receiptsOf({ v: 2, receipts: [] }), null);
  assert.equal(receiptsOf({ v: 1 }), null);
  assert.deepEqual(
    receiptsOf({
      v: 1,
      receipts: [{ ledger_id: "x", outcome: "posted" }, { outcome: "nope" }],
    }),
    [],
  );
});

test("a failed ledger write never aborts the delivery's transaction", async () => {
  const logged = [];
  const log = { error: (...a) => logged.push(a) };
  const kept = row({ post_key: "tl_00000000000000000003" });
  await ctx.db.query("begin");
  const out = await aside(
    ctx.db,
    "test",
    () => ctx.db.query("insert into no_such_table values (1)"),
    log,
  );
  assert.equal(out, null);
  await recordPosts(ctx.db, [kept]);
  await ctx.db.query("commit");
  assert.ok(await read(kept.post_id), "the transaction went on");
  assert.equal(logged[0][0], "discord_quality_failed");
  // Outside a transaction, as is.
  assert.equal(await aside(ctx.db, "test", async () => 7, log), 7);
});

test("a run is recorded once with its refusals and the raw record's key", async () => {
  const at = Date.parse("2026-10-11T14:00:00Z");
  const run = {
    run_id: "clan-J2RGCRVG.1760191200000",
    clan_tag: "#J2RGCRVG",
    at: new Date(at),
    model: "a-model",
    outcome: "ok",
    rounds: 2,
    lookups: 3,
    stories: 4,
    posts: 2,
    merged: 1,
    model_skips: 1,
    fallbacks: 1,
    refusals: [{ keys: ["tl_1"], why: "clock_time", text: "at 6:05 Ada won" }],
    cost_usd: 0.0123,
    cost_estimated: false,
    raw_key: runRawKey("clan-J2RGCRVG.1760191200000", at),
  };
  await recordRun(ctx.db, run);
  await recordRun(ctx.db, { ...run, rounds: 9 });
  const {
    rows: [r],
  } = await ctx.db.query("select * from discord_run where run_id = $1", [
    run.run_id,
  ]);
  assert.equal(r.rounds, 2, "recorded once");
  assert.deepEqual(r.refusals, run.refusals);
  assert.equal(Number(r.cost_usd), 0.0123);
  assert.equal(
    r.raw_key,
    "discord-runs/2026-10-11/clan-J2RGCRVG.1760191200000.json",
  );
});

test("the sweep keeps 90 days", async () => {
  const now = Date.parse("2026-10-11T00:00:00Z");
  const old = new Date(now - (QUALITY_KEEP_DAYS + 1) * 86_400_000);
  const stale = row({ handed_at: old, post_key: "tl_00000000000000000009" });
  const fresh = row({ post_key: "tl_00000000000000000008" });
  await recordPosts(ctx.db, [stale, fresh]);
  await recordRun(ctx.db, {
    run_id: "old-run",
    clan_tag: "#J2RGCRVG",
    at: old,
    outcome: "ok",
  });
  const out = await purgeQuality(ctx.db, now);
  assert.equal(out.posts, 1);
  assert.equal(out.runs, 1);
  assert.equal(await read(stale.post_id), undefined);
  assert.ok(await read(fresh.post_id));
});

test("a webhook's posts a day to a week old, not yet read, are the read-back's, three at a time; each read lands once", async () => {
  const now = Date.parse("2026-10-20T12:00:00Z");
  const FP2 = "fedcba9876543210";
  const ago = (h) => new Date(now - h * 3600_000).toISOString();
  const mk = (key, hours, extra = {}) =>
    row({
      post_key: key,
      webhook_fp: FP2,
      handed_at: ago(hours),
      ...extra,
    });
  const rows = [
    mk("tl_r0000000000000000001", 30),
    mk("tl_r0000000000000000002", 50),
    mk("tl_r0000000000000000003", 100),
    mk("tl_r0000000000000000004", 120),
    mk("tl_r0000000000000000005", 10), // too young
    mk("tl_r0000000000000000006", 200), // past the week
    mk("tl_r0000000000000000007", 40, { action: "edit" }),
    mk("tl_r0000000000000000008", 40, { destination: "elsewhere" }),
  ];
  await recordPosts(ctx.db, rows);
  await applyReceipts(
    ctx.db,
    rows.map((r) => ({
      ledger_id: r.post_id,
      outcome: r.action === "edit" ? "edited" : "posted",
      at: r.handed_at,
    })),
  );
  const first = await readbackCandidates(ctx.db, {
    destination: ACCOUNT,
    webhook_fp: FP2,
    nowMs: now,
  });
  assert.deepEqual(
    first.map((c) => c.key),
    [
      "tl_r0000000000000000004",
      "tl_r0000000000000000003",
      "tl_r0000000000000000002",
    ],
    "oldest first, at most three, only this webhook's posts in the window",
  );
  assert.equal(first[0].ledger_id, rows[3].post_id);
  await applyReceipts(ctx.db, [
    {
      ledger_id: rows[3].post_id,
      at: "2026-10-20T12:00:05Z",
      present: true,
      reactions: [
        { emoji: "🔥", count: 3 },
        { emoji: "x", count: 0 },
      ],
      thread: true,
    },
    { ledger_id: rows[2].post_id, at: "2026-10-20T12:00:06Z", present: false },
    // Discord returned no reactions to read: null, never zero.
    { ledger_id: rows[1].post_id, at: "2026-10-20T12:00:07Z", present: true },
  ]);
  // A second read of the same post never replaces the first.
  await applyReceipts(ctx.db, [
    { ledger_id: rows[3].post_id, at: "2026-10-21T12:00:00Z", present: false },
  ]);
  const r3 = await read(rows[3].post_id);
  assert.equal(r3.present, true);
  assert.deepEqual(r3.reactions, [{ emoji: "🔥", count: 3 }]);
  assert.equal(r3.thread, true);
  assert.equal((await read(rows[2].post_id)).present, false);
  const r1 = await read(rows[1].post_id);
  assert.equal(r1.reactions, null);
  assert.equal(r1.thread, false);
  const next = await readbackCandidates(ctx.db, {
    destination: ACCOUNT,
    webhook_fp: FP2,
    nowMs: now,
  });
  assert.deepEqual(
    next.map((c) => c.key),
    ["tl_r0000000000000000001"],
  );
  assert.deepEqual(
    await readbackCandidates(ctx.db, {
      destination: ACCOUNT,
      webhook_fp: "not-a-print",
      nowMs: now,
    }),
    [],
  );
});
