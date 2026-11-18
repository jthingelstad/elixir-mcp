import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import {
  postFixture,
  AUTHOR_TAG,
} from "../../../packages/posts/test/fixture.mjs";

test("historical participation is lossless and previous Lambda writes join during cutover", async () => {
  const ctx = await scratchDb("conversation_migration");
  try {
    const people = await postFixture(ctx.db, "conversation-migration");
    const post = await people.post();
    await ctx.db.query(
      "drop trigger join_comment_conversation on timeline_comment; drop function join_comment_conversation(); drop table comment_conversation_read; drop table comment_conversation",
    );
    const insert = async (at) =>
      (
        await ctx.db.query(
          `insert into timeline_comment(item_id,account_id,owner_account_id,subject_tag,body,created_at)
      values($1,$2,$3,$4,'Existing words',$5) returning comment_id::text,body,created_at::text`,
          [post.item_id, people.reader, people.author, AUTHOR_TAG, at],
        )
      ).rows[0];
    const first = await insert("2026-11-17T10:00:00.000001Z");
    const last = await insert("2026-11-17T10:00:00.000002Z");
    const dir = new URL("../../../db/migrations/", import.meta.url);
    const file = readdirSync(dir).find((name) =>
      name.endsWith("_comment_conversation.sql"),
    );
    await ctx.db.query(readFileSync(new URL(file, dir), "utf8"));
    const row = (
      await ctx.db.query(
        "select *,joined_at::text as joined,read_at::text as read from comment_conversation where account_id=$1 and item_id=$2",
        [people.reader, post.item_id],
      )
    ).rows[0];
    assert.equal(row.read_comment_id, last.comment_id);
    assert.equal(row.item_ref, null);
    assert.equal(row.legacy_subject_tag, AUTHOR_TAG);
    assert.ok(row.joined.endsWith(".000001+00"));
    assert.ok(row.read.endsWith(".000002+00"));
    assert.deepEqual(
      (
        await ctx.db.query(
          "select comment_id::text,body,created_at::text from timeline_comment order by comment_id",
        )
      ).rows,
      [first, last],
    );
    await ctx.db.query(
      "insert into comment_conversation_read(account_id,item_id,comment_id) values($1,$2,$3)",
      [people.reader, post.item_id, last.comment_id],
    );
    await ctx.db.query("delete from timeline_comment where comment_id=$1", [
      last.comment_id,
    ]);
    assert.equal(
      (
        await ctx.db.query(
          "select count(*)::int as n from comment_conversation_read",
        )
      ).rows[0].n,
      0,
      "the existing comment retention removes its private read receipts too",
    );
    assert.equal(
      (
        await ctx.db.query(
          "select count(*)::int as n from comment_conversation",
        )
      ).rows[0].n,
      1,
      "comment deletion does not erase participation",
    );
    const second = await people.post();
    await ctx.db.query(
      `insert into timeline_comment(item_id,account_id,owner_account_id,subject_tag,body) values($1,$2,$3,$4,'Old Lambda comment')`,
      [second.item_id, people.reader, people.author, AUTHOR_TAG],
    );
    assert.equal(
      (
        await ctx.db.query(
          "select count(*)::int as n from comment_conversation where account_id=$1",
          [people.reader],
        )
      ).rows[0].n,
      2,
    );
  } finally {
    await ctx.drop();
  }
});
