/**
 * Cheers and the RSS link (social slice 7, #765). Pinned here: a cheer is
 * one of six, one per person per item, changed or taken back; it is
 * stored only on an item in the person's own feed; the contract header is
 * required and the hour is capped; every reader sees the counts and their
 * own, never who. The RSS link keeps only its token's hash, is shown once,
 * resets (the old link stops) and turns off; the feed is its owner's own
 * timeline with names escaped, no nickname and none of the account's own
 * administration. Synthetic names; the fixture's tag.
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
import { AGENT_SCOPED_ROUTES, makeHandler } from "../src/handler.mjs";
import { CHEER_KEYS, CHEERS_PER_HOUR } from "../src/cheers.mjs";
import { hashToken, xmlText } from "../src/feed-link.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const adminUrl =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const name = `elixir_mcp_test_cheers_rss_${process.pid}`;
const databaseUrl = adminUrl.replace(/\/postgres$/, `/${name}`);

// The fixture's own player (fixtures/player_battlelog).
const PLAYER = "#JYRQ8U92C";
const OWNER = "cheers-owner@example.com";
const FRIEND = "cheers-friend@example.com";
const STRANGER = "cheers-stranger@example.com";
const HOSTILE_NAME = '<b>Fixture</b> & "Co"';
const WORDS = "A comeback </title><x> & more";
const NICKNAME = "Private Nickname";

let db, handler;
const sent = [];
const cookies = {};
let friendId;

const request = (method, p, { body, who, contract = true } = {}) =>
  handler({
    path: p,
    method,
    headers: {
      ...(who ? { cookie: cookies[who] } : {}),
      "cloudfront-viewer-address": "8.8.4.4:443",
      ...(contract ? { "x-elixir-client": "web" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const call = async (method, p, opts) => {
  const res = await request(method, p, opts);
  return { status: res.statusCode, body: JSON.parse(res.body) };
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
    `insert into account (email_hash, status) values ('cheers-op', 'approved')
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
     values ($1, 'cheers-gw', '127.0.0.1', 'active') returning gateway_id`,
    [operator.account_id],
  );
  for (const [endpoint, entityKey, rel, fetchedAt] of [
    ["cards", "GLOBAL", "cards/catalog.json", "2026-09-03T13:00:00Z"],
    [
      "player_battlelog",
      PLAYER,
      "player_battlelog/with_colosseum_duel.json",
      "2026-09-03T14:30:34Z",
    ],
  ]) {
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
  }
  await db.query(`update player set name = $2 where player_tag = $1`, [
    PLAYER,
    HOSTILE_NAME,
  ]);
  const {
    rows: [battle],
  } = await db.query(
    `select bp.battle_id from battle_participant bp join battle b using (battle_id)
      where bp.player_tag = $1 and b.type = 'PvP'
      order by b.battle_time desc limit 1`,
    [PLAYER],
  );

  handler = makeHandler({
    databaseUrl,
    secret: "cheers-secret",
    sendLoginEmail: async (m) => sent.push(m),
    notifyOwner: async () => {},
    sendWelcomeEmail: async () => {},
  });
  await account(OWNER, "verified");
  friendId = await account(FRIEND, "unverified");
  await account(STRANGER, null);
  cookies.owner = await signIn(OWNER);
  cookies.friend = await signIn(FRIEND);
  cookies.stranger = await signIn(STRANGER);
  // The friend's private name for the player: never in a feed's text.
  await db.query(
    `insert into player_nickname (account_id, player_tag, nickname)
     values ($1, $2, $3)`,
    [friendId, PLAYER, NICKNAME],
  );
  // The owner posts a highlight: an item of the last seven days.
  const made = await call("POST", "/api/me/highlights", {
    who: "owner",
    body: { battle: battle.battle_id, words: WORDS },
  });
  assert.equal(made.status, 201, JSON.stringify(made.body));
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.end();
});

const highlightOf = async (who) => {
  const read = await call("GET", "/api/me/timeline", { who });
  assert.equal(read.status, 200, JSON.stringify(read.body));
  return read.body.timeline.find((it) => it.kind === "battle_highlight");
};
const cheer = (who, item, value, opts = {}) =>
  call("PUT", "/api/me/cheers", {
    who,
    body: {
      item_id: item.id,
      cheer: value,
      subjects: (item.subjects ?? []).map((s) => s.tag),
    },
    ...opts,
  });

test("the six cheers are the database's six", async () => {
  assert.deepEqual(CHEER_KEYS, [
    "well_played",
    "on_fire",
    "royal",
    "wow",
    "ha",
    "grind",
  ]);
  const { rows } = await db.query(
    `select pg_get_constraintdef(oid) as def from pg_constraint
      where conrelid = 'timeline_cheer'::regclass and contype = 'c'
        and pg_get_constraintdef(oid) like '%cheer%'
        and pg_get_constraintdef(oid) not like '%item_id%'`,
  );
  for (const key of CHEER_KEYS) assert.ok(rows[0].def.includes(`'${key}'`));
});

test("a cheer: one per person per item, changed or taken back, counts only", async () => {
  const item = await highlightOf("friend");
  assert.ok(item);
  assert.deepEqual(item.cheers, {});
  assert.equal(item.my_cheer, null);

  const given = await cheer("friend", item, "royal");
  assert.equal(given.status, 200, JSON.stringify(given.body));
  assert.deepEqual(given.body, {
    item_id: item.id,
    cheers: { royal: 1 },
    my_cheer: "royal",
  });
  // The owner reads the same item: the count, not who, and none of theirs.
  const owners = await highlightOf("owner");
  assert.equal(owners.id, item.id);
  assert.deepEqual(owners.cheers, { royal: 1 });
  assert.equal(owners.my_cheer, null);
  assert.equal(JSON.stringify(owners).includes(FRIEND), false);
  // The owner cheers it too; then the friend changes theirs.
  assert.equal((await cheer("owner", owners, "royal")).status, 200);
  const changed = await cheer("friend", item, "wow");
  assert.deepEqual(changed.body.cheers, { royal: 1, wow: 1 });
  assert.equal(changed.body.my_cheer, "wow");
  const { rows } = await db.query(
    `select count(*)::int as n from timeline_cheer where account_id = $1`,
    [friendId],
  );
  assert.equal(rows[0].n, 1);
  // Taken back.
  const back = await cheer("friend", item, null);
  assert.deepEqual(back.body, {
    item_id: item.id,
    cheers: { royal: 1 },
    my_cheer: null,
  });
});

test("a cheer is stored only on an item in your own feed", async () => {
  const item = await highlightOf("friend");
  // Following nobody, the stranger cannot cheer it, whatever they name.
  const stranger = await cheer("stranger", item, "ha");
  assert.equal(stranger.status, 404);
  // An id of the right shape that is no item of the feed.
  const made = await cheer(
    "friend",
    { ...item, id: "tl_0123456789abcdef0123" },
    "ha",
  );
  assert.equal(made.status, 404);
  // Taking back a cheer you never gave answers the counts and stores nothing.
  const none = await cheer("stranger", item, null);
  assert.equal(none.status, 200);
  assert.equal(none.body.my_cheer, null);
});

test("a cheer's refusals: signed out, no contract header, a bad cheer or id, the hour's cap", async () => {
  const item = await highlightOf("friend");
  assert.equal((await cheer(undefined, item, "ha")).status, 401);
  assert.notEqual(
    (await cheer("friend", item, "ha", { contract: false })).status,
    200,
  );
  const bad = await cheer("friend", item, "thumbs_down");
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, "invalid_cheer");
  const badId = await cheer("friend", { ...item, id: "not-an-item" }, "ha");
  assert.equal(badId.status, 400);
  assert.equal(badId.body.error, "invalid_item");
  // No agent's console reaches the cheers or the RSS link.
  for (const key of AGENT_SCOPED_ROUTES)
    assert.equal(/cheers|\/rss/.test(key), false, key);
  // The hour's cap.
  await db.query(
    `insert into rate_limit (bucket, window_start, count)
     values ($1, date_trunc('hour', now()), $2)
     on conflict (bucket, window_start) do update set count = excluded.count`,
    [`cheer#${friendId}`, CHEERS_PER_HOUR],
  );
  const capped = await cheer("friend", item, "ha");
  assert.equal(capped.status, 429);
  await db.query(`delete from rate_limit where bucket = $1`, [
    `cheer#${friendId}`,
  ]);
});

test("the RSS link: shown once, kept as a hash, reset and turned off", async () => {
  assert.deepEqual((await call("GET", "/api/me/rss", { who: "friend" })).body, {
    on: false,
    created_at: null,
  });
  assert.notEqual(
    (await call("POST", "/api/me/rss", { who: "friend", contract: false }))
      .status,
    200,
  );
  const made = await call("POST", "/api/me/rss", { who: "friend" });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  assert.match(
    made.body.url,
    /^https:\/\/elixir\.poapkings\.com\/api\/rss\/[A-Za-z0-9_-]{32}$/,
  );
  const token = made.body.url.split("/").at(-1);
  // Only the hash is kept, and a read never shows the link again.
  const { rows } = await db.query(
    `select token_hash from timeline_feed_link where account_id = $1`,
    [friendId],
  );
  assert.equal(rows[0].token_hash, hashToken(token));
  assert.equal(JSON.stringify(rows).includes(token), false);
  const state = (await call("GET", "/api/me/rss", { who: "friend" })).body;
  assert.equal(state.on, true);
  assert.equal("url" in state, false);

  const feed = await request("GET", `/api/rss/${token}`);
  assert.equal(feed.statusCode, 200);
  assert.match(feed.headers["content-type"], /^application\/rss\+xml/);
  assert.match(feed.headers["cache-control"], /^private/);
  const xml = feed.body;
  assert.match(
    xml,
    /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<rss version="2\.0">/,
  );
  // The highlight, its player's game name and words escaped.
  assert.ok(xml.includes(xmlText(HOSTILE_NAME)));
  assert.ok(xml.includes(xmlText(WORDS)));
  assert.equal(xml.includes("<b>Fixture"), false);
  assert.equal(xml.includes("</title><x>"), false);
  // Never a nickname, an email, or the account's own administration.
  assert.equal(xml.includes(NICKNAME), false);
  assert.equal(xml.includes("@example.com"), false);
  assert.equal(xml.includes("your account"), false);
  assert.match(xml, /not endorsed by Supercell/);

  // Reset: the old link stops at once, the new one opens.
  const reset = await call("POST", "/api/me/rss", { who: "friend" });
  const fresh = reset.body.url.split("/").at(-1);
  assert.notEqual(fresh, token);
  assert.equal((await request("GET", `/api/rss/${token}`)).statusCode, 404);
  assert.equal((await request("GET", `/api/rss/${fresh}`)).statusCode, 200);
  // Off: the link is gone.
  const off = await call("DELETE", "/api/me/rss", { who: "friend" });
  assert.deepEqual(off.body, { on: false, created_at: null });
  assert.equal((await request("GET", `/api/rss/${fresh}`)).statusCode, 404);
  // A token of the wrong shape is never looked up.
  assert.equal((await request("GET", "/api/rss/short")).statusCode, 404);
});

test("the RSS feed's hour is capped per link", async () => {
  const made = await call("POST", "/api/me/rss", { who: "owner" });
  const token = made.body.url.split("/").at(-1);
  const { rows } = await db.query(
    `select account_id from timeline_feed_link where token_hash = $1`,
    [hashToken(token)],
  );
  await db.query(
    `insert into rate_limit (bucket, window_start, count)
     values ($1, date_trunc('hour', now()), 60)`,
    [`rss#${rows[0].account_id}`],
  );
  assert.equal((await request("GET", `/api/rss/${token}`)).statusCode, 429);
});
