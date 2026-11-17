import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSession } from "@elixir-mcp/auth";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import {
  postFixture,
  AUTHOR_TAG,
} from "../../../packages/posts/test/fixture.mjs";
import { makeHandler } from "../src/handler.mjs";
let ctx, people, handler, off, cookies;
const body = (r) => {
  assert.equal(r.statusCode, 200, r.body);
  return JSON.parse(r.body);
};
before(async () => {
  ctx = await scratchDb("post_news");
  people = await postFixture(ctx.db, "news");
  cookies = new Map();
  for (const who of ["author", "reader", "fan", "stranger"]) {
    const { token } = await createSession(ctx.db, {
      secret: "test",
      accountId: people[who],
      emailHash: `news-${who}`,
    });
    cookies.set(people[who], token);
  }
  const comments = {
    enabled: true,
    capUsd: 10,
    moderate: async () => ({
      ok: true,
      input: { allow: true, category: "none" },
    }),
  };
  handler = makeHandler({
    databaseUrl: ctx.url,
    secret: "test",
    comments,
    posts: true,
  });
  off = makeHandler({ databaseUrl: ctx.url, secret: "test", comments });
});
after(async () => ctx?.drop());
beforeEach(async () => {
  await ctx.db.query("truncate account_post cascade");
  await ctx.db.query("delete from account_block");
  await ctx.db.query(
    `update claim set notify = true where account_id = $1 and player_tag = $2`,
    [people.reader, AUTHOR_TAG],
  );
});
const call = (who, path, query = {}, signedIn = handler) =>
  signedIn({
    method: "GET",
    path,
    queryStringParameters: query,
    headers: {
      cookie: `__Host-elixir_session=${cookies.get(people[who])}`,
      "x-elixir-client": "web",
    },
  });

test("a newly created visible post counts once; refresh advances its watermark and edits are not new", async () => {
  await people.post({ at: new Date(Date.now() - 60_000) });
  const first = body(await call("reader", "/api/me/home/feed"));
  const post = await people.post();
  const poll = () =>
    call("reader", "/api/me/home/feed/new", { since: first.watermark });
  assert.equal(body(await poll()).new, 1);
  const refreshed = body(await call("reader", "/api/me/home/feed"));
  assert.equal(refreshed.watermark, post.created_at.toISOString());
  assert.equal(
    body(
      await call("reader", "/api/me/home/feed/new", {
        since: refreshed.watermark,
      }),
    ).new,
    0,
  );
  await ctx.db.query(
    `update account_post set body = 'A clearer question', revision = revision + 1, updated_at = now() where post_id = $1`,
    [post.id],
  );
  assert.equal(
    body(
      await call("reader", "/api/me/home/feed/new", {
        since: refreshed.watermark,
      }),
    ).new,
    0,
  );
});

test("an account-only follower counts visible posts without a cached game week; strangers and posts-off do not", async () => {
  const since = new Date(Date.now() - 60_000).toISOString();
  await people.post();
  assert.equal(
    body(await call("fan", "/api/me/home/feed/new", { since })).new,
    1,
  );
  assert.equal(
    body(await call("stranger", "/api/me/home/feed/new", { since })).new,
    0,
  );
  assert.equal(
    body(await call("reader", "/api/me/home/feed/new", { since }, off)).new,
    0,
  );
});

test("poll counts honor notify, block, report and moderation state live", async () => {
  const since = new Date(Date.now() - 60_000).toISOString();
  const post = await people.post();
  const count = async () =>
    body(await call("reader", "/api/me/home/feed/new", { since })).new;
  assert.equal(await count(), 1);
  await ctx.db.query(
    `update claim set notify = false where account_id = $1 and player_tag = $2`,
    [people.reader, AUTHOR_TAG],
  );
  assert.equal(await count(), 0);
  await ctx.db.query(
    `update claim set notify = true where account_id = $1 and player_tag = $2`,
    [people.reader, AUTHOR_TAG],
  );
  await ctx.db.query(
    `insert into account_block (account_id, blocked_account_id) values ($1, $2)`,
    [people.author, people.reader],
  );
  assert.equal(await count(), 0);
  await ctx.db.query("delete from account_block");
  await ctx.db.query(
    `insert into post_report (post_id, account_id, reason) values ($1, $2, 'spam')`,
    [post.id, people.reader],
  );
  assert.equal(await count(), 0);
  await ctx.db.query("delete from post_report");
  await ctx.db.query(
    `update account_post set status = 'hidden' where post_id = $1`,
    [post.id],
  );
  assert.equal(await count(), 0);
  await ctx.db.query(`delete from account_post where post_id = $1`, [post.id]);
  assert.equal(await count(), 0);
});
