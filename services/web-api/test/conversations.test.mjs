import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createSession } from "@elixir-mcp/auth";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import {
  postFixture,
  AUTHOR_TAG,
} from "../../../packages/posts/test/fixture.mjs";
import { makeHandler } from "../src/handler.mjs";
import { commentsRoutes } from "../src/routes/comments.mjs";

let ctx, people, handler;
const tokens = new Map();
const body = (r) => JSON.parse(r.body);
async function call(who, method, path, data, query = {}) {
  return handler({
    method,
    path,
    queryStringParameters: query,
    headers: {
      cookie: `__Host-elixir_session=${tokens.get(who)}`,
      "x-elixir-client": "web",
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
}
before(async () => {
  ctx = await scratchDb("my_conversations");
  people = await postFixture(ctx.db, "my-conversations");
  for (const who of ["reader", "author", "stranger"]) {
    const { token } = await createSession(ctx.db, {
      secret: "test",
      accountId: people[who],
      emailHash: `my-conversations-${who}`,
    });
    tokens.set(who, token);
  }
  handler = makeHandler({
    databaseUrl: ctx.url,
    secret: "test",
    posts: true,
    comments: {
      enabled: true,
      capUsd: 10,
      moderate: async () => ({
        ok: true,
        model: "test",
        input: { allow: true, category: "none" },
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    },
  });
});
beforeEach(async () => {
  await ctx.db.query(
    "delete from comment_report; delete from timeline_comment; delete from comment_conversation; delete from account_block",
  );
});
after(async () => {
  await handler?.close();
  await ctx?.drop();
});

async function join(post) {
  const out = await call("reader", "POST", "/api/me/comments", {
    item_id: post.item_id,
    subjects: [AUTHOR_TAG],
    text: "I tried that card",
  });
  assert.equal(out.statusCode, 201, out.body);
  return body(out).comment.id;
}
async function reply(
  post,
  {
    who = "author",
    at = "2026-11-18T10:00:00.000002Z",
    status = "visible",
  } = {},
) {
  return (
    await ctx.db.query(
      `insert into timeline_comment(item_id,account_id,owner_account_id,subject_tag,body,created_at,status,removed_at)
    values($1,$2,$3,$4,'Invented reply',$5,$6,case when $6='removed' then now() else null end) returning comment_id::text`,
      [post.item_id, people[who], people.author, AUTHOR_TAG, at, status],
    )
  ).rows[0].comment_id;
}

test("My conversations is private and only includes threads actually joined", async () => {
  const post = await people.post();
  const empty = await call("reader", "GET", "/api/me/conversations");
  assert.equal(empty.statusCode, 200, empty.body);
  assert.deepEqual(body(empty).items, []);
  const joined = await call("reader", "POST", "/api/me/comments", {
    item_id: post.item_id,
    subjects: [AUTHOR_TAG],
    text: "I tried that card",
  });
  assert.equal(joined.statusCode, 201, joined.body);
  const list = body(await call("reader", "GET", "/api/me/conversations"));
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].item_ref.item_id, post.item_id);
  assert.equal(list.items[0].unread, 0);
  await reply(post, { at: "2026-11-17T08:00:00Z" });
  const afterOldReply = body(
    await call("reader", "GET", "/api/me/conversations"),
  );
  assert.ok(
    Date.parse(afterOldReply.items[0].at) >=
      Date.parse(body(joined).comment.at),
    "old replies do not date a newly joined conversation before participation",
  );
  assert.deepEqual(
    body(await call("stranger", "GET", "/api/me/conversations")).items,
    [],
  );
});

test("the person-only route fails closed without a session, for agents, and with comments off", async () => {
  const anonymous = await call(undefined, "GET", "/api/me/conversations");
  assert.equal(anonymous.statusCode, 401);
  for (const [account, enabled, status] of [
    [{ kind: "agent", accountId: people.reader }, true, 403],
    [{ kind: "person", accountId: people.reader }, false, 404],
  ]) {
    const routes = commentsRoutes({
      resolveAccount: async () => account,
      comments: { enabled },
    });
    const result = await routes["GET /api/me/conversations"](null, {});
    assert.equal(result.statusCode, status);
  }
  assert.equal(
    (
      await call("reader", "GET", "/api/me/conversations", null, {
        before: "broken",
      })
    ).statusCode,
    400,
  );
});

test("only visible replies by others become unread, and only served thread pages advance the cursor", async () => {
  const post = await people.post();
  const own = await join(post);
  await ctx.db.query(
    "update timeline_comment set created_at='2026-11-18T10:00:00.000001Z' where comment_id=$1",
    [own],
  );
  await ctx.db.query(
    "update comment_conversation set joined_at='2026-11-18T10:00:00.000001Z',read_at=joined_at,read_comment_id=$1 where item_id=$2",
    [own, post.item_id],
  );
  // SET expressions use the old row; set the exact cursor explicitly too.
  await ctx.db.query(
    "update comment_conversation set read_at='2026-11-18T10:00:00.000001Z' where item_id=$1",
    [post.item_id],
  );
  await reply(post, { at: "2026-11-18T09:00:00Z" });
  const first = await reply(post, { at: "2026-11-18T10:00:00.000001Z" });
  const second = await reply(post);
  await reply(post, { who: "reader" });
  await reply(post, { status: "hidden" });
  await reply(post, { status: "removed" });
  const reported = await reply(post);
  await ctx.db.query(
    "insert into comment_report(comment_id,account_id,reason) values($1,$2,'other')",
    [reported, people.reader],
  );
  const list = async () =>
    body(await call("reader", "GET", "/api/me/conversations"));
  let row = (await list()).items[0];
  assert.equal(row.unread, 2);
  assert.equal(row.first_unread_comment_id, first);
  for (const privateField of [
    "body",
    "text",
    "author",
    "account_id",
    "owner_account_id",
  ])
    assert.equal(row[privateField], undefined);
  await call("reader", "PUT", "/api/me/bell/seen");
  assert.equal(
    (await list()).items[0].unread,
    2,
    "opening Notifications does not mark a conversation read",
  );
  const page = await call("reader", "GET", "/api/me/comments", null, {
    item: post.item_id,
    around: first,
    subjects: AUTHOR_TAG,
  });
  assert.equal(page.statusCode, 200, page.body);
  row = (await list()).items[0];
  assert.equal(
    row.unread,
    1,
    "around page only read through its first unread reply",
  );
  assert.equal(row.first_unread_comment_id, second);
  await call("reader", "GET", "/api/me/comments", null, {
    item: post.item_id,
    subjects: AUTHOR_TAG,
  });
  assert.equal((await list()).items[0].unread, 0);
});

test("current source moderation, two-way blocks and audience control every conversation read", async () => {
  const post = await people.post();
  await join(post);
  // A second after now: the reader's read mark is the database's own
  // now() in microseconds, so a reply stamped with the test's clock in
  // the same millisecond could sort before it and not count as unread.
  await reply(post, {
    who: "stranger",
    at: new Date(Date.now() + 1000).toISOString(),
  });
  const list = async () =>
    body(await call("reader", "GET", "/api/me/conversations"));
  assert.equal((await list()).items[0].unread, 1);
  await ctx.db.query(
    "insert into account_block(account_id,blocked_account_id) values($1,$2)",
    [people.stranger, people.reader],
  );
  assert.equal(
    (await list()).items[0].unread,
    0,
    "blocked reply authors are not counted",
  );
  await ctx.db.query("delete from account_block");
  await ctx.db.query(
    "insert into post_report(post_id,account_id,reason) values($1,$2,'other')",
    [post.id, people.reader],
  );
  assert.deepEqual((await list()).items, [], "reported source post disappears");
  await ctx.db.query("delete from post_report");
  await ctx.db.query(
    "update account_post set status='hidden' where post_id=$1",
    [post.id],
  );
  assert.deepEqual((await list()).items, []);
  await ctx.db.query(
    "update account_post set status='visible' where post_id=$1",
    [post.id],
  );
  await ctx.db.query(
    "delete from claim where account_id=$1 and player_tag=$2 and relationship='friend'",
    [people.reader, AUTHOR_TAG],
  );
  assert.deepEqual(
    (await list()).items,
    [],
    "participation grants no lasting source access",
  );
  await ctx.db.query(
    "insert into claim(account_id,player_tag,relationship) values($1,$2,'friend')",
    [people.reader, AUTHOR_TAG],
  );
  await ctx.db.query(
    "insert into account_block(account_id,blocked_account_id) values($1,$2)",
    [people.author, people.reader],
  );
  assert.deepEqual(
    (await list()).items,
    [],
    "source owner block is enforced both ways",
  );
});

test("reading or cheering alone never joins, but deleting your contribution retains private participation", async () => {
  const post = await people.post();
  await call("reader", "GET", "/api/me/comments", null, {
    item: post.item_id,
    subjects: AUTHOR_TAG,
  });
  await call("reader", "PUT", "/api/me/cheers", {
    item_id: post.item_id,
    subjects: [AUTHOR_TAG],
    cheer: "well_played",
  });
  assert.deepEqual(
    body(await call("reader", "GET", "/api/me/conversations")).items,
    [],
  );
  const own = await join(post);
  const removed = await call("reader", "DELETE", `/api/me/comments/${own}`);
  assert.equal(removed.statusCode, 200, removed.body);
  assert.equal(
    body(await call("reader", "GET", "/api/me/conversations")).items.length,
    1,
  );
});

test("a latest page beyond an unread gap marks only its served replies read", async () => {
  const post = await people.post();
  const own = await join(post);
  await ctx.db.query(
    "update timeline_comment set created_at='2026-11-18T09:00:00Z' where comment_id=$1",
    [own],
  );
  await ctx.db.query(
    "update comment_conversation set joined_at='2026-11-18T09:00:00Z',read_at='2026-11-18T09:00:00Z' where account_id=$1 and item_id=$2",
    [people.reader, post.item_id],
  );
  const replies = (
    await ctx.db.query(
      `insert into timeline_comment(item_id,account_id,owner_account_id,subject_tag,body,created_at)
    select $1,$2,$2,$3,'Reply '||n,'2026-11-18T10:00:00Z'::timestamptz+n*interval '1 microsecond' from generate_series(1,101) n
    returning comment_id::text`,
      [post.item_id, people.author, AUTHOR_TAG],
    )
  ).rows.map((r) => r.comment_id);
  const list = async () =>
    body(await call("reader", "GET", "/api/me/conversations"));
  assert.equal((await list()).items[0].unread, 101);
  let latest = body(
    await call("reader", "GET", "/api/me/comments", null, {
      item: post.item_id,
      subjects: AUTHOR_TAG,
    }),
  );
  assert.equal(latest.comments.length, 100);
  assert.ok(latest.comments.every((c) => c.unread === true));
  assert.equal(
    latest.comments[0].at,
    "2026-11-18T10:00:00.000002Z",
    "canonical comment timestamps retain microseconds",
  );
  let row = (await list()).items[0];
  assert.equal(row.unread, 1, "the unserved first reply remains unread");
  assert.equal(row.first_unread_comment_id, replies[0]);
  const receipts = async () =>
    Number(
      (
        await ctx.db.query(
          "select count(*)::int as n from comment_conversation_read where account_id=$1 and item_id=$2",
          [people.reader, post.item_id],
        )
      ).rows[0].n,
    );
  assert.equal(
    await receipts(),
    100,
    "read exceptions survive an earlier unread gap",
  );
  latest = body(
    await call("reader", "GET", "/api/me/comments", null, {
      item: post.item_id,
      subjects: AUTHOR_TAG,
    }),
  );
  assert.ok(
    latest.comments.every((c) => c.unread === false),
    "already served replies stay read despite the earlier gap",
  );
  await call("reader", "GET", "/api/me/comments", null, {
    item: post.item_id,
    subjects: AUTHOR_TAG,
    around: replies[0],
  });
  row = (await list()).items[0];
  assert.equal(row.unread, 0);
  assert.equal(
    row.read_comment_id,
    replies.at(-1),
    "the contiguous cursor can now cross the previously served page",
  );
  assert.equal(
    await receipts(),
    0,
    "the contiguous cursor replaces covered receipts without losing read state",
  );
});

test("conversation pagination preserves timestamp ties and clips only the list excerpt", async () => {
  const ids = [];
  for (let i = 0; i < 21; i++) {
    const post = await people.post({
      text: i === 0 ? "♞".repeat(200) : `Thread ${i}`,
    });
    ids.push(post.item_id);
    await ctx.db.query(
      `insert into timeline_comment(item_id,account_id,owner_account_id,subject_tag,body,created_at)
      values($1,$2,$3,$4,'A prior contribution','2026-11-18T10:00:00Z'::timestamptz+$5*interval '1 microsecond')`,
      [post.item_id, people.reader, people.author, AUTHOR_TAG, i],
    );
  }
  const first = body(await call("reader", "GET", "/api/me/conversations"));
  assert.equal(first.items.length, 8);
  assert.ok(first.next_before);
  const all = [...first.items];
  let cursor = first.next_before;
  while (cursor) {
    const next = body(
      await call("reader", "GET", "/api/me/conversations", null, {
        before: cursor,
      }),
    );
    assert.ok(next.items.length <= 8);
    all.push(...next.items);
    cursor = next.next_before;
  }
  assert.equal(new Set(all.map((it) => it.item_id)).size, 21);
  assert.deepEqual(
    all.map((it) => it.item_id),
    ids.toReversed(),
  );
  assert.equal(Array.from(all.at(-1).title).length, 160);
  assert.ok(all.at(-1).title.endsWith("…"));
  assert.equal(
    (
      await ctx.db.query("select body from account_post where item_id=$1", [
        ids[0],
      ])
    ).rows[0].body,
    "♞".repeat(200),
  );
  assert.ok(
    (
      await ctx.db.query(
        "select item_ref from comment_conversation where account_id=$1",
        [people.reader],
      )
    ).rows.every((row) => row.item_ref !== null),
    "authorized recovered locators are normalized without moving read history",
  );
});

test("an entirely inaccessible page still reaches later visible threads without exposing its cursor metadata", async () => {
  let visible;
  const hidden = [];
  for (let i = 0; i < 9; i++) {
    const post = await people.post({ text: `Joined fixture thread ${i}` });
    if (i === 0) visible = post.item_id;
    else hidden.push(post.item_id);
    await ctx.db.query(
      `insert into timeline_comment(item_id,account_id,owner_account_id,subject_tag,body,created_at)
      values($1,$2,$3,$4,'A previous contribution','2026-11-18T10:00:00Z'::timestamptz+$5*interval '1 microsecond')`,
      [post.item_id, people.reader, people.author, AUTHOR_TAG, i],
    );
    if (i)
      await ctx.db.query(
        "update account_post set status='hidden' where post_id=$1",
        [post.id],
      );
  }
  const first = body(await call("reader", "GET", "/api/me/conversations"));
  assert.deepEqual(first.items, []);
  assert.ok(first.next_before, "a fully filtered page retains continuation");
  assert.equal(
    first.next,
    undefined,
    "the source sort tuple never reaches the member transport",
  );
  const envelope = Buffer.from(first.next_before, "base64url").toString();
  for (const id of hidden) assert.ok(!envelope.includes(id));
  assert.ok(!envelope.includes("2026-11-18T10:00:00"));
  const second = body(
    await call("reader", "GET", "/api/me/conversations", null, {
      before: first.next_before,
    }),
  );
  assert.deepEqual(
    second.items.map((it) => it.item_id),
    [visible],
  );
  assert.equal(
    (
      await call("stranger", "GET", "/api/me/conversations", null, {
        before: first.next_before,
      })
    ).statusCode,
    400,
    "cursor is bound to its owning account",
  );
});
