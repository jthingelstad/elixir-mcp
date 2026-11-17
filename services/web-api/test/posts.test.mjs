/**
 * Posts (2026-11-17), against a real PostgreSQL database and the real
 * handler, with the model faked. Pinned here:
 *
 * - the switch: with PostsEnabled off, or comments off, every route
 *   answers 404 posts_off and Settings is told so;
 * - who may post: a Verified player of their own, not suspended;
 * - the check runs first and fails closed: a refusal, an error or a
 *   paused month stores no post;
 * - a deck link in the words (each spelling) becomes the deck and leaves
 *   the words; an unknown card id is refused; any other link is refused,
 *   never kept;
 * - the audience: the author, followers of the player, followers of the
 *   account, and clanmates in Clan's Feed; nobody else, and never anyone
 *   in a block either way, who may not cheer or comment on it either;
 * - delete, report, admin remove and dismiss; rate limits;
 * - posts never reach the record's timeline (MCP, mail, push, RSS,
 *   Discord, public pages all build from it), and no code outside the
 *   web API's own reads names the table.
 *
 * Made-up tags: this repository is public.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { createSession } from "@elixir-mcp/auth";
import { ensurePassport } from "@elixir-mcp/stamps";
import { buildTimeline, subjectsFor } from "@elixir-mcp/tools/activity/entries";
import { makeHandler } from "../src/handler.mjs";
import { readClanFeed } from "../src/clan-feed.mjs";
import { readBell } from "../src/bell.mjs";

const A = "#0PGQ2UYL"; // AUTHOR's primary, verified
const F = "#0RJ29CVY"; // FOLLOWER's primary, verified
const S = "#0LYQ8GRP"; // STRANGER's primary, verified
const M = "#0UQ2RVPL"; // CLANMATE's primary, verified
const U = "#0CLRGP98"; // UNVERIFIED's primary, claimed only
const K = "#0GYP2QRL"; // ACCOUNT_FAN's primary, verified
const CLAN = "#0VGJQ28P";

const IDS = [
  26000000, 26000001, 26000010, 26000014, 27000000, 28000000, 28000008,
  26000021,
];
const TT = 159000000;
const WEB = `https://link.clashroyale.com/en/?clashroyale://copyDeck?deck=${IDS.join(";")}&tt=${TT}`;

let scratch, handler, offHandler, commentsOnlyHandler, pausedHandler;
let AUTHOR, FOLLOWER, STRANGER, CLANMATE, UNVERIFIED, ACCOUNT_FAN, ADMIN;
const sessions = new Map();
const data = (r) => JSON.parse(r.body);

const asked = [];
let next = () => ({ allow: true, category: "none" });
const moderate = async (input) => {
  asked.push(input);
  const say = await next(input);
  if (say instanceof Error) throw say;
  if (say?.ok === false) return say;
  return {
    ok: true,
    model: "claude-haiku-5-5",
    input: say,
    usage: { input_tokens: 900, output_tokens: 12 },
  };
};

async function person(hash, role = "member") {
  const id = (
    await scratch.db.query(
      `insert into account(email_hash,status,role) values ($1,'approved',$2)
       returning account_id`,
      [hash, role],
    )
  ).rows[0].account_id;
  const { token } = await createSession(scratch.db, {
    secret: "test",
    accountId: id,
    emailHash: hash,
  });
  sessions.set(id, token);
  await ensurePassport(scratch.db, id);
  return id;
}
const callWith =
  (h) =>
  (id, method, path, body, query = {}) =>
    h({
      path,
      method,
      queryStringParameters: query,
      headers: {
        cookie: `__Host-elixir_session=${sessions.get(id)}`,
        "x-elixir-client": "web",
        "cloudfront-viewer-address": "8.8.4.4:443",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
let call;
const claim = (account, tag, verified = true) =>
  scratch.db.query(
    `insert into claim(account_id,player_tag,status,is_primary,relationship,verified_at)
     values ($1,$2,$3,true,'primary',$4)`,
    [
      account,
      tag,
      verified ? "verified" : "unverified",
      verified ? new Date() : null,
    ],
  );
const write = (id, body) => call(id, "POST", "/api/me/posts", body);
/** Lets the next post past the per-minute limit, as a minute passing. */
const aMinuteLater = (id) =>
  scratch.db.query(
    `update comment_check set created_at = created_at - interval '2 minutes'
      where account_id = $1`,
    [id],
  );
