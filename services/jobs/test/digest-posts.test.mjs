import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import {
  postFixture,
  AUTHOR_TAG,
  READER_TAG,
} from "../../../packages/posts/test/fixture.mjs";
import { runEmail } from "../src/email/index.mjs";
import { buildDigest } from "../src/email/build-digest.mjs";
import { renderMail, htmlToText } from "@elixir-mcp/mail";
let ctx, people;
const from = new Date("2026-11-16T10:00:00Z");
const at = new Date("2026-11-17T09:00:00Z");
const to = new Date("2026-11-17T10:00:00Z");
const account = (who = "reader") => ({
  accountId: people[who],
  kind: "person",
  timezone: "UTC",
});
const build = (who = "reader", extra = {}) =>
  buildDigest({
    db: ctx.db,
    account: account(who),
    cadence: "daily",
    window: { fromMs: from.getTime(), toMs: to.getTime() },
    posts: true,
    ...extra,
  });
before(async () => {
  ctx = await scratchDb("digest_posts");
  people = await postFixture(ctx.db, "digest-posts");
});
after(async () => ctx?.drop());
beforeEach(async () => {
  await ctx.db.query("truncate account_post cascade");
  await ctx.db.query("delete from account_block");
});

test("a post-only question reaches the existing digest and links to its signed-in member destination", async () => {
  const post = await people.post({ at, text: "Which card <img src=x> & why?" });
  const facts = await build();
  assert.ok(facts, "a visible post alone is news for the existing digest");
  assert.deepEqual(facts.followed_activity, {
    posters: 1,
    posts: 1,
    players: 0,
    battles: 0,
  });
  assert.equal(facts.people[0].post_count, 1);
  const item = facts.people[0].items[0];
  assert.equal(item.kind, "post");
  const mail = renderMail("tracking_report", facts, {
    timezone: "UTC",
    unsubscribe: "https://elixir.test/off",
    manage: "https://elixir.test/settings/emails",
  });
  assert.match(mail.html, new RegExp(`/home/post/${post.id}(?:[?"/]|$)`));
  assert.match(mail.html, /&lt;img src=x&gt;/);
  assert.doesNotMatch(mail.html, /<img src=x>/);
  assert.match(mail.html, /&lt;b&gt;Writer&lt;\/b&gt;/);
  assert.doesNotMatch(mail.html, /\/h\//);
  assert.match(htmlToText(mail.html), /Which card <img src=x> & why\?/);
});

test("account-only follows have post-only news without any recorded player subjects", async () => {
  await people.post({ at });
  const facts = await build("fan");
  assert.ok(facts);
  assert.equal(facts.people[0].tag, AUTHOR_TAG);
  assert.equal(facts.people[0].items[0].kind, "post");
  assert.equal(await build("stranger"), null);
});

test("posts-off, hidden, deleted, reported and blocked posts never create a digest", async () => {
  const post = await people.post({ at });
  assert.equal(await build("reader", { posts: false }), null);
  await ctx.db.query(
    `update account_post set status = 'hidden' where post_id = $1`,
    [post.id],
  );
  assert.equal(await build(), null);
  await ctx.db.query(
    `update account_post set status = 'visible' where post_id = $1`,
    [post.id],
  );
  await ctx.db.query(
    `insert into post_report (post_id, account_id, reason) values ($1, $2, 'spam')`,
    [post.id, people.reader],
  );
  assert.equal(await build(), null);
  await ctx.db.query("delete from post_report");
  await ctx.db.query(
    `insert into account_block (account_id, blocked_account_id) values ($1, $2)`,
    [people.reader, people.author],
  );
  assert.equal(await build(), null);
  await ctx.db.query("delete from account_block");
  await ctx.db.query(`delete from account_post where post_id = $1`, [post.id]);
  assert.equal(await build(), null);
});

const CARD_IDS = [
  26000000, 26000001, 26000010, 26000014, 27000000, 28000000, 28000008,
  26000021,
];
test("decks and loose cards use canonical attachments, with no public-share token in mail facts", async () => {
  for (const [i, id] of CARD_IDS.entries())
    await ctx.db.query(
      `insert into card (card_id, name, kind, elixir_cost, in_catalog)
      values ($1, $2, 'card', 3, true) on conflict (card_id) do update set name = excluded.name`,
      [id, `Example Card ${i + 1}`],
    );
  await people.post({ at, deck: { cards: CARD_IDS, tower_troop: null } });
  await people.post({
    at: new Date(at.getTime() + 1000),
    text: "Trying these two cards",
    question: false,
    cards: CARD_IDS.slice(0, 2),
  });
  const facts = await build();
  const items = facts.people[0].items;
  assert.equal(items.length, 2);
  assert.equal(items[0].post.cards.length, 2);
  assert.equal(items[1].post.deck.cards.length, 8);
  assert.doesNotMatch(
    JSON.stringify(facts),
    /share_url|share_id|can_edit|can_report/,
  );
  const mail = renderMail("tracking_report", facts, {
    unsubscribe: "https://elixir.test/off",
    manage: "https://elixir.test/settings/emails",
  });
  assert.match(mail.html, /Question/);
  assert.match(mail.html, /Example Card 8/);
  assert.match(htmlToText(mail.html), /Trying these two cards/);
});

test("creation windows are disjoint; an edit to an older post is not told again", async () => {
  const old = await people.post({ at: new Date(from.getTime() - 1) });
  await ctx.db.query(
    `update account_post set updated_at = $2 where post_id = $1`,
    [old.id, at],
  );
  assert.equal(await build(), null);
  const edge = await people.post({ at: from });
  await people.post({ at: to });
  const facts = await build();
  assert.deepEqual(
    facts.people[0].items.map((it) => it.post.id),
    [edge.id],
  );
  const next = await build("reader", {
    window: { fromMs: to.getTime(), toMs: to.getTime() + 86400_000 },
  });
  assert.equal(next.people[0].items.length, 1);
  assert.notEqual(next.people[0].items[0].post.id, edge.id);
});

test("own visible posts use You, while hidden own content is never mailed", async () => {
  const post = await people.post({ at });
  const facts = await build("author");
  assert.equal(facts.people.length, 0);
  assert.equal(facts.you.items[0].post.id, post.id);
  await ctx.db.query(
    `update account_post set status = 'hidden' where post_id = $1`,
    [post.id],
  );
  assert.equal(await build("author"), null);
});

test("the existing cadence, off switch and send ledger still govern a post-only digest", async () => {
  await people.post({ at });
  await ctx.db.query(
    `insert into account_email_pref (account_id, kind, enabled, cadence, via)
    values ($1, 'tracking_report', true, 'daily', 'profile')`,
    [people.reader],
  );
  const messages = [];
  const run = () =>
    runEmail({
      db: ctx.db,
      kind: "tracking_report",
      now: to,
      secret: "test",
      posts: true,
      enqueue: async (msg) => messages.push(msg),
    });
  const first = await run();
  assert.equal(first.sent, 1);
  assert.equal(
    messages.length,
    1,
    "weekly readers do not receive an extra Tuesday mail",
  );
  assert.equal((await run()).already_sent, 1);
  assert.equal(messages.length, 1);
  await ctx.db.query(
    `update account_email_pref set enabled = false where account_id = $1 and kind = 'tracking_report'`,
    [people.reader],
  );
  const nextDay = new Date(to.getTime() + 86400_000);
  await people.post({ at: new Date(nextDay.getTime() - 1000) });
  const off = await runEmail({
    db: ctx.db,
    kind: "tracking_report",
    now: nextDay,
    secret: "test",
    posts: true,
    enqueue: async (msg) => messages.push(msg),
  });
  assert.equal(off.sent, 0);
  assert.equal(messages.length, 1, "posts never turn a digest back on");
});

test("followed activity counts visible posts and play before person and item presentation caps", async () => {
  const db = ctx.db;
  const post = async (accountId, tag, serial, status = "visible") =>
    (
      await db.query(
        `insert into account_post(item_id,account_id,player_tag,body,created_at,status)
         values($1,$2,$3,$4,$5,$6) returning post_id::text`,
        [
          `tl_${String(serial).padStart(20, "d")}`,
          accountId,
          tag,
          `Visible source post ${serial}`,
          at,
          status,
        ],
      )
    ).rows[0].post_id;
  const played = async (tag, prefix) => {
    for (let n = 0; n < 2; n++) {
      const id = `${prefix}-${n}`;
      const when = new Date(at.getTime() - 3_600_000 + n * 60_000);
      await db.query(
        `insert into battle(battle_id,battle_time,type,type_class,created_at)
         values($1,$2,'PvP','pvp',$2)`,
        [id, when],
      );
      await db.query(
        `insert into battle_participant(battle_id,player_tag,side,battle_time,type,type_class,outcome)
         values($1,$2,0,$3,'PvP','pvp','win')`,
        [id, tag, when],
      );
    }
  };
  const addFollowed = async (n) => {
    const tag = `#0P${n.toString(2).replaceAll("0", "P").replaceAll("1", "Y").padStart(6, "P")}`;
    const accountId = (
      await db.query(
        "insert into account(email_hash,status) values($1,'approved') returning account_id",
        [`digest-cap-${n}`],
      )
    ).rows[0].account_id;
    await db.query("insert into player(player_tag,name) values($1,$2)", [
      tag,
      `Invented Player ${n}`,
    ]);
    await db.query(
      `insert into claim(account_id,player_tag,is_primary,relationship,status,verified_at)
       values($1,$2,true,'primary','verified',now()),($3,$2,false,'friend','unverified',null)`,
      [accountId, tag, people.reader],
    );
    return { accountId, tag };
  };
  let serial = 100;
  let frequent;
  for (let n = 0; n < 13; n++) {
    const person = await addFollowed(n);
    frequent ??= person.tag;
    await played(person.tag, `digest-cap-${n}`);
    for (let j = 0; j < (n === 0 ? 5 : 1); j++)
      await post(person.accountId, person.tag, serial++);
  }
  // The reader's own post and play belong to You, never these totals.
  await post(people.reader, READER_TAG, serial++);
  await played(READER_TAG, "digest-cap-own");
  // All are followed, but their denied or out-of-window posts add no
  // poster and no post. These writers have no visible play in this window.
  await post(people.author, AUTHOR_TAG, serial++, "hidden");
  const reported = await post(people.author, AUTHOR_TAG, serial++);
  await db.query(
    "insert into post_report(post_id,account_id,reason) values($1,$2,'other')",
    [reported, people.reader],
  );
  const outside = await post(people.author, AUTHOR_TAG, serial++);
  await db.query("update account_post set created_at=$2 where post_id=$1", [
    outside,
    new Date(from.getTime() - 1),
  ]);
  const blocked = await addFollowed(13);
  await post(blocked.accountId, blocked.tag, serial++);
  await db.query(
    "insert into account_block(account_id,blocked_account_id) values($1,$2)",
    [blocked.accountId, people.reader],
  );
  const facts = await build();
  assert.deepEqual(facts.followed_activity, {
    posters: 13,
    posts: 17,
    players: 13,
    battles: 26,
  });
  const mail = renderMail("tracking_report", facts, {
    timezone: "UTC",
    unsubscribe: "https://elixir.test/off",
    manage: "https://elixir.test/settings/emails",
  });
  const activity = "17 posts from 13 players · 26 battles from 13 players";
  assert.ok(mail.subject.includes(activity), mail.subject);
  assert.ok(htmlToText(mail.html).includes(activity));
  assert.equal(facts.people.length, 12);
  assert.equal(facts.more_people, 1);
  const busiest = facts.people.find((p) => p.tag === frequent);
  assert.equal(busiest.post_count, 5);
  assert.equal(busiest.items.length, 3);
  assert.equal(busiest.more_items, 2);
  assert.equal(facts.you.post_count, 1);
  assert.equal(facts.you.battles, 2);
  assert.ok(
    !facts.people.some((p) =>
      [AUTHOR_TAG, blocked.tag, READER_TAG].includes(p.tag),
    ),
  );
});
