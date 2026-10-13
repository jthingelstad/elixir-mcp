/**
 * {newsletter_sync} (2026-10-12): one enroll-only message per approved
 * person who opted in, counts only on a dry run.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { newsletterSync } from "../src/newsletter-sync.mjs";

let ctx;
before(async () => {
  ctx = await scratchDb("newsletter_sync");
  for (const [email, status, kind, optIn] of [
    ["in@example.com", "approved", "person", true],
    ["out@example.com", "approved", "person", false],
    ["disabled@example.com", "disabled", "person", true],
    [null, "approved", "person", true],
    ["also-in@example.com", "approved", "person", true],
  ])
    await ctx.db.query(
      `insert into account (email_hash, email, status, kind, newsletter_opt_in)
       values (encode(sha256(random()::text::bytea), 'hex'), $1, $2, $3, $4)`,
      [email, status, kind, optIn],
    );
});
after(async () => ctx.drop());

test("a dry run counts and hands over nothing", async () => {
  const sent = [];
  const out = await newsletterSync(ctx.url, {
    enqueue: async (m) => sent.push(m),
  });
  assert.equal(out.would_enqueue, 2);
  assert.equal(out.skipped.opted_out.length, 1);
  assert.equal(out.skipped.no_address.length, 1);
  assert.match(out.skipped.opted_out[0], /^[0-9a-f]{10}$/);
  assert.deepEqual(sent, []);
});

test("the real run hands the relay one enroll-only message per opted-in person", async () => {
  const sent = [];
  const out = await newsletterSync(ctx.url, {
    dryRun: false,
    enqueue: async (m) => sent.push(m),
  });
  assert.deepEqual(out, { dry_run: false, enqueued: 2 });
  // account_id is a uuid: the order is not the insert order.
  assert.deepEqual(
    sent.sort((a, b) => a.to.localeCompare(b.to)),
    [
      { kind: "newsletter_enroll", to: "also-in@example.com" },
      { kind: "newsletter_enroll", to: "in@example.com" },
    ],
  );
  assert.ok(!JSON.stringify(out).includes("@"), "no address in the answer");
});