/** Forgets an account's checks (the per-day limit, the cooldown). */
const forget = (id) =>
  scratch.db.query(`delete from comment_check where account_id = $1`, [id]);
const stored = async (id) =>
  (
    await scratch.db.query(
      `select body, question, deck, cards, status from account_post
        where account_id = $1 order by post_id`,
      [id],
    )
  ).rows;
const feedPosts = async (id) => {
  const r = await call(id, "GET", "/api/me/home/feed");
  assert.equal(r.statusCode, 200, r.body);
  return data(r).timeline.filter((it) => it.kind === "post");
};

before(async () => {
  scratch = await scratchDb("posts");
  const { db } = scratch;
  for (const tag of [A, F, S, M, U, K])
    await db.query("insert into player(player_tag,name) values ($1,$2)", [
      tag,
      `Name ${tag}`,
    ]);
  for (const [i, id] of IDS.entries())
    await db.query(
      `insert into card (card_id, name, kind, elixir_cost, in_catalog)
       values ($1, $2, 'card', $3, true)`,
      [id, `Card ${i + 1}`, 3],
    );
  await db.query(
    `insert into card (card_id, name, kind, in_catalog)
     values ($1, 'Tower Princess', 'support', true),
            (26000099, 'Gone Card', 'card', false)`,
    [TT],
  );
  await db.query(
    `insert into clan (clan_tag, name) values ($1, 'Example Clan')`,
    [CLAN],
  );
  for (const tag of [A, M])
    await db.query(
      `insert into clan_membership (clan_tag, player_tag, joined_observed_at, role)
       values ($1, $2, now() - interval '30 days', 'member')`,
      [CLAN, tag],
    );
  const comments = { enabled: true, capUsd: 10, moderate };
  handler = makeHandler({
    databaseUrl: scratch.url,
    secret: "test",
    comments,
    posts: true,
  });
  offHandler = makeHandler({
    databaseUrl: scratch.url,
    secret: "test",
    posts: true,
  });
  commentsOnlyHandler = makeHandler({
    databaseUrl: scratch.url,
    secret: "test",
    comments,
  });
  pausedHandler = makeHandler({
    databaseUrl: scratch.url,
    secret: "test",
    comments: { ...comments, capUsd: 0.0000001 },
    posts: true,
  });
  call = callWith(handler);
  AUTHOR = await person("ps-author");
  FOLLOWER = await person("ps-follower");
  STRANGER = await person("ps-stranger");
  CLANMATE = await person("ps-clanmate");
  UNVERIFIED = await person("ps-unverified");
  ACCOUNT_FAN = await person("ps-account-fan");
  ADMIN = await person("ps-admin", "admin");
  await claim(AUTHOR, A);
  await claim(FOLLOWER, F);
  await claim(STRANGER, S);
  await claim(CLANMATE, M);
  await claim(UNVERIFIED, U, false);
  await claim(ACCOUNT_FAN, K);
  assert.equal(
    (
      await call(FOLLOWER, "POST", "/api/claims", {
        player_tag: A,
        relationship: "friend",
      })
    ).statusCode,
    200,
  );
  await db.query(
    "insert into account_follow(account_id,followed_account_id) values ($1,$2)",
    [ACCOUNT_FAN, AUTHOR],
  );
});

after(async () => {
  await scratch?.drop();
});

