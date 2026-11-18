import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { postFixture } from "../../../packages/posts/test/fixture.mjs";
import { cheersRoutes } from "../src/routes/cheers.mjs";
import { resetFeedLink } from "../src/feed-link.mjs";

let ctx, people, links;
const on = cheersRoutes({ resolveAccount: async () => null, posts: true });
const off = cheersRoutes({ resolveAccount: async () => null });
const read = (who = "reader", routes = on) =>
  routes["GET /api/rss/*"](ctx.db, { pathParam: links[who] });
before(async () => {
  ctx = await scratchDb("rss_posts");
  people = await postFixture(ctx.db, "rss-posts");
  links = {};
  for (const who of ["author", "reader", "fan", "stranger"])
    links[who] = (await resetFeedLink(ctx.db, people[who])).url
      .split("/")
      .at(-1);
  for (let i = 0; i < 8; i++)
    await ctx.db.query(
      `insert into card (card_id, name, kind, elixir_cost, in_catalog)
      values ($1, $2, 'card', 3, true) on conflict (card_id) do update set name = excluded.name`,
      [26000000 + i, `Example Card ${i + 1}`],
    );
});
after(async () => ctx?.drop());
beforeEach(async () => {
  await ctx.db.query("truncate account_post cascade");
  await ctx.db.query("delete from account_block");
});

test("private RSS carries posts and question attachments, escaped, at member destinations", async () => {
  const p = await people.post({
    text: "Which </title><script> & card?",
    deck: {
      cards: Array.from({ length: 8 }, (_, i) => 26000000 + i),
      tower_troop: null,
    },
  });
  const response = await read();
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "private, max-age=300");
  assert.equal(response.headers["x-robots-tag"], "noindex");
  const xml = response.body;
  assert.ok(xml.includes(`<guid isPermaLink="false">${p.item_id}</guid>`));
  assert.ok(
    xml.includes(`<link>https://elixir.poapkings.com/home/post/${p.id}</link>`),
  );
  assert.match(xml, /Which &lt;\/title&gt;&lt;script&gt; &amp; card\?/);
  assert.match(xml, /&lt;b&gt;Writer&lt;\/b&gt; &amp; Friend/);
  assert.match(xml, /Question/);
  for (let i = 1; i <= 8; i++) assert.ok(xml.includes(`Example Card ${i}`));
  assert.equal(xml.includes("<script>"), false);
  assert.equal(xml.includes("/share/"), false);
  assert.equal(
    (await ctx.db.query("select count(*)::int as n from timeline_share"))
      .rows[0].n,
    0,
  );
});

test("RSS post audience includes account followers and excludes strangers and posts-off", async () => {
  const p = await people.post();
  assert.ok((await read("fan")).body.includes(p.item_id));
  assert.equal((await read("stranger")).body.includes(p.item_id), false);
  assert.equal((await read("reader", off)).body.includes(p.item_id), false);
});

test("RSS rechecks visible status, reports and blocks, including hidden own content", async () => {
  const p = await people.post();
  await ctx.db.query(
    `update account_post set status = 'hidden' where post_id = $1`,
    [p.id],
  );
  assert.equal((await read("author")).body.includes(p.item_id), false);
  await ctx.db.query(
    `update account_post set status = 'visible' where post_id = $1`,
    [p.id],
  );
  for (const [a, b] of [
    [people.reader, people.author],
    [people.author, people.reader],
  ]) {
    await ctx.db.query(
      `insert into account_block (account_id, blocked_account_id) values ($1, $2)`,
      [a, b],
    );
    assert.equal((await read()).body.includes(p.item_id), false);
    await ctx.db.query(
      `delete from account_block where account_id = $1 and blocked_account_id = $2`,
      [a, b],
    );
  }
  await ctx.db.query(
    `insert into post_report (post_id, account_id, reason) values ($1, $2, 'other')`,
    [p.id, people.reader],
  );
  assert.equal((await read()).body.includes(p.item_id), false);
});

test("RSS edits update a stable GUID; removal disappears and no comment text is read", async () => {
  const p = await people.post({ text: "First wording" });
  await ctx.db.query(
    `insert into timeline_comment (item_id, account_id, subject_tag, owner_account_id, body)
     values ($1, $2, $3, $4, 'This comment stays inside Elixir')`,
    [p.item_id, people.reader, "#0PGQ2UYL", people.author],
  );
  const first = await read();
  assert.ok(first.body.includes(p.item_id));
  await ctx.db.query(
    `update account_post set body = 'Clearer wording', revision = 2, updated_at = now() where post_id = $1`,
    [p.id],
  );
  const changed = await read();
  assert.ok(changed.body.includes(p.item_id));
  assert.ok(changed.body.includes("Clearer wording"));
  assert.equal(changed.body.includes("First wording"), false);
  assert.equal(
    changed.body.includes("This comment stays inside Elixir"),
    false,
  );
  await ctx.db.query(
    `update account_post set status = 'removed', removed_at = now() where post_id = $1`,
    [p.id],
  );
  assert.equal((await read()).body.includes(p.item_id), false);
});
