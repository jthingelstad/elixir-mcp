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
import { processResult } from "../../../packages/ingest/src/pipeline.mjs";
import { emailHash } from "../../../packages/auth/src/index.mjs";
import { AGENT_SCOPED_ROUTES, makeHandler } from "../src/handler.mjs";
import { CHEER_KEYS, CHEERS_PER_HOUR } from "../src/cheers.mjs";
import { feedItems, hashToken, xmlText } from "../src/feed-link.mjs";
import {
  buildTimeline,
  subjectsFor,
} from "../../../packages/tools/src/activity/entries.mjs";
import { readPostTimeline } from "../../../packages/tools/src/activity/posts.mjs";
import {
  createScratch,
  dropScratch,
} from "../../../packages/ingest/test/helpers.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const adminUrl =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const name = `elixir_mcp_test_cheers_rss_${process.pid}`;
const databaseUrl = adminUrl.replace(/\/postgres$/, `/${name}`);

// The fixture's own player (fixtures/player_battlelog).
const PLAYER = "#0QRVVG22J";
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
  await createScratch(name);
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
  // The owner posts about a battle: an item of the last seven days.
  const made = await call("POST", "/api/me/posts", {
    who: "owner",
    body: { battle: battle.battle_id, text: WORDS },
  });
  assert.equal(made.status, 201, JSON.stringify(made.body));
});

