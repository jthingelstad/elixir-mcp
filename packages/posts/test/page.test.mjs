import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import { readVisiblePostPage } from "../src/index.mjs";
import { postFixture, AUTHOR_TAG, STRANGER_TAG } from "./fixture.mjs";

const T = Date.parse("2026-11-17T12:00:00Z");
const iso = (ms) => new Date(ms).toISOString();
const subjects = [{ kind: "player", tag: AUTHOR_TAG }];
let ctx, people, posts;
before(async () => {
  ctx = await scratchDb("post_page");
  people = await postFixture(ctx.db, "post-page");
  posts = [];
  for (let i = 1; i <= 5; i++)
    posts.push(await people.post({ at: iso(T + i * 1000) }));
});
after(async () => ctx?.drop());

const page = (extra = {}, reader = people.reader) =>
  readVisiblePostPage(ctx.db, reader, {
    subjects,
    fromMs: T,
    toMs: T + 10_000,
    ...extra,
  });

test("delivery pages count the authorized window and give its omitted boundary", async () => {
  const result = await page({ limit: 2 });
  assert.deepEqual(
    result.items.map((it) => it.post.id),
    [posts[4].id, posts[3].id],
  );
  assert.equal(result.more, 3);
  assert.equal(result.more_at, iso(T + 3000));
  const filtered = await page({ limit: 2, playerTag: "#0LYQ8GRP" });
  assert.deepEqual(filtered, { items: [], more: 0, more_at: null });
  assert.equal(
    (await page({ subjects: [] }, people.fan)).items.length,
    5,
    "account follow",
  );
  assert.equal((await page({ subjects: [] }, people.stranger)).items.length, 0);
});

test("an edited post keeps creation, ID and revision, with exact observed bounds", async () => {
  const post = posts[0];
  await ctx.db.query(
    `update account_post set updated_at = $2, revision = 2 where post_id = $1`,
    [post.id, "2026-11-17T12:00:20.000900Z"],
  );
  const [item] = (await page({ fromMs: T + 10_000, toMs: T + 20_000 })).items;
  assert.equal(item.id, post.item_id);
  assert.equal(item.revision, 2);
  assert.equal(item.at, iso(T + 1000));
  assert.equal(item.observed_at, iso(T + 20_000));
  assert.equal(
    (await page({ fromMs: T + 20_000, toMs: T + 30_000 })).items.length,
    0,
  );
  assert.equal(
    (await page({ toMs: T + 19_999 })).items.some((it) => it.id === item.id),
    false,
  );
  const happened = await page({ basis: "occurred", fromMs: T, toMs: T + 1000 });
  assert.equal(happened.items[0].id, item.id);
});

test("delivery excludes hidden own posts, reports and both block directions", async () => {
  const post = posts[1];
  await ctx.db.query(
    `update account_post set status = 'hidden' where post_id = $1`,
    [post.id],
  );
  assert.equal(
    (await page({}, people.author)).items.some((it) => it.post.id === post.id),
    false,
  );
  await ctx.db.query(
    `update account_post set status = 'visible' where post_id = $1`,
    [post.id],
  );
  await ctx.db.query(
    `insert into post_report (post_id, account_id, reason) values ($1, $2, 'other')`,
    [post.id, people.reader],
  );
  assert.equal(
    (await page()).items.some((it) => it.post.id === post.id),
    false,
  );
  for (const [a, b] of [
    [people.reader, people.author],
    [people.author, people.reader],
  ]) {
    await ctx.db.query(
      `insert into account_block (account_id, blocked_account_id) values ($1, $2)`,
      [a, b],
    );
    assert.equal((await page()).items.length, 0);
    await ctx.db.query(
      `delete from account_block where account_id = $1 and blocked_account_id = $2`,
      [a, b],
    );
  }
});

test("delivery pages probe their audience before moderation and page hydration", async () => {
  await ctx.db.query(
    `insert into account_post (item_id, account_id, player_tag, body, question, created_at)
     select 'tl_' || lpad(to_hex(1000 + i), 20, '0'),
       case when i <= 100 then $1::uuid else $2::uuid end,
       case when i <= 100 then $3 else $4 end, 'Synthetic post', true, $5
       from generate_series(1, 10000) i`,
    [people.author, people.stranger, AUTHOR_TAG, STRANGER_TAG, iso(T + 40_000)],
  );
  await ctx.db.query("analyze account_post");
  await ctx.db.query("analyze account_follow");
  const nodes = (node) => [node, ...(node.Plans ?? []).flatMap(nodes)];
  for (const who of ["reader", "fan"]) {
    const calls = [];
    const tracked = {
      query: async (sql, values) => {
        calls.push({ sql, values });
        return ctx.db.query(sql, values);
      },
    };
    const page = await readVisiblePostPage(tracked, people[who], {
      subjects: who === "reader" ? subjects : [],
      fromMs: T + 21_000,
      toMs: T + 60_000,
      limit: 50,
    });
    assert.equal(page.items.length, 50);
    assert.equal(page.more, 50);
    const query = calls[0];
    const result = await ctx.db.query(
      `explain (analyze, buffers, format json) ${query.sql}`,
      query.values,
    );
    const plan = result.rows[0]["QUERY PLAN"][0].Plan;
    const work = nodes(plan)
      .filter((node) => node["Relation Name"] === "account_post")
      .reduce(
        (sum, node) =>
          sum +
          ((node["Actual Rows"] ?? 0) + (node["Rows Removed by Filter"] ?? 0)) *
            node["Actual Loops"],
        0,
      );
    assert.ok(
      work <= 600,
      `${who} inspected ${work} post rows for its 100-post audience`,
    );
  }
});
