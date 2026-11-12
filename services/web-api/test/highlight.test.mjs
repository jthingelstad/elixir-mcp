/**
 * Highlights (social slice 4, #762): a person posts one of their verified
 * players' battles to that player's timeline with their words, and may
 * share it as /h/<id>. Pinned here: only a verified player of yours who
 * played the battle can be posted as; the post is its writer's to edit,
 * share and delete; a shared post opens signed out and carries nothing
 * about the account; a deleted one is a 404; a name and words are escaped
 * at each output; the timeline item carries the words, and the share link
 * only for its owner.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import { processResult } from "../../../packages/ingest/src/pipeline.mjs";
import { emailHash } from "../../../packages/auth/src/index.mjs";
import { makeHandler } from "../src/handler.mjs";
import { cleanWords, mintShareId } from "../src/highlight.mjs";
import { makeShareImage } from "../src/share-image.mjs";
import { shareSources } from "../src/share-files.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const adminUrl =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const name = `elixir_mcp_test_highlight_${process.pid}`;
const databaseUrl = adminUrl.replace(/\/postgres$/, `/${name}`);

// The fixture's own player (fixtures/player_battlelog).
const PLAYER = "#JYRQ8U92C";
const OWNER = "highlight-owner@example.com";
const FRIEND = "highlight-friend@example.com";
const STRANGER = "highlight-stranger@example.com";
const HOSTILE_NAME = '<script>alert("n")</script> & "co"';
const HOSTILE_WORDS = 'What a game </title><img src=x onerror="alert(1)"> & more';
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
let battleId, otherBattleId, ownerId;

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
  await request("POST", "/api/auth", { body: { email } });
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
      [a.account_id, PLAYER, claim === "verified", claim === "verified" ? "primary" : "friend", claim],
    );
  return a.account_id;
}

before(async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.query(`create database ${name}`);
  await admin.end();
  await migrate({
    databaseUrl,
    migrationsDir: path.join(repoRoot, "db/migrations"),
  });
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
  await account(FRIEND, "unverified");
  await account(STRANGER, null);
  cookies.owner = await signIn(OWNER);
  cookies.friend = await signIn(FRIEND);
  cookies.stranger = await signIn(STRANGER);
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.end();
});

test("share ids: 15 base32 characters, random, never sequential", () => {
  const ids = new Set(Array.from({ length: 200 }, () => mintShareId()));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.match(id, /^[a-z2-7]{15}$/);
  assert.equal(mintShareId(Buffer.alloc(15, 0)), "aaaaaaaaaaaaaaa");
  assert.equal(mintShareId(Buffer.alloc(15, 255)), "777777777777777");
});

test("words: stored as typed, control characters dropped, 500 at most", () => {
  assert.equal(cleanWords("  <b>hi</b>\r\nthere\x00 "), "<b>hi</b>\nthere");
  assert.equal(cleanWords("é".repeat(500)), "é".repeat(500));
  assert.equal(cleanWords("x".repeat(501)), null);
  assert.equal(cleanWords(undefined), "");
});

test("only a verified player of yours who played the battle can be posted as", async () => {
  // Signed out.
  const out = await call("POST", "/api/me/highlights", {
    body: { battle: battleId, words: "hi" },
  });
  assert.equal(out.status, 401);
  // An unverified claim is anyone's to make: it never lets you post.
  const friend = await call("POST", "/api/me/highlights", {
    who: "friend",
    body: { battle: battleId, player_tag: PLAYER, words: "mine now" },
  });
  assert.equal(friend.status, 403);
  assert.equal(friend.body.error, "not_your_battle");
  const asked = await call("GET", `/api/me/highlights?battle=${battleId}`, {
    who: "friend",
  });
  assert.equal(asked.status, 200);
  assert.deepEqual(asked.body.can_highlight_as, []);
  // No claim at all.
  const stranger = await call("POST", "/api/me/highlights", {
    who: "stranger",
    body: { battle: battleId, player_tag: PLAYER },
  });
  assert.equal(stranger.status, 403);
  // Your verified player, but a player of the battle who is not yours.
  const { rows } = await db.query(
    `select player_tag from battle_participant where battle_id = $1 and player_tag <> $2`,
    [battleId, PLAYER],
  );
  const opponent = await call("POST", "/api/me/highlights", {
    who: "owner",
    body: { battle: battleId, player_tag: rows[0].player_tag },
  });
  assert.equal(opponent.status, 403);
  // A battle Elixir does not hold.
  const none = await call("POST", "/api/me/highlights", {
    who: "owner",
    body: { battle: "ffffffffffffffff", player_tag: PLAYER },
  });
  assert.equal(none.status, 404);
  // Too many words.
  const long = await call("POST", "/api/me/highlights", {
    who: "owner",
    body: { battle: battleId, words: "x".repeat(501) },
  });
  assert.equal(long.status, 400);
  // A write needs the contract header.
  const bare = await call("POST", "/api/me/highlights", {
    who: "owner",
    contract: false,
    body: { battle: battleId },
  });
  assert.notEqual(bare.status, 201);
  const count = await db.query(`select count(*)::int as n from battle_highlight`);
  assert.equal(count.rows[0].n, 0);
});

test("create, edit, share, then delete: the link is a 404", async () => {
  const before = await call("GET", `/api/me/highlights?battle=${battleId}`, {
    who: "owner",
  });
  assert.deepEqual(before.body.can_highlight_as, [PLAYER]);
  assert.deepEqual(before.body.highlights, []);

  const made = await call("POST", "/api/me/highlights", {
    who: "owner",
    body: { battle: battleId, words: "first words" },
  });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const h = made.body.highlight;
  assert.equal(h.player_tag, PLAYER);
  assert.equal(h.battle_id, battleId);
  assert.equal(h.words, "first words");
  assert.equal(h.share_url, null);

  const again = await call("POST", "/api/me/highlights", {
    who: "owner",
    body: { battle: battleId, player_tag: PLAYER, words: "twice" },
  });
  assert.equal(again.status, 409);

  // Somebody else's post is not theirs to change, share or delete.
  for (const [method, p, body] of [
    ["PUT", `/api/me/highlights/${h.highlight_id}`, { words: "hijack" }],
    ["POST", "/api/me/highlights/share", { highlight_id: h.highlight_id }],
    ["DELETE", `/api/me/highlights/${h.highlight_id}`, undefined],
  ]) {
    const r = await call(method, p, { who: "friend", body });
    assert.equal(r.status, 404, `${method} ${p}`);
  }

  const edited = await call("PUT", `/api/me/highlights/${h.highlight_id}`, {
    who: "owner",
    body: { words: HOSTILE_WORDS },
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.highlight.words, HOSTILE_WORDS);

  const shared = await call("POST", "/api/me/highlights/share", {
    who: "owner",
    body: { highlight_id: h.highlight_id },
  });
  assert.equal(shared.status, 200);
  const url = shared.body.highlight.share_url;
  assert.match(url, /^https:\/\/elixir\.poapkings\.com\/h\/[a-z2-7]{15}$/);
  const shareId = url.split("/").at(-1);
  // Sharing twice is the same link.
  const twice = await call("POST", "/api/me/highlights/share", {
    who: "owner",
    body: { highlight_id: h.highlight_id },
  });
  assert.equal(twice.body.highlight.share_url, url);

  // Open, signed out: the page, the JSON and the picture.
  const page = await request("GET", `/h/${shareId}`);
  assert.equal(page.statusCode, 200);
  assert.match(page.headers["cache-control"], /max-age=60/);
  const json = await call("GET", `/api/public/highlights/${shareId}`);
  assert.equal(json.status, 200);
  assert.equal(json.body.highlight.words, HOSTILE_WORDS);
  assert.equal(json.body.highlight.name, HOSTILE_NAME);
  assert.equal(json.body.highlight.player_tag, PLAYER);
  assert.equal(json.body.highlight.side, "left");
  assert.equal(json.body.highlight.url, url);
  assert.equal(json.body.battle.id.length > 0, true);
  assert.equal(json.body.sides.length, 2);
  const png = await request("GET", `/h/${shareId}.png`);
  assert.equal(png.statusCode, 200);
  assert.equal(png.headers["content-type"], "image/png");
  assert.equal(png.isBase64Encoded, true);

  // Nothing about the account, its nicknames or its email, anywhere in it.
  const text = JSON.stringify(json.body);
  for (const leak of [
    ownerId,
    OWNER,
    "account",
    "nickname",
    "email",
    h.highlight_id,
  ])
    assert.equal(text.includes(leak), false, leak);

  // Deleted: gone from the panel, and every address of the post 404s.
  const gone = await call("DELETE", `/api/me/highlights/${h.highlight_id}`, {
    who: "owner",
  });
  assert.equal(gone.status, 200);
  assert.equal((await request("GET", `/h/${shareId}`)).statusCode, 404);
  assert.equal((await request("GET", `/h/${shareId}.png`)).statusCode, 404);
  assert.equal((await call("GET", `/api/public/highlights/${shareId}`)).status, 404);
  const after = await call("GET", `/api/me/highlights?battle=${battleId}`, {
    who: "owner",
  });
  assert.deepEqual(after.body.highlights, []);
  const again404 = await call("DELETE", `/api/me/highlights/${h.highlight_id}`, {
    who: "owner",
  });
  assert.equal(again404.status, 404);
});

test("a shared post's page escapes the name and the words in its tags", async () => {
  const made = await call("POST", "/api/me/highlights", {
    who: "owner",
    body: { battle: otherBattleId, words: HOSTILE_WORDS },
  });
  assert.equal(made.status, 201);
  const shared = await call("POST", "/api/me/highlights/share", {
    who: "owner",
    body: { highlight_id: made.body.highlight.highlight_id },
  });
  const url = shared.body.highlight.share_url;
  const shareId = url.split("/").at(-1);
  const page = await request("GET", `/h/${shareId}`);
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
    (await call("GET", "/api/public/highlights/aaaaaaaaaaaaaaa")).status,
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
  assert.match(item.facts.battle.url, /^https:\/\/elixir\.poapkings\.com\/battle\//);
  assert.match(item.facts.share_url, /^https:\/\/elixir\.poapkings\.com\/h\//);
  assert.ok(item.text.includes(HOSTILE_WORDS));

  // A friend who follows the player reads the post, never its owner's
  // share link (theirs to hand out).
  const theirs = await call("GET", "/api/me/timeline", { who: "friend" });
  assert.equal(theirs.status, 200);
  const seen = theirs.body.timeline.find((it) => it.kind === "battle_highlight");
  assert.ok(seen);
  assert.equal(seen.facts.words, HOSTILE_WORDS);
  assert.equal("share_url" in seen.facts, false);
});