after(async () => {
  await db.end();
  await dropScratch(name);
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

test("the twenty cheers are the database's twenty, the first six unchanged", async () => {
  assert.deepEqual(CHEER_KEYS, [
    "well_played",
    "on_fire",
    "royal",
    "wow",
    "ha",
    "grind",
    "love_it",
    "good_game",
    "congrats",
    "clutch",
    "high_five",
    "champion",
    "nailed_it",
    "climbing",
    "big_brain",
    "ice_cold",
    "close_one",
    "lucky",
    "fun_to_watch",
    "getting_better",
  ]);
  const { rows } = await db.query(
    `select pg_get_constraintdef(oid) as def from pg_constraint
      where conrelid = 'timeline_cheer'::regclass and contype = 'c'
        and pg_get_constraintdef(oid) like '%cheer%'
        and pg_get_constraintdef(oid) not like '%item_id%'`,
  );
  assert.equal(rows.length, 1);
  for (const key of CHEER_KEYS) assert.ok(rows[0].def.includes(`'${key}'`));
});

test("every kind is stored and counted, and switching between them keeps one", async () => {
  const item = await highlightOf("friend");
  for (const key of CHEER_KEYS) {
    const r = await cheer("friend", item, key);
    assert.equal(r.status, 200, `${key}: ${JSON.stringify(r.body)}`);
    assert.deepEqual(r.body.cheers, { [key]: 1 });
    assert.equal(r.body.my_cheer, key);
  }
  const owners = await highlightOf("owner");
  assert.deepEqual(owners.cheers, { getting_better: 1 });
  assert.equal((await cheer("friend", item, null)).status, 200);
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
    /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<rss version="2\.0" xmlns:dc="http:\/\/purl\.org\/dc\/elements\/1\.1\/">/,
  );
  // The battle post, its player's game name and words escaped.
  assert.ok(xml.includes(xmlText(HOSTILE_NAME)));
  // Words live in the description, HTML inside XML: escaped twice.
  assert.ok(xml.includes(xmlText(xmlText(WORDS))));
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

test("the RSS feed reads Home's stored week: its own build's items, and a 304 for a reader that holds them", async () => {
  const made = await call("POST", "/api/me/rss", { who: "owner" });
  const token = made.body.url.split("/").at(-1);
  const {
    rows: [{ account_id: ownerId }],
  } = await db.query(
    `select account_id from timeline_feed_link where token_hash = $1`,
    [hashToken(token)],
  );
  const poll = (headers = {}) =>
    handler({
      path: `/api/rss/${token}`,
      method: "GET",
      headers: { "cloudfront-viewer-address": "8.8.4.4:443", ...headers },
    });
  const guids = (xml) =>
    [...xml.matchAll(/<guid isPermaLink="false">([^<]*)<\/guid>/g)]
      .map((m) => m[1])
      .sort();
  const stored = async () =>
    (
      await db.query(
        `select built_at, read_at from home_feed where account_id = $1`,
        [ownerId],
      )
    ).rows[0];

  // With no stored week the poll builds Home's and stores it; a poll is
  // not a read of Home.
  await db.query(`delete from home_feed where account_id = $1`, [ownerId]);
  const first = await poll();
  assert.equal(first.statusCode, 200);
  assert.match(first.headers.etag, /^W\/"[A-Za-z0-9_-]{27}"$/);
  const row = await stored();
  assert.ok(row, "the poll stored the week");
  assert.equal(row.read_at, null);

  // The items are the ones the feed's own build served before: seven
  // days, not interactive, no account lines, with the posts beside them.
  const subjects = await subjectsFor(db, ownerId);
  const toMs = Date.now();
  const window = { fromMs: toMs - 7 * 86_400_000, toMs, timezone: "UTC" };
  const built = await buildTimeline(db, subjects, {
    ...window,
    accountId: ownerId,
    accountLines: false,
    lateCounts: false,
  });
  const postPage = await readPostTimeline(db, ownerId, {
    subjects,
    ...window,
    basis: "observed",
    limit: 50,
  });
  const wanted = feedItems([...built.timeline, ...postPage.items])
    .map((it) => xmlText(it.id))
    .sort();
  assert.ok(wanted.length > 0, "the fixture has a week to serve");
  assert.deepEqual(guids(first.body), wanted);

  // The next poll reads the row: no build, the same items, the same tag.
  const second = await poll();
  assert.equal(second.statusCode, 200);
  assert.deepEqual((await stored()).built_at, row.built_at);
  assert.deepEqual(guids(second.body), wanted);
  assert.equal(second.headers.etag, first.headers.etag);

  // A reader that holds these items is told so, with no body; the tag it
  // sends may be one of several, and weak or strong.
  const strong = first.headers.etag.replace(/^W\//, "");
  for (const sent of [first.headers.etag, strong, `"other", ${strong}`]) {
    const held = await poll({ "if-none-match": sent });
    assert.equal(held.statusCode, 304, sent);
    assert.equal(held.body, "");
    assert.equal(held.headers.etag, first.headers.etag);
    assert.match(held.headers["cache-control"], /^private/);
  }
  // Another tag, or none, is the whole feed.
  assert.equal((await poll({ "if-none-match": '"other"' })).statusCode, 200);

  // A new item is a new tag: the old one no longer matches.
  await db.query(
    `update home_feed
        set items = items || jsonb_build_array(jsonb_build_object(
              'id', 'st_added_for_the_tag', 'revision', 1, 'kind', 'arena_changed',
              'section', 'moments', 'at', now(), 'observed_at', now(),
              'subject_tag', $2::text, 'text', 'A stored line',
              'subjects', jsonb_build_array(jsonb_build_object(
                'kind', 'player', 'tag', $2::text, 'name', 'Fixture'))))
      where account_id = $1`,
    [ownerId, PLAYER],
  );
  const changed = await poll({ "if-none-match": first.headers.etag });
  assert.equal(changed.statusCode, 200);
  assert.notEqual(changed.headers.etag, first.headers.etag);
  assert.ok(changed.body.includes("A stored line"));

  // A 304 is behind the token like the feed itself.
  await call("DELETE", "/api/me/rss", { who: "owner" });
  const gone = await poll({ "if-none-match": changed.headers.etag });
  assert.equal(gone.statusCode, 404);
  assert.equal("etag" in gone.headers, false);
  // The hour's reads here are not the next test's.
  await db.query(`delete from rate_limit where bucket = $1`, [
    `rss#${ownerId}`,
  ]);
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
