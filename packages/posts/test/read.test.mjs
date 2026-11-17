import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import { readVisiblePost, readVisiblePosts } from "../src/index.mjs";

const AUTHOR_TAG = "#0PGQ2UYL";
const MEMBER_TAG = "#0UQ2RVPL";
const CLAN = "#0VGJQ28P";
let ctx, author, follower, fan, member, stranger, postId;
const subjects = [{ kind: "player", tag: AUTHOR_TAG, relationship: "friend" }];
const options = () => ({
  subjects,
  plain: true,
  fromMs: Date.now() - 86400_000,
  toMs: Date.now() + 60_000,
});

before(async () => {
  ctx = await scratchDb("post_reader");
  const { db } = ctx;
  const ids = [];
  for (const label of ["author", "follower", "fan", "member", "stranger"])
    ids.push(
      (
        await db.query(
          `insert into account (email_hash, status) values ($1, 'approved') returning account_id`,
          [`reader-${label}`],
        )
      ).rows[0].account_id,
    );
  [author, follower, fan, member, stranger] = ids;
  for (const tag of [AUTHOR_TAG, MEMBER_TAG])
    await db.query(`insert into player (player_tag, name) values ($1, $2)`, [
      tag,
      `Writer ${tag}`,
    ]);
  await db.query(
    `insert into clan (clan_tag, name) values ($1, 'Example Clan')`,
    [CLAN],
  );
  await db.query(
    `insert into claim (account_id, player_tag, status, is_primary, relationship)
     values ($1, $3, 'verified', true, 'primary'), ($2, $4, 'verified', true, 'primary')`,
    [author, member, AUTHOR_TAG, MEMBER_TAG],
  );
  for (const tag of [AUTHOR_TAG, MEMBER_TAG])
    await db.query(
      `insert into clan_membership (clan_tag, player_tag, joined_observed_at, role)
                    values ($1, $2, now() - interval '1 day', 'member')`,
      [CLAN, tag],
    );
  await db.query(
    `insert into account_follow (account_id, followed_account_id) values ($1, $2)`,
    [fan, author],
  );
  postId = (
    await db.query(
      `insert into account_post (item_id, account_id, player_tag, body, question)
     values ('tl_00000000000000000091', $1, $2, 'Which card fits this deck?', true) returning post_id::text`,
      [author, AUTHOR_TAG],
    )
  ).rows[0].post_id;
});
after(async () => ctx?.drop());

test("the shared list and one-post read keep the Home-or-Clan audience", async () => {
  assert.equal((await readVisiblePosts(ctx.db, follower, options())).length, 1);
  assert.equal(
    (await readVisiblePost(ctx.db, follower, postId, { subjects, plain: true }))
      .post.question,
    true,
  );
  assert.equal(
    (await readVisiblePosts(ctx.db, fan, { ...options(), subjects: [] }))
      .length,
    1,
    "an account follow needs no player follow",
  );
  assert.equal(
    (await readVisiblePost(ctx.db, fan, postId, { plain: true })).post.id,
    postId,
  );
  assert.equal(
    (await readVisiblePost(ctx.db, member, postId, { plain: true })).post.id,
    postId,
    "current clan member",
  );
  assert.equal(
    await readVisiblePost(ctx.db, stranger, postId, { plain: true }),
    null,
  );
  assert.deepEqual(
    await readVisiblePosts(ctx.db, follower, { ...options(), plain: false }),
    [],
  );
});

test("hidden own posts remain an app read, never a visible-only mail read", async () => {
  await ctx.db.query(
    `update account_post set status = 'hidden' where post_id = $1`,
    [postId],
  );
  try {
    assert.equal(
      (await readVisiblePost(ctx.db, author, postId, { plain: true })).post
        .status,
      "hidden",
    );
    assert.equal(
      await readVisiblePost(ctx.db, author, postId, {
        plain: true,
        visibleOnly: true,
      }),
      null,
    );
    assert.equal(
      await readVisiblePost(ctx.db, follower, postId, {
        subjects,
        plain: true,
      }),
      null,
    );
  } finally {
    await ctx.db.query(
      `update account_post set status = 'visible' where post_id = $1`,
      [postId],
    );
  }
});

test("both block directions and an unresolved report suppress one-post access", async () => {
  for (const [blocker, blocked] of [
    [follower, author],
    [author, follower],
  ]) {
    await ctx.db.query(
      `insert into account_block (account_id, blocked_account_id) values ($1, $2)`,
      [blocker, blocked],
    );
    try {
      assert.equal(
        await readVisiblePost(ctx.db, follower, postId, {
          subjects,
          plain: true,
        }),
        null,
      );
    } finally {
      await ctx.db.query(
        `delete from account_block where account_id = $1 and blocked_account_id = $2`,
        [blocker, blocked],
      );
    }
  }
  await ctx.db.query(
    `insert into post_report (post_id, account_id, reason) values ($1, $2, 'spam')`,
    [postId, follower],
  );
  try {
    assert.equal(
      await readVisiblePost(ctx.db, follower, postId, {
        subjects,
        plain: true,
      }),
      null,
    );
  } finally {
    await ctx.db.query(
      `delete from post_report where post_id = $1 and account_id = $2`,
      [postId, follower],
    );
  }
});

test("a removed post or disabled author cannot reach a member destination", async () => {
  await ctx.db.query(
    `update account_post set status = 'removed', removed_by = 'admin', removed_at = now() where post_id = $1`,
    [postId],
  );
  try {
    assert.equal(
      await readVisiblePost(ctx.db, follower, postId, {
        subjects,
        plain: true,
      }),
      null,
    );
  } finally {
    await ctx.db.query(
      `update account_post set status = 'visible', removed_by = null, removed_at = null where post_id = $1`,
      [postId],
    );
  }
  await ctx.db.query(
    `update account set status = 'denied' where account_id = $1`,
    [author],
  );
  try {
    assert.equal(
      await readVisiblePost(ctx.db, follower, postId, {
        subjects,
        plain: true,
      }),
      null,
    );
  } finally {
    await ctx.db.query(
      `update account set status = 'approved' where account_id = $1`,
      [author],
    );
  }
});