test("with posts off, or comments off, a post about nothing in the record is refused and none is read", async () => {
  for (const h of [offHandler, commentsOnlyHandler]) {
    const off = callWith(h);
    const w = await off(AUTHOR, "POST", "/api/me/posts", {
      text: "Is Hog good?",
    });
    assert.equal(w.statusCode, 404);
    assert.equal(data(w).error, "posts_off");
    // The lists still answer (a post about a battle is read either way,
    // 0292), holding no post about nothing in the record.
    const r = await off(AUTHOR, "GET", "/api/me/posts", null, { mine: "1" });
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(data(r).posts, []);
    for (const [method, path, body] of [
      ["DELETE", "/api/me/posts/1"],
      ["POST", "/api/me/post-reports", { id: "1", reason: "spam" }],
    ]) {
      const x = await off(AUTHOR, method, path, body);
      assert.equal(x.statusCode, 404, `${method} ${path}`);
    }
    const me = data(await off(AUTHOR, "GET", "/api/me"));
    assert.equal(me.features?.posts, false, "Settings is told posts are off");
  }
  const me = data(await call(AUTHOR, "GET", "/api/me"));
  assert.equal(me.features?.posts, true);
  assert.equal(asked.length, 0);
  assert.deepEqual(await stored(AUTHOR), []);
});

test("a person with no Verified player may not post, and nothing is checked", async () => {
  const r = await write(UNVERIFIED, { text: "Is Hog good at 7k?" });
  assert.equal(r.statusCode, 403, r.body);
  assert.equal(data(r).error, "not_verified");
  assert.equal(asked.length, 0);
  assert.deepEqual(await stored(UNVERIFIED), []);
});

test("a refusal, an error and a paused month store no post", async () => {
  next = () => ({ allow: false, category: "personal_info" });
  let r = await write(STRANGER, { text: "where is everyone from" });
  assert.equal(r.statusCode, 422, r.body);
  assert.equal(data(r).category, "personal_info");
  next = () => new Error("bridge down");
  await aMinuteLater(STRANGER);
  r = await write(STRANGER, { text: "Is Hog good at 7k?" });
  assert.equal(r.statusCode, 503, r.body);
  assert.equal(data(r).error, "unavailable");
  next = () => ({ allow: true, category: "none" });
  await forget(STRANGER);
  await scratch.db.query(
    `insert into comment_check (account_id, item_id, verdict, stage, cost_usd)
     values ($1, 'tl_00000000000000000000', 'allow', 'model', 1)`,
    [STRANGER],
  );
  r = await callWith(pausedHandler)(STRANGER, "POST", "/api/me/posts", {
    text: "Is Hog good at 7k?",
  });
  assert.equal(r.statusCode, 503, r.body);
  assert.equal(data(r).error, "paused");
  assert.deepEqual(await stored(STRANGER), [], "nothing posted unchecked");
  // The check logged each as a post, with the post policy.
  const kinds = (
    await scratch.db.query(
      `select distinct kind from comment_check where account_id = $1 and item_id <> 'tl_00000000000000000000'`,
      [STRANGER],
    )
  ).rows.map((r) => r.kind);
  assert.deepEqual(kinds, ["post"]);
  assert.match(asked[0].system, /open-ended|post/i);
  assert.match(asked[0].prompt, /<post>\nwhere is everyone from\n<\/post>/);
  await forget(STRANGER);
});

test("a question with a pasted deck link posts the deck, without the link", async () => {
  asked.length = 0;
  next = () => ({ allow: true, category: "none" });
  const r = await write(AUTHOR, {
    text: `Is this good for 7k? ${WEB} thanks`,
    question: true,
  });
  assert.equal(r.statusCode, 201, r.body);
  const { post } = data(r);
  assert.equal(post.kind, "post");
  assert.match(post.id, /^tl_[0-9a-f]{20}$/);
  assert.equal(post.post.text, "Is this good for 7k? thanks");
  assert.equal(post.post.question, true);
  assert.deepEqual(
    post.post.deck.cards.map((c) => c.id),
    IDS,
  );
  assert.equal(post.post.deck.tower_troop.name, "Tower Princess");
  assert.equal(post.post.deck.copy_link, WEB);
  assert.equal(post.post.deck.average_elixir, 3);
  assert.match(asked[0].prompt, /A question/);
  assert.match(asked[0].prompt, /a deck of eight cards attached/);
  assert.doesNotMatch(asked[0].prompt, /clashroyale/, "the link is not sent");
  const [row] = await stored(AUTHOR);
  assert.deepEqual(row.deck, { cards: IDS, tower_troop: TT });
  assert.doesNotMatch(row.body, /http|clashroyale/);
});

