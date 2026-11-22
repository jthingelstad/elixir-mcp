/**
 * {comment_delivery} (2026-11-22): a read. For each comment about a
 * player, which of the bell's conditions it passes, with the tag's claims;
 * no body, and accounts by an id prefix only.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { commentDeliveryOp } from "../src/ops-comment-delivery.mjs";
import {
  createScratch,
  dropScratch,
} from "../../../packages/ingest/test/helpers.mjs";

const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const SCRATCH = `elixir_mcp_test_comment_delivery_${process.pid}`;
const SCRATCH_URL = ADMIN_URL.replace(/\/postgres$/, `/${SCRATCH}`);
const TAG = "#0PYLQ2";

let db;

before(async () => {
  await createScratch(SCRATCH);
  db = new pg.Client({ connectionString: SCRATCH_URL });
  await db.connect();
});

after(async () => {
  await db.end();
  await dropScratch(SCRATCH);
});

test("a malformed tag is refused", async () => {
  assert.match((await commentDeliveryOp(SCRATCH_URL, {})).error, /TAG/);
  assert.match(
    (await commentDeliveryOp(SCRATCH_URL, { tag: "x'; drop" })).error,
    /TAG/,
  );
});

test("names each bell condition a comment passes, and no body", async () => {
  const acct = async (h) =>
    (
      await db.query(
        `insert into account (email_hash, status, role) values ($1, 'approved', 'member') returning account_id`,
        [h],
      )
    ).rows[0].account_id;
  const owner = await acct("delivery-owner");
  const author = await acct("delivery-author");
  await db.query(`insert into player (player_tag) values ($1)`, [TAG]);
  await db.query(
    `insert into claim (account_id, player_tag, status, is_primary, relationship)
     values ($1, $2, 'verified', true, 'primary')`,
    [owner, TAG],
  );
  const comment = (item, ownerId, receipt, ago) =>
    db.query(
      `insert into timeline_comment(item_id, account_id, owner_account_id, subject_tag,
                                    body, receipt_allowed, created_at)
       values ($1, $2, $3, $4, 'secret words', $5, now() - $6::interval)`,
      [item, author, ownerId, TAG, receipt, ago],
    );
  await comment("tl_" + "a".repeat(20), owner, true, "1 hour");
  await comment("tl_" + "b".repeat(20), null, true, "2 hours");
  await comment("tl_" + "c".repeat(20), owner, false, "10 days");

  const r = await commentDeliveryOp(SCRATCH_URL, { tag: TAG });
  assert.equal(r.claims.length, 1);
  assert.equal(r.claims[0].status, "verified");
  assert.equal(r.claims[0].account, owner.slice(0, 8));
  const [fresh, ownerless, old] = r.comments;
  assert.equal(fresh.owner_set, true);
  assert.equal(fresh.owner_holds_claim, true);
  assert.equal(fresh.receipt_allowed, true);
  assert.equal(fresh.in_window, true);
  assert.equal(fresh.after_seen, true);
  assert.equal(fresh.blocked, false);
  assert.equal(fresh.post_ok, true);
  assert.equal(ownerless.owner_set, false);
  assert.equal(old.receipt_allowed, false);
  assert.equal(old.in_window, false);
  assert.doesNotMatch(JSON.stringify(r), /secret words/);
  assert.doesNotMatch(JSON.stringify(r), new RegExp(owner));
});
