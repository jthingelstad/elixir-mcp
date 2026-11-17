/** Current source authority for universal post links, on scratch Postgres. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createSession } from "@elixir-mcp/auth";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { makeHandler } from "../src/handler.mjs";

const TAG = "#0PGQ2UYL";
const ITEM = "tl_a0000000000000000001";
let ctx, handler, author, follower, stranger, postId;
const cookies = new Map();
async function account(label) {
  const {
    rows: [row],
  } = await ctx.db.query(
    "insert into account(email_hash,status) values($1,'approved') returning account_id",
    [label],
  );
  const { token } = await createSession(ctx.db, {
    secret: "test",
    accountId: row.account_id,
    emailHash: label,
  });
  cookies.set(row.account_id, `__Host-elixir_session=${token}`);
  return row.account_id;
}
const call = async (method, path, accountId, body) => {
  const res = await handler({
    method,
    path,
    headers: {
      "x-elixir-client": "web",
      ...(accountId ? { cookie: cookies.get(accountId) } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { ...res, data: JSON.parse(res.body) };
};
const share = (accountId, extra = {}) =>
  call("POST", "/api/me/item-shares", accountId, {
    source: "post",
    post_id: postId,
    item_id: ITEM,
    ...extra,
  });
before(async () => {
  ctx = await scratchDb("item_share_posts");
  author = await account("share-author");
  follower = await account("share-follower");
  stranger = await account("share-stranger");
  await ctx.db.query("insert into player(player_tag,name) values($1,$2)", [
    TAG,
    '<img src=x> & "Name"',
  ]);
  await ctx.db.query(
    "insert into claim(account_id,player_tag,is_primary,relationship,status) values($1,$2,true,'primary','verified'),($3,$2,false,'friend','unverified')",
    [author, TAG, follower],
  );
  ({
    rows: [{ post_id: postId }],
  } = await ctx.db.query(
    "insert into account_post(item_id,account_id,player_tag,body,question,cards) values($1,$2,$3,$4,true,ARRAY[26000021]) returning post_id::text",
    [ITEM, author, TAG, "What do you think of this card?"],
  ));
  handler = makeHandler({
    databaseUrl: ctx.url,
    secret: "test",
    comments: { enabled: true },
    posts: true,
    siteShell: async () =>
      '<html><head><title>Elixir</title></head><body><div id="root"></div></body></html>',
  });
});
after(() => ctx.drop());

test("sharing requires a person who can see the canonical post, including non-authors", async () => {
  assert.equal((await share()).statusCode, 401);
  assert.equal((await share(stranger)).statusCode, 404);
  const linked = await share(follower);
  assert.equal(linked.statusCode, 200, linked.body);
  assert.deepEqual((await share(author)).data, linked.data);
  assert.equal(
    (await share(follower, { item_id: "tl_a0000000000000000002" })).statusCode,
    404,
  );
  const pub = await call("GET", `/api/public/shared-items/${linked.data.id}`);
  assert.equal(pub.statusCode, 200, pub.body);
  assert.equal(pub.data.item.post.question, true);
  assert.equal(pub.data.item.post.cards[0].id, 26000021);
  assert.equal(pub.data.item.post.author.name, '<img src=x> & "Name"');
  for (const key of [
    "id",
    "mine",
    "can_edit",
    "can_report",
    "share_url",
    "status",
  ])
    assert.equal(key in pub.data.item.post, false, key);
  for (const value of [author, follower, "account_id", "comments", "nickname"])
    assert.ok(!pub.body.includes(value), value);
});

test("account follows grant the same visibility; blocks and reports are checked before issuance", async () => {
  await ctx.db.query(
    "insert into account_follow(account_id,followed_account_id) values($1,$2)",
    [stranger, author],
  );
  assert.equal((await share(stranger)).statusCode, 200);
  await ctx.db.query(
    "insert into account_block(account_id,blocked_account_id) values($1,$2)",
    [author, stranger],
  );
  assert.equal((await share(stranger)).statusCode, 404);
  await ctx.db.query("delete from account_block where account_id=$1", [author]);
  await ctx.db.query(
    "insert into post_report(post_id,account_id,reason) values($1,$2,'other')",
    [postId, stranger],
  );
  assert.equal((await share(stranger)).statusCode, 404);
  await ctx.db.query("delete from post_report where post_id=$1", [postId]);
});

test("the member digest destination is private and uses the current same audience", async () => {
  assert.equal((await call("GET", `/api/me/post/${postId}`)).statusCode, 401);
  const read = await call("GET", `/api/me/post/${postId}`, follower);
  assert.equal(read.statusCode, 200, read.body);
  assert.equal(read.data.item.id, ITEM);
  await ctx.db.query("delete from account_follow where account_id=$1", [
    stranger,
  ]);
  assert.equal(
    (await call("GET", `/api/me/post/${postId}`, stranger)).statusCode,
    404,
  );
});

test("canonical edits, moderation and author status remain authoritative after sharing", async () => {
  const linked = (await share(author)).data;
  const path = `/api/public/shared-items/${linked.id}`;
  await ctx.db.query(
    "update account_post set body='Edited words', revision=revision+1 where post_id=$1",
    [postId],
  );
  assert.equal((await call("GET", path)).data.item.post.text, "Edited words");
  await ctx.db.query(
    "update account_post set status='hidden' where post_id=$1",
    [postId],
  );
  assert.equal((await call("GET", path)).statusCode, 404);
  assert.equal((await share(author)).statusCode, 404);
  await ctx.db.query(
    "update account_post set status='visible' where post_id=$1",
    [postId],
  );
  await ctx.db.query(
    "update account set status='disabled' where account_id=$1",
    [author],
  );
  assert.equal((await call("GET", path)).statusCode, 404);
  await ctx.db.query(
    "update account set status='approved' where account_id=$1",
    [author],
  );
  assert.equal((await call("GET", path)).statusCode, 200);
  await ctx.db.query("delete from account_post where post_id=$1", [postId]);
  assert.equal((await call("GET", path)).statusCode, 404);
  assert.equal(
    (
      await ctx.db.query(
        "select count(*)::int as n from timeline_share where share_id=$1",
        [linked.id],
      )
    ).rows[0].n,
    0,
  );
});