test("each deck-link spelling reads; unknown cards and other links are refused", async () => {
  for (const link of [
    `https://link.clashroyale.com/deck/en?deck=${IDS.join(";")}`,
    `clashroyale://copyDeck?deck=${IDS.join("%3B")}&tt=${TT}`,
  ]) {
    await aMinuteLater(CLANMATE);
    const r = await write(CLANMATE, { text: `Deck ${link.length}? ${link}` });
    assert.equal(r.statusCode, 201, `${link}: ${r.body}`);
  }
  await forget(CLANMATE);
  // A card that left the catalog, a tower troop that is a card.
  for (const deck of [
    [...IDS.slice(0, 7), 26000099].join(";"),
    `${IDS.join(";")}&tt=${IDS[0]}`,
  ]) {
    const r = await write(CLANMATE, {
      text: "Deck",
      deck_link: `https://link.clashroyale.com/deck/en?deck=${deck}`,
    });
    assert.equal(r.statusCode, 422, r.body);
    assert.equal(data(r).category, "deck");
  }
  let r = await write(CLANMATE, {
    text: "Deck",
    deck_link: "https://example.com/deck",
  });
  assert.equal(r.statusCode, 422);
  assert.equal(data(r).category, "deck");
  r = await write(CLANMATE, { text: "Cards", cards: [IDS[0], 1234] });
  assert.equal(r.statusCode, 422);
  assert.equal(data(r).category, "cards");
  r = await write(CLANMATE, { text: "Cards", cards: [...IDS, TT] });
  assert.equal(r.statusCode, 422, "nine cards");
  // A link the reader does not know stays words, and the filter refuses it.
  const before = asked.length;
  r = await write(CLANMATE, { text: "my deck https://royaleapi.com/decks/x" });
  assert.equal(r.statusCode, 422, r.body);
  assert.equal(data(r).category, "link");
  assert.equal(asked.length, before, "the filter refuses before the model");
  assert.equal((await stored(CLANMATE)).length, 2);
  await forget(CLANMATE);
});

test("loose cards post with their names", async () => {
  await aMinuteLater(AUTHOR);
  const r = await write(AUTHOR, {
    text: "Best of these?",
    cards: [IDS[2], IDS[0]],
  });
  assert.equal(r.statusCode, 201, r.body);
  assert.deepEqual(data(r).post.post.cards, [
    { id: IDS[2], name: "Card 3" },
    { id: IDS[0], name: "Card 1" },
  ]);
});

test("rate limits: one a minute, five a day", async () => {
  let r = await write(AUTHOR, { text: "Too soon?" });
  assert.equal(r.statusCode, 429, r.body);
  for (let i = 0; i < 3; i++) {
    await aMinuteLater(AUTHOR);
    r = await write(AUTHOR, { text: `Post number ${i + 3}` });
    assert.equal(r.statusCode, 201, r.body);
  }
  await aMinuteLater(AUTHOR);
  r = await write(AUTHOR, { text: "A sixth" });
  assert.equal(r.statusCode, 429, r.body);
  assert.match(data(r).message, /5 posts today/);
});

test("the audience: the author, followers of the player or the account; not a stranger", async () => {
  const mine = await feedPosts(AUTHOR);
  assert.equal(mine.length, 5);
  assert.equal((await feedPosts(FOLLOWER)).length, 5);
  assert.equal((await feedPosts(ACCOUNT_FAN)).length, 5);
  assert.deepEqual(await feedPosts(STRANGER), []);
  assert.deepEqual(
    data(await call(STRANGER, "GET", "/api/me/posts", null, { player: A }))
      .posts,
    [],
  );
  assert.equal(
    data(await call(FOLLOWER, "GET", "/api/me/posts", null, { player: A }))
      .posts.length,
    5,
  );
  // A stranger may not cheer or comment on one they cannot see.
  const item = mine[0].id;
  let r = await call(STRANGER, "PUT", "/api/me/cheers", {
    item_id: item,
    cheer: "well_played",
  });
  assert.ok(r.statusCode >= 400, r.body);
  r = await call(STRANGER, "POST", "/api/me/comments", {
    item_id: item,
    text: "hi",
  });
  assert.ok(r.statusCode >= 400, r.body);
});

