/**
 * Posts about battles (social slice 4, #762; 2026-11-17, 0292: what was
 * a highlight is a post with a battle attached). A person posts about one
 * of their verified players' battles on that player's timeline, words
 * optional, and may share it as /h/<id>. Pinned here: only a verified
 * player of yours who played the battle can be posted as; the post is its
 * writer's to edit, share and delete; a shared post opens signed out and
 * carries nothing about the account; a deleted one is a 404; a name and
 * words are escaped at each output; the timeline item carries the words,
 * and the share link only for its owner; a post and an edit that changes
 * the words wake the Discord syndication of the timelines the player
 * reaches, and an edit is the same item at a higher revision. The handler
 * here has posts and comments off: a post about a battle works anyway,
 * as highlighting did.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { processResult } from "../../../packages/ingest/src/pipeline.mjs";
import { emailHash } from "../../../packages/auth/src/index.mjs";
import { makeHandler } from "../src/handler.mjs";

import { makeShareImage } from "../src/share-image.mjs";
import { shareSources } from "../src/share-files.mjs";
import {
  createScratch,
  dropScratch,
} from "../../../packages/ingest/test/helpers.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const adminUrl =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const name = `elixir_mcp_test_battle_posts_${process.pid}`;
const databaseUrl = adminUrl.replace(/\/postgres$/, `/${name}`);

// The fixture's own player (fixtures/player_battlelog).
const PLAYER = "#0QRVVG22J";
const OWNER = "highlight-owner@example.com";
const FRIEND = "highlight-friend@example.com";
const STRANGER = "highlight-stranger@example.com";
const HOSTILE_NAME = '<script>alert("n")</script> & "co"';
const HOSTILE_WORDS =
  'What a game </title><img src=x onerror="alert(1)"> & more';
const SHELL = `<!doctype html><html><head>
    <title>Elixir</title>
    <meta name="description" content="The app" />
    <meta property="og:title" content="Elixir" />
    <meta property="og:image" content="https://elixir.poapkings.com/assets/og.png" />
    <meta name="twitter:card" content="summary_large_image" />
  </head><body><div id="root"></div></body></html>`;

let db, handler;
const sent = [];
const cookies = {};
let battleId, otherBattleId, ownerId, friendId;
// The syndication wakes the routes write (the outbox's timeline-sync lane).
const wakes = [];

const request = (method, p, { body, who, contract = true } = {}) =>
  handler({
    path: p.split("?")[0],
    method,
    queryStringParameters: p.includes("?")
      ? Object.fromEntries(new URLSearchParams(p.split("?")[1]))
      : undefined,
    headers: {
      ...(who ? { cookie: cookies[who] } : {}),
      "cloudfront-viewer-address": "8.8.4.4:443",
      ...(contract ? { "x-elixir-client": "web" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const call = async (method, p, opts) => {
  const res = await request(method, p, opts);
  return { status: res.statusCode, body: JSON.parse(res.body), res };
};

async function signIn(email) {
  await request("POST", "/api/auth", { body: { age_13: true, email } });
  const { code } = sent.at(-1);
  const res = await request("POST", "/api/auth/code", {
    body: { email, code },
  });
  assert.equal(res.statusCode, 200, res.body);
  return res.headers["set-cookie"].split(";")[0];
}

async function account(email, claim) {
  const {
    rows: [a],
  } = await db.query(
    `insert into account (email_hash, status, role, timezone)
     values ($1, 'approved', 'member', 'UTC') returning account_id`,
    [emailHash(email)],
  );
  if (claim)
    await db.query(
      `insert into claim (account_id, player_tag, is_primary, relationship,
                          notify, status)
       values ($1, $2, $3, $4, true, $5)`,
      [
        a.account_id,
        PLAYER,
        claim === "verified",
        claim === "verified" ? "primary" : "friend",
        claim,
      ],
    );
  return a.account_id;
}

before(async () => {
  await createScratch(name);
  db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  const {
    rows: [operator],
  } = await db.query(
    `insert into account (email_hash, status) values ('highlight-op', 'approved')
     returning account_id`,
  );
  await db.query(`insert into player (player_tag) values ($1)`, [PLAYER]);
  await db.query(
    `insert into recording (subject_type, subject_tag, requested_by) values ('player', $1, $2)`,
    [PLAYER, operator.account_id],
  );
  const {
    rows: [gw],
  } = await db.query(
    `insert into gateway (owner_account_id, name, static_ip, status)
     values ($1, 'highlight-gw', '127.0.0.1', 'active') returning gateway_id`,
    [operator.account_id],
  );
  const send = async (endpoint, entityKey, rel, fetchedAt) => {
    const payload = JSON.parse(
      await readFile(path.join(repoRoot, "fixtures", rel), "utf8"),
    );
    const result = await processResult(db, {
      v: 1,
      job: { endpoint, entity_key: entityKey, lane: "bulk" },
      gateway_id: gw.gateway_id,
      fetched_at: fetchedAt,
      status: "ok",
      body_gzip_b64: gzipSync(Buffer.from(JSON.stringify(payload))).toString(
        "base64",
      ),
    });
    assert.equal(result.outcome, "admitted", JSON.stringify(result));
  };
  await send("cards", "GLOBAL", "cards/catalog.json", "2026-09-03T13:00:00Z");
  await send(
    "player_battlelog",
    PLAYER,
    "player_battlelog/with_colosseum_duel.json",
    "2026-09-03T14:30:34Z",
  );
  // A player names themselves: markup and quotes are a name like any other.
  await db.query(`update player set name = $2 where player_tag = $1`, [
    PLAYER,
    HOSTILE_NAME,
  ]);
  const { rows } = await db.query(
    `select bp.battle_id from battle_participant bp join battle b using (battle_id)
      where bp.player_tag = $1 and b.type = 'PvP'
      order by b.battle_time desc limit 2`,
    [PLAYER],
  );
  [battleId, otherBattleId] = rows.map((r) => r.battle_id);

  const sources = shareSources();
  handler = makeHandler({
    databaseUrl,
    secret: "highlight-secret",
    sendLoginEmail: async (m) => sent.push(m),
    notifyOwner: async () => {},
    sendWelcomeEmail: async () => {},
    siteShell: async () => SHELL,
    discord: {
      outbox: async (lane, message, opts) =>
        wakes.push({ lane, message, opts }),
    },
    shareImage: makeShareImage({
      assets: async () =>
        Object.fromEntries(
          await Promise.all(
            Object.entries(sources).map(async ([k, f]) => [
              k,
              await readFile(f),
            ]),
          ),
        ),
    }),
  });
  ownerId = await account(OWNER, "verified");
  friendId = await account(FRIEND, "unverified");
  await account(STRANGER, null);
  cookies.owner = await signIn(OWNER);
  cookies.friend = await signIn(FRIEND);
  cookies.stranger = await signIn(STRANGER);
});

after(async () => {
  await db.end();
  await dropScratch(name);
});

test("only a verified player of yours who played the battle can be posted as", async () => {
  // Signed out.
  const out = await call("POST", "/api/me/posts", {
    body: { battle: battleId, text: "hi" },
  });
  assert.equal(out.status, 401);
  // An unverified claim is anyone's to make: it never lets you post.
  const friend = await call("POST", "/api/me/posts", {
    who: "friend",
    body: { battle: battleId, player_tag: PLAYER, text: "mine now" },
  });
  assert.equal(friend.status, 403);
  assert.equal(friend.body.error, "not_your_battle");
  const asked = await call("GET", `/api/me/posts?battle=${battleId}`, {
    who: "friend",
  });
  assert.equal(asked.status, 200);
  assert.deepEqual(asked.body.can_post_as, []);
  // No claim at all.
  const stranger = await call("POST", "/api/me/posts", {
    who: "stranger",
    body: { battle: battleId, player_tag: PLAYER },
  });
  assert.equal(stranger.status, 403);
  // Your verified player, but a player of the battle who is not yours.
  const { rows } = await db.query(
    `select player_tag from battle_participant where battle_id = $1 and player_tag <> $2`,
    [battleId, PLAYER],
  );
  const opponent = await call("POST", "/api/me/posts", {
    who: "owner",
    body: { battle: battleId, player_tag: rows[0].player_tag },
  });
  assert.equal(opponent.status, 403);
  // A battle Elixir does not hold.
  const none = await call("POST", "/api/me/posts", {
    who: "owner",
    body: { battle: "ffffffffffffffff", player_tag: PLAYER },
  });
  assert.equal(none.status, 404);
  // Too many words: the post check's own limit.
  const long = await call("POST", "/api/me/posts", {
    who: "owner",
    body: { battle: battleId, text: "x".repeat(501) },
  });
  assert.equal(long.status, 422);
  assert.equal(long.body.category, "too_long");
  // A battle carries itself: no deck or cards beside it.
  const cards = await call("POST", "/api/me/posts", {
    who: "owner",
    body: { battle: battleId, text: "hi", cards: [26000000] },
  });
  assert.equal(cards.status, 422);
  // A write needs the contract header.
  const bare = await call("POST", "/api/me/posts", {
    who: "owner",
    contract: false,
    body: { battle: battleId },
  });
  assert.notEqual(bare.status, 201);
  const count = await db.query(
    `select count(*)::int as n from account_post where battle_id is not null`,
  );
  assert.equal(count.rows[0].n, 0);
});

test("a post about nothing in the record still needs posts on", async () => {
  const plain = await call("POST", "/api/me/posts", {
    who: "owner",
    body: { text: "just words" },
  });
  assert.equal(plain.status, 404);
  assert.equal(plain.body.error, "posts_off");
});

test("create without words, edit, share, then delete: the link is a 404", async () => {
  const before = await call("GET", `/api/me/posts?battle=${battleId}`, {
    who: "owner",
  });
  assert.deepEqual(before.body.can_post_as, [PLAYER]);
  assert.deepEqual(before.body.posts, []);

  // Words are optional: the battle is the post.
  const made = await call("POST", "/api/me/posts", {
    who: "owner",
    body: { battle: battleId },
  });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const item = made.body.post;
  const h = item.post;
  assert.equal(item.kind, "post");
  assert.equal(item.subject_tag, PLAYER);
  assert.equal(h.battle.battle_id, battleId);
  assert.equal(h.text, "");
  assert.equal(h.share_url, null);
  assert.equal(h.deck, null);
  assert.deepEqual(h.cards, []);
  assert.equal(h.can_edit, true);

  const again = await call("POST", "/api/me/posts", {
    who: "owner",
    body: { battle: battleId, player_tag: PLAYER, text: "twice" },
  });
  assert.equal(again.status, 409);

  // Somebody else's post is not theirs to change, share or delete.
  for (const [method, p, body] of [
    ["PUT", `/api/me/posts/${h.id}`, { text: "hijack" }],
    ["POST", "/api/me/item-shares", { id: h.id }],
    ["DELETE", `/api/me/posts/${h.id}`, undefined],
  ]) {
    const r = await call(method, p, { who: "friend", body });
    assert.equal(r.status, 404, `${method} ${p}`);
  }

  // A game-scope selector must not publish post words through a path
  // that never checked the reader's post visibility.
  const bypass = await call("POST", "/api/me/item-shares", {
    who: "stranger",
    body: {
      source: "game",
      kind: "battle_highlight",
      item_id: item.id,
      subject: { kind: "player", tag: PLAYER },
      at: item.at,
    },
  });
  assert.equal(bypass.status, 404);

  const edited = await call("PUT", `/api/me/posts/${h.id}`, {
    who: "owner",
    body: { text: HOSTILE_WORDS },
  });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.post.post.text, HOSTILE_WORDS);
  assert.equal(edited.body.post.post.edited, true);

  const shared = await call("POST", "/api/me/item-shares", {
    who: "owner",
    body: { source: "post", post_id: h.id, item_id: made.body.post.id },
  });
  assert.equal(shared.status, 200);
  const url = shared.body.url;
  assert.match(url, /^https:\/\/elixir\.poapkings\.com\/share\/[a-z2-7]{24}$/);
  const shareId = url.split("/").at(-1);
  // Sharing twice is the same link.
  const twice = await call("POST", "/api/me/item-shares", {
    who: "owner",
    body: { source: "post", post_id: h.id, item_id: made.body.post.id },
  });
  assert.equal(twice.body.url, url);

  // Open, signed out: the page, the JSON and the picture.
  const page = await request("GET", `/share/${shareId}`);
  assert.equal(page.statusCode, 200);
  assert.match(page.headers["cache-control"], /no-store/);
  const json = await call("GET", `/api/public/shared-items/${shareId}`);
  assert.equal(json.status, 200);
  assert.equal(json.body.item.post.text, HOSTILE_WORDS);
  assert.equal(json.body.item.post.author.name, HOSTILE_NAME);
  assert.equal(json.body.item.post.author.player_tag, PLAYER);
  assert.equal(json.body.url, url);
  assert.ok(json.body.item.post.battle);
  const png = await request("GET", `/share/${shareId}.png`);
  assert.equal(png.statusCode, 200);
  assert.equal(png.headers["content-type"], "image/png");
  assert.equal(png.isBase64Encoded, true);

  // Nothing about the account, its nicknames or its email, anywhere in it.
  const text = JSON.stringify(json.body);
  for (const leak of [ownerId, OWNER, "account", "nickname", "email"])
    assert.equal(text.includes(leak), false, leak);
  assert.equal("post_id" in json.body.item.post, false);

  // Deleted: gone from the panel, and every address of the post 404s.
  const gone = await call("DELETE", `/api/me/posts/${h.id}`, {
    who: "owner",
  });
  assert.equal(gone.status, 200);
  assert.equal((await request("GET", `/share/${shareId}`)).statusCode, 404);
  assert.equal((await request("GET", `/share/${shareId}.png`)).statusCode, 404);
  assert.equal(
    (await call("GET", `/api/public/shared-items/${shareId}`)).status,
    404,
  );
  const after = await call("GET", `/api/me/posts?battle=${battleId}`, {
    who: "owner",
  });
  assert.deepEqual(after.body.posts, []);
  const again404 = await call("DELETE", `/api/me/posts/${h.id}`, {
    who: "owner",
  });
  assert.equal(again404.status, 404);
});

test("a plain post cannot be shared", async () => {
  const {
    rows: [p],
  } = await db.query(
    `insert into account_post (item_id, account_id, player_tag, body)
     values ('tl_0000000000000000abcd', $1, $2, 'words alone')
     returning post_id::text as id`,
    [ownerId, PLAYER],
  );
  const r = await call("POST", "/api/me/item-shares", {
    who: "owner",
    body: { source: "post", post_id: p.id, item_id: "tl_0000000000000000abcd" },
  });
  assert.equal(r.status, 404);
  await db.query(`delete from account_post where post_id = $1::bigint`, [p.id]);
});

test("a shared post's page escapes the name and the words in its tags", async () => {
  const made = await call("POST", "/api/me/posts", {
    who: "owner",
    body: { battle: otherBattleId, text: HOSTILE_WORDS },
  });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const shared = await call("POST", "/api/me/item-shares", {
    who: "owner",
    body: {
      source: "post",
      post_id: made.body.post.post.id,
      item_id: made.body.post.id,
    },
  });
  const url = shared.body.url;
  const shareId = url.split("/").at(-1);
  const page = await request("GET", `/share/${shareId}`);
  const html = page.body;
  assert.equal(page.statusCode, 200);
  // The only markup is the shell's own.
  assert.equal(html.includes("<script>"), false);
  assert.equal(html.includes("<img"), false);
  assert.equal(html.includes("</title><img"), false);
  assert.ok(html.includes("&lt;script&gt;alert(&quot;n&quot;)&lt;/script&gt;"));
  assert.ok(html.includes("onerror=&quot;alert(1)&quot;"));
  assert.ok(html.includes(`<meta property="og:url" content="${url}" />`));
  assert.ok(html.includes(`<link rel="canonical" href="${url}" />`));
  assert.ok(html.includes(`<meta property="og:image" content="${url}.png" />`));
  // A post that never existed, and a malformed id, are 404s too.
  assert.equal((await request("GET", "/h/aaaaaaaaaaaaaaa")).statusCode, 404);
  assert.equal((await request("GET", "/h/NOT-AN-ID")).statusCode, 404);
  assert.equal(
    (await call("GET", "/api/public/posts/aaaaaaaaaaaaaaa")).status,
    404,
  );
});

test("the timeline item carries the words, and the link only for its owner", async () => {
  const mine = await call("GET", "/api/me/timeline", { who: "owner" });
  assert.equal(mine.status, 200, JSON.stringify(mine.body));
  const item = mine.body.timeline.find((it) => it.kind === "battle_highlight");
  assert.ok(item, JSON.stringify(mine.body.timeline.map((it) => it.kind)));
  assert.equal(item.section, "battles");
  assert.equal(item.facts.player_tag, PLAYER);
  assert.equal(item.facts.words, HOSTILE_WORDS);
  assert.equal(item.facts.battle.battle_id, otherBattleId);
  // The post's id, under both names (schema v2).
  assert.match(item.facts.post_id, /^[1-9][0-9]*$/);
  assert.equal(item.facts.highlight_id, item.facts.post_id);
  assert.match(
    item.facts.battle.url,
    /^https:\/\/elixir\.poapkings\.com\/battle\//,
  );
  assert.match(
    item.facts.share_url,
    /^https:\/\/elixir\.poapkings\.com\/share\//,
  );
  assert.ok(item.text.includes(HOSTILE_WORDS));
  assert.ok(item.text.includes("posted about"), item.text);

  // A friend who follows the player reads the post, never its owner's
  // share link (theirs to hand out).
  const theirs = await call("GET", "/api/me/timeline", { who: "friend" });
  assert.equal(theirs.status, 200);
  const seen = theirs.body.timeline.find(
    (it) => it.kind === "battle_highlight",
  );
  assert.ok(seen);
  assert.equal(seen.facts.words, HOSTILE_WORDS);
  assert.equal("share_url" in seen.facts, false);
});

test("a post and a changed edit wake the Discord syndication; the edit is the same item grown", async () => {
  // The friend cross-posts their timeline, which follows the player.
  await db.query(
    `insert into timeline_discord (account_id, webhook_sealed, webhook_fp,
       webhook_display)
     values ($1, '{}', '0123456789abcdef', 'hook ...abcd')`,
    [friendId],
  );
  const syncWakes = () =>
    wakes
      .filter((w) => w.lane === "timeline-sync")
      .map((w) => w.message.account_id);
  wakes.length = 0;
  const made = await call("POST", "/api/me/posts", {
    who: "owner",
    body: { battle: battleId, text: "before" },
  });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.deepEqual(syncWakes(), [friendId]);
  const id = made.body.post.post.id;
  const read = async () =>
    (
      await call("GET", "/api/me/timeline", { who: "friend" })
    ).body.timeline.find(
      (it) => it.kind === "battle_highlight" && it.facts.post_id === id,
    );
  const first = await read();
  // The record item and the post are one: the same item id.
  assert.equal(first.id, made.body.post.id);
  assert.equal(first.revision, 1);
  assert.equal(first.facts.words, "before");

  // The same words again change nothing and wake nothing.
  wakes.length = 0;
  const same = await call("PUT", `/api/me/posts/${id}`, {
    who: "owner",
    body: { text: "before" },
  });
  assert.equal(same.status, 200);
  assert.equal(same.body.changed, false);
  assert.deepEqual(syncWakes(), []);
  assert.equal((await read()).revision, 1);

  // New words: a wake, and the same story at a higher revision, posted
  // when it was.
  const edited = await call("PUT", `/api/me/posts/${id}`, {
    who: "owner",
    body: { text: "after" },
  });
  assert.equal(edited.status, 200);
  assert.deepEqual(syncWakes(), [friendId]);
  const grown = await read();
  assert.equal(grown.id, first.id);
  assert.equal(grown.revision, 2);
  assert.equal(grown.at, first.at);
  assert.equal(grown.facts.words, "after");
  assert.ok(grown.observed_at >= first.observed_at);

  // Dropping the words is an edit too: the battle stays the post.
  const dropped = await call("PUT", `/api/me/posts/${id}`, {
    who: "owner",
    body: { text: "" },
  });
  assert.equal(dropped.status, 200, JSON.stringify(dropped.body));
  assert.equal(dropped.body.post.post.text, "");

  // A deletion wakes nothing: no sync takes a line back.
  wakes.length = 0;
  const gone = await call("DELETE", `/api/me/posts/${id}`, {
    who: "owner",
  });
  assert.equal(gone.status, 200);
  assert.deepEqual(syncWakes(), []);
});
