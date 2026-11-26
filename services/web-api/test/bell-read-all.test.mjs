/**
 * Mark all read (Jamie, 2026-11-26: "Notifications dropdown needs a 'Mark
 * all read' option"). Pinned here: one request reads everything in the
 * bell up to its own instant (the seen marker, your feedback's answers,
 * every conversation you are in), leaves the rows in the list, moves only
 * the caller's own rows, changes nothing the second time, and leaves what
 * lands after the cutoff new. Signed out or without the contract header it
 * moves nothing. Synthetic people (packages/posts/test/fixture.mjs).
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createSession } from "@elixir-mcp/auth";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import {
  postFixture,
  AUTHOR_TAG,
} from "../../../packages/posts/test/fixture.mjs";
import { makeHandler } from "../src/handler.mjs";

let ctx, people, handler, post;
const tokens = new Map();
const body = (r) => JSON.parse(r.body);
function call(who, method, path, { contract = true } = {}) {
  return handler({
    method,
    path,
    headers: {
      ...(who ? { cookie: `__Host-elixir_session=${tokens.get(who)}` } : {}),
      ...(contract ? { "x-elixir-client": "web" } : {}),
    },
  });
}
const bell = async (who) => body(await call(who, "GET", "/api/me/bell"));
const unread = async (who) =>
  body(await call(who, "GET", "/api/me/conversations")).items.map(
    (i) => i.unread,
  );
const readAll = async (who) => {
  const res = await call(who, "PUT", "/api/me/bell/read-all");
  assert.equal(res.statusCode, 200, res.body);
  return body(res);
};
/** A comment straight into the table, stamped by the database: `later`
 *  puts it an hour past now, after any cutoff this test takes. */
const comment = async (who, { later = false } = {}) =>
  (
    await ctx.db.query(
      `insert into timeline_comment(item_id,account_id,owner_account_id,subject_tag,body,created_at)
       values($1,$2,$3,$4,'Invented reply',
              clock_timestamp() + case when $5 then interval '1 hour' else interval '0' end)
       returning comment_id::text`,
      [post.item_id, people[who], people.author, AUTHOR_TAG, later],
    )
  ).rows[0].comment_id;
const answer = (who, { later = false } = {}) =>
  ctx.db.query(
    `insert into feedback (account_id, surface, message, status, response, responded_at)
     values ($1, 'web', 'Invented question', 'planned', 'Answered.',
             now() + case when $2 then interval '1 hour' else interval '-1 minute' end)`,
    [people[who], later],
  );

before(async () => {
  ctx = await scratchDb("bell_read_all");
  people = await postFixture(ctx.db, "bell-read-all");
  for (const who of ["reader", "author", "stranger"]) {
    const { token } = await createSession(ctx.db, {
      secret: "test",
      accountId: people[who],
      emailHash: `bell-read-all-${who}`,
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
  post = await people.post();
  // The reader comments on the author's post (the author's bell has it,
  // unread), and the author answers (the reader's thread has it, unread).
  const joined = await handler({
    method: "POST",
    path: "/api/me/comments",
    headers: {
      cookie: `__Host-elixir_session=${tokens.get("reader")}`,
      "x-elixir-client": "web",
    },
    body: JSON.stringify({
      item_id: post.item_id,
      subjects: [AUTHOR_TAG],
      text: "I tried that card",
    }),
  });
  assert.equal(joined.statusCode, 201, joined.body);
  await comment("author");
  await answer("author");
});
after(async () => {
  await handler?.close();
  await ctx?.drop();
});

test("mark all read: everything up to now is read, the rows stay, only yours move", async () => {
  const was = await bell("author");
  assert.equal(was.answers.new, 1);
  assert.equal(was.comments.new, 1);
  assert.ok(was.new >= 2);
  assert.deepEqual(await unread("author"), [1]);
  assert.deepEqual(await unread("reader"), [1]);

  const done = await readAll("author");
  assert.ok(done.seen_at);
  assert.equal(done.answers, 1);
  assert.equal(done.conversations, 1);

  const now = await bell("author");
  assert.equal(now.new, 0);
  assert.equal(now.answers.new, 0);
  assert.equal(now.comments.new, 0);
  // Still in the list, no longer new.
  assert.equal(now.answers.items.length, 1);
  assert.equal(now.answers.items[0].new, false);
  assert.equal(now.comments.items.length, 1);
  assert.equal(now.comments.items[0].new, false);
  assert.deepEqual(await unread("author"), [0]);
  // The reader's own thread is the reader's to read.
  assert.deepEqual(await unread("reader"), [1]);

  // A second tap changes nothing.
  const again = await readAll("author");
  assert.equal(again.answers, 0);
  assert.equal(again.conversations, 0);
  assert.ok(Date.parse(again.seen_at) >= Date.parse(done.seen_at));

  await readAll("reader");
  assert.deepEqual(await unread("reader"), [0]);
});

test("what lands after the cutoff stays new", async () => {
  await comment("reader", { later: true });
  await answer("author", { later: true });
  const done = await readAll("author");
  assert.equal(done.answers, 0);
  assert.equal(done.conversations, 0);
  const now = await bell("author");
  assert.equal(now.answers.new, 1);
  assert.deepEqual(await unread("author"), [1]);
});

test("mark all read's refusals: signed out, no contract header", async () => {
  assert.equal(
    (await call(undefined, "PUT", "/api/me/bell/read-all")).statusCode,
    401,
  );
  await answer("stranger");
  const res = await call("stranger", "PUT", "/api/me/bell/read-all", {
    contract: false,
  });
  assert.notEqual(res.statusCode, 200);
  assert.equal(
    (
      await ctx.db.query(`select 1 from bell_seen where account_id = $1`, [
        people.stranger,
      ])
    ).rowCount,
    0,
  );
  assert.equal((await bell("stranger")).answers.new, 1);
});