test("clanmates see the posts in Clan's Feed, and may cheer them there", async () => {
  const feed = await readClanFeed(
    scratch.db,
    { accountId: CLANMATE, kind: "person", timezone: "UTC" },
    CLAN,
    Date.now(),
    { posts: true, comments: true },
  );
  const posts = feed.items.filter((it) => it.kind === "post");
  assert.ok(posts.some((p) => p.post.author.player_tag === A));
  const off = await readClanFeed(
    scratch.db,
    { accountId: CLANMATE, kind: "person", timezone: "UTC" },
    CLAN,
    Date.now(),
  );
  assert.equal(off.items.filter((it) => it.kind === "post").length, 0);
  // Not a follower, but a clanmate: they may cheer it; commenting keeps
  // to the author's own setting (followers, by default).
  const id = posts.find((p) => p.post.author.player_tag === A).id;
  let r = await call(CLANMATE, "PUT", "/api/me/cheers", {
    item_id: id,
    cheer: "on_fire",
  });
  assert.ok(r.statusCode < 300, r.body);
  r = await call(CLANMATE, "POST", "/api/me/comments", {
    item_id: id,
    text: "Looks fine to me",
  });
  assert.equal(data(r).error, "not_open", r.body);
  // The Feed's post carries the reader's cheer and its comments, so the
  // card can draw both (#1100, Codex).
  const again = await readClanFeed(
    scratch.db,
    { accountId: CLANMATE, kind: "person", timezone: "UTC" },
    CLAN,
    Date.now(),
    { posts: true, comments: true },
  );
  const mine = again.items.find((it) => it.id === id);
  assert.equal(mine.my_cheer, "on_fire");
  assert.ok((mine.cheers?.on_fire ?? 0) >= 1, JSON.stringify(mine.cheers));
  assert.equal(mine.comments.open, false);
  // Nothing else in the Feed takes a cheer.
  assert.ok(
    again.items
      .filter((it) => it.kind !== "post")
      .every((it) => !("cheers" in it) && !("comments" in it)),
  );
});

test("cheers and answers on a post reach its author's bell, never who cheered", async () => {
  const [item] = await feedPosts(FOLLOWER);
  let r = await call(FOLLOWER, "PUT", "/api/me/cheers", {
    item_id: item.id,
    cheer: "well_played",
  });
  assert.ok(r.statusCode < 300, r.body);
  const stamped = (
    await scratch.db.query(
      `select subject_tags from timeline_cheer where item_id = $1`,
      [item.id],
    )
  ).rows[0];
  assert.equal(
    stamped.subject_tags,
    null,
    "no player stamp, so no mail or push",
  );
  r = await call(FOLLOWER, "POST", "/api/me/comments", {
    item_id: item.id,
    text: "yes that works",
  });
  assert.equal(r.statusCode, 201, r.body);
  const bell = await readBell(scratch.db, AUTHOR, {
    comments: true,
    posts: true,
  });
  const reaction = bell.reactions.items.find((it) => it.item_id === item.id);
  assert.ok(reaction, JSON.stringify(bell.reactions));
  assert.equal(reaction.total, 2, "the follower's and the clanmate's");
  assert.doesNotMatch(JSON.stringify(reaction), new RegExp(FOLLOWER));
  const noPosts = await readBell(scratch.db, AUTHOR, { comments: true });
  assert.equal(
    noPosts.reactions.items.find((it) => it.item_id === item.id),
    undefined,
  );
});

