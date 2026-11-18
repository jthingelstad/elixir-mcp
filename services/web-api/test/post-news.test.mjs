import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSession } from "@elixir-mcp/auth";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import {
  postFixture,
  AUTHOR_TAG,
  STRANGER_TAG,
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

test("a post edit refreshes its words without counting new since the last visit", async () => {
  const now = Date.now();
  const post = await people.post({ at: new Date(now - 60_000) });
  await ctx.db.query(
    `update account set console_timeline_seen_at = $2 where account_id = $1`,
    [people.reader, new Date(now - 30_000)],
  );
  try {
    await ctx.db.query(
      `update account_post set body = 'Updated words', revision = 2, updated_at = now() where post_id = $1`,
      [post.id],
    );
    const feed = body(await call("reader", "/api/me/home/feed"));
    assert.equal(feed.counts.new, 0);
    assert.equal(
      feed.watermark,
      post.created_at.toISOString(),
      "an edit must not advance the creation-based post watermark",
    );
    assert.ok(feed.timeline.some((it) => it.post?.text === "Updated words"));
  } finally {
    await ctx.db.query(
      `update account set console_timeline_seen_at = null where account_id = $1`,
      [people.reader],
    );
  }
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

test("PostgreSQL microseconds do not count an already read post again", async () => {
  const post = await people.post({ at: new Date(Date.now() - 60_000) });
  await ctx.db.query(
    `update account_post set created_at = date_trunc('milliseconds', created_at) + interval '456 microseconds'
     where post_id = $1`,
    [post.id],
  );
  const refreshed = body(await call("reader", "/api/me/home/feed"));
  assert.equal(
    body(
      await call("reader", "/api/me/home/feed/new", {
        since: refreshed.watermark,
      }),
    ).new,
    0,
  );
  assert.equal(
    body(
      await call("reader", "/api/me/home/feed/new", {
        since: new Date(Date.parse(refreshed.watermark) - 1).toISOString(),
      }),
    ).new,
    1,
  );
});

test("Questions polls count only new visible questions before the cap and clear after refresh", async () => {
  const now = Date.now();
  await people.post({ at: new Date(now - 60_000) });
  const first = body(
    await call("reader", "/api/me/home/feed", { questions: "1" }),
  );
  await people.post({ at: new Date(now - 20_000), question: false });
  await ctx.db.query(
    `update home_feed set items=$2::jsonb where account_id=$1`,
    [
      people.reader,
      JSON.stringify([
        {
          id: "game-new",
          kind: "member_joined",
          at: new Date(now - 20_000).toISOString(),
        },
      ]),
    ],
  );
  const poll = (since) =>
    call("reader", "/api/me/home/feed/new", { since, questions: "1" });
  assert.equal(
    body(
      await call("reader", "/api/me/home/feed/new", { since: first.watermark }),
    ).new,
    2,
  );
  assert.equal(
    body(await poll(first.watermark)).new,
    0,
    "ordinary posts and game items do not make a Questions notice",
  );
  const freshQuestion = await people.post({ at: new Date(now - 10_000) });
  for (let n = 0; n < 205; n++)
    await people.post({ at: new Date(now - 5_000), question: false });
  assert.equal(
    body(await poll(first.watermark)).new,
    1,
    "filter questions before the live-post cap",
  );
  const refreshed = body(
    await call("reader", "/api/me/home/feed", { questions: "1" }),
  );
  assert.equal(refreshed.watermark, freshQuestion.created_at.toISOString());
  assert.equal(body(await poll(refreshed.watermark)).new, 0);
  await ctx.db.query(
    `update account_post set answered_at=now(),revision=revision+1,updated_at=now() where post_id=$1`,
    [freshQuestion.id],
  );
  assert.equal(
    body(await poll(refreshed.watermark)).new,
    0,
    "answer state is an edit, not a newly created question",
  );
  assert.equal(
    (
      await call("reader", "/api/me/home/feed/new", {
        since: first.watermark,
        questions: "no",
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await call(
        "reader",
        "/api/me/home/feed/new",
        { since: first.watermark, questions: "1" },
        off,
      )
    ).statusCode,
    404,
  );
});

test("a Clanmate's question enters the Clan chip and new count, then leaves both on departure", async () => {
  const clan = "#0PPPG9";
  const since = new Date(Date.now() - 60_000).toISOString();
  await ctx.db.query(
    "insert into clan(clan_tag,name) values($1,'Fixture clan')",
    [clan],
  );
  try {
    await ctx.db.query(
      "insert into clan_membership(clan_tag,player_tag,role,joined_observed_at) select $1,tag,'member',now()-interval '2 days' from unnest($2::text[]) tag",
      [clan, [STRANGER_TAG, AUTHOR_TAG]],
    );
    const post = await people.post({ question: true });
    const feed = () =>
      call("stranger", "/api/me/home/feed", { questions: "1" }).then(body);
    const news = () =>
      call("stranger", "/api/me/home/feed/new", { questions: "1", since }).then(
        body,
      );
    const joined = await feed();
    assert.equal(joined.counts.clan, 1);
    assert.equal(joined.counts.friends, 0);
    assert.equal(joined.counts.you, 0);
    assert.equal(joined.timeline[0].post.id, post.id);
    assert.deepEqual(joined.timeline[0].groups, ["clan"]);
    assert.equal((await news()).new, 1);
    await ctx.db.query(
      "update clan_membership set left_observed_at=now() where clan_tag=$1 and player_tag=$2",
      [clan, STRANGER_TAG],
    );
    assert.equal((await feed()).timeline.length, 0);
    assert.equal((await news()).new, 0);
  } finally {
    await ctx.db.query("delete from clan_membership where clan_tag=$1", [clan]);
    await ctx.db.query("delete from clan where clan_tag=$1", [clan]);
  }
});

test("a cold Timeline whose builder is still busy returns Retry-After", async () => {
  const account = people.fan;
  await ctx.db.query("delete from home_feed where account_id=$1", [account]);
  const key = ["home_feed", account];
  await ctx.db.query(
    "select pg_advisory_lock(hashtext($1), hashtext($2))",
    key,
  );
  try {
    const busy = await call("fan", "/api/me/home/feed");
    assert.equal(busy.statusCode, 503);
    assert.equal(busy.headers["retry-after"], "5");
    assert.equal(JSON.parse(busy.body).error, "unavailable");
  } finally {
    await ctx.db.query(
      "select pg_advisory_unlock(hashtext($1), hashtext($2))",
      key,
    );
  }
  assert.equal((await call("fan", "/api/me/home/feed")).statusCode, 200);
});