test("a block either way hides posts and refuses comments", async () => {
  const [item] = await feedPosts(ACCOUNT_FAN);
  let r = await call(AUTHOR, "POST", "/api/me/blocks", { player_tag: K });
  assert.ok(r.statusCode < 300, r.body);
  assert.deepEqual(await feedPosts(ACCOUNT_FAN), []);
  r = await call(ACCOUNT_FAN, "POST", "/api/me/comments", {
    item_id: item.id,
    text: "hi",
  });
  assert.ok(r.statusCode >= 400, r.body);
  assert.deepEqual(
    data(await call(ACCOUNT_FAN, "GET", "/api/me/posts", null, { player: A }))
      .posts,
    [],
  );
  await scratch.db.query(`delete from account_block where account_id = $1`, [
    AUTHOR,
  ]);
  // The block ended the follow; follow again for the rest.
  await scratch.db.query(
    "insert into account_follow(account_id,followed_account_id) values ($1,$2) on conflict do nothing",
    [ACCOUNT_FAN, AUTHOR],
  );
  assert.equal((await feedPosts(ACCOUNT_FAN)).length, 5);
});

test("hostile text is kept as plain words, never markup", async () => {
  await forget(CLANMATE);
  const r = await write(CLANMATE, { text: `<img src=x onerror=alert(1)> "&'` });
  assert.equal(r.statusCode, 201, r.body);
  assert.equal(data(r).post.post.text, `<img src=x onerror=alert(1)> "&'`);
});

test("reports hide a post at two; an admin removes or dismisses", async () => {
  // The clanmate's post: the author sees it in Clan's Feed, the fan by
  // following the clanmate's account.
  await scratch.db.query(
    "insert into account_follow(account_id,followed_account_id) values ($1,$2)",
    [ACCOUNT_FAN, CLANMATE],
  );
  const [mine] = await feedPosts(CLANMATE);
  const target = mine.post.id;
  assert.equal(
    (
      await call(STRANGER, "POST", "/api/me/post-reports", {
        id: target,
        reason: "spam",
      })
    ).statusCode,
    404,
    "a post the reporter cannot see",
  );
  for (const who of [AUTHOR, ACCOUNT_FAN]) {
    const r = await call(who, "POST", "/api/me/post-reports", {
      id: target,
      reason: "spam",
    });
    assert.equal(r.statusCode, 200, r.body);
  }
  assert.equal((await stored(CLANMATE)).at(-1).status, "hidden");
  const q = data(await call(ADMIN, "GET", "/api/admin/comments"));
  assert.equal(q.posts_enabled, true);
  assert.ok(q.posts.some((p) => p.id === target && p.reports.length === 2));
  assert.equal(
    (await call(ADMIN, "POST", "/api/admin/posts/dismiss", { id: target }))
      .statusCode,
    200,
  );
  assert.equal((await stored(CLANMATE)).at(-1).status, "visible");
  assert.equal(
    (await call(ADMIN, "POST", "/api/admin/posts/remove", { id: target }))
      .statusCode,
    200,
  );
  assert.equal((await stored(CLANMATE)).at(-1).status, "removed");
  assert.equal(
    (await call(CLANMATE, "POST", "/api/admin/posts/remove", { id: target }))
      .statusCode,
    403,
  );
});

test("the author deletes a post at once; nobody else can", async () => {
  const [item] = await feedPosts(AUTHOR);
  assert.equal(
    (await call(FOLLOWER, "DELETE", `/api/me/posts/${item.post.id}`))
      .statusCode,
    404,
  );
  const r = await call(AUTHOR, "DELETE", `/api/me/posts/${item.post.id}`);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(
    (await feedPosts(FOLLOWER)).find((it) => it.id === item.id),
    undefined,
  );
  const left = (
    await scratch.db.query(
      `select (select count(*) from account_post where item_id = $1)::int as posts,
              (select count(*) from timeline_cheer where item_id = $1)::int as cheers,
              (select count(*) from timeline_comment where item_id = $1 and status <> 'removed')::int as comments`,
      [item.id],
    )
  ).rows[0];
  assert.deepEqual(left, { posts: 0, cheers: 0, comments: 0 });
});

/** The record's readers of posts about battles (0292), each reading only
 *  rows with a battle. */
const BATTLE_POST_READERS = [
  "packages/stamps/src/backfill.mjs",
  "packages/stamps/src/earn.mjs",
  "packages/syndication/src/battle-post-share.mjs",
  "packages/tools/src/activity/entries.mjs",
];

test("a post about nothing in the record never reaches the record's timeline, which MCP, mail, push, RSS and Discord build from", async () => {
  const subjects = await subjectsFor(scratch.db, FOLLOWER);
  const built = await buildTimeline(scratch.db, subjects, {
    fromMs: Date.now() - 7 * 86_400_000,
    toMs: Date.now() + 60_000,
    accountId: FOLLOWER,
    interactive: true,
  });
  assert.equal(built.timeline.filter((it) => it.kind === "post").length, 0);
  // And no code outside the web API's own reads, the schema, the account
  // removal and the sweeps names the table, but for the readers of posts
  // about battles (0292: what highlights were), which read only those.
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const files = execFileSync("git", ["grep", "-l", "account_post", "--", "."], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean)
    .filter(
      (f) =>
        !/^(db\/|docs\/|services\/web-api\/(src|test)\/|services\/migrate\/(src|test)\/ops-account-remove|services\/jobs\/src\/index|packages\/record\/src\/retention|apps\/web\/|services\/jobs\/test\/)/.test(
          f,
        ),
    )
    .filter((f) => !BATTLE_POST_READERS.includes(f) && !/\/test\//.test(f));
  assert.deepEqual(files, []);
});

test("a post is 500 characters at most, longer than a comment", async () => {
  await forget(CLANMATE);
  await aMinuteLater(CLANMATE);
  const before = asked.length;
  let r = await write(CLANMATE, { text: "a".repeat(501) });
  assert.equal(r.statusCode, 422, r.body);
  assert.equal(data(r).category, "too_long");
  assert.match(data(r).message, /500/);
  assert.equal(asked.length, before);
  r = await write(CLANMATE, { text: `Long question ${"b".repeat(400)}?` });
  assert.equal(r.statusCode, 201, r.body);
});

test("with comments on and posts off, a post about a battle's author can be blocked from it; a plain post's cannot", async () => {
  const { db } = scratch;
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class)
     values ('ps-block-battle', now() - interval '1 hour', 'PvP', 'pvp')`,
  );
  await db.query(
    `insert into battle_participant
       (battle_id, player_tag, battle_time, side, type, type_class, outcome)
     values ('ps-block-battle', $1, now() - interval '1 hour', 0, 'PvP', 'pvp', 'win')`,
    [A],
  );
  const {
    rows: [battlePost, plainPost],
  } = await db.query(
    `insert into account_post (item_id, account_id, player_tag, body, battle_id)
     values ('tl_0000000000000000b10c', $1, $2, '', 'ps-block-battle'),
            ('tl_0000000000000000b10d', $1, $2, 'words alone', null)
     returning post_id::text as id`,
    [AUTHOR, A],
  );
  const off = callWith(commentsOnlyHandler);
  const plain = await off(STRANGER, "POST", "/api/me/blocks", {
    post_id: plainPost.id,
  });
  assert.equal(plain.statusCode, 404, plain.body);
  const r = await off(STRANGER, "POST", "/api/me/blocks", {
    post_id: battlePost.id,
  });
  assert.equal(r.statusCode, 200, r.body);
  const { rows } = await db.query(
    `select 1 from account_block where account_id = $1 and blocked_account_id = $2`,
    [STRANGER, AUTHOR],
  );
  assert.equal(rows.length, 1);
  await db.query(`delete from account_block where account_id = $1`, [STRANGER]);
  await db.query(`delete from account_post where item_id = any($1)`, [
    ["tl_0000000000000000b10c", "tl_0000000000000000b10d"],
  ]);
});
