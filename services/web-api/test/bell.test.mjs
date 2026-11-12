/**
 * The bell (2026-11-12). Pinned here: reactions are other people's cheers on
 * your own verified players' items, as counts, never who; followers are named
 * only by their account's verified player and otherwise counted, with no
 * follow time; answers are your own feedback's; opening the bell moves the
 * account's seen marker, and what came before it is no longer new (an
 * unread answer stays new until it is read); a person's only, the contract
 * header required to move the marker, and no agent console reaches it.
 * Synthetic names; the fixture's tag.
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
import { BELL_READS_PER_HOUR } from "../src/bell.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const adminUrl =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const name = `elixir_mcp_test_bell_${process.pid}`;
const databaseUrl = adminUrl.replace(/\/postgres$/, `/${name}`);

// The fixture's own player (fixtures/player_battlelog), and an invented one
// the fan verified.
const PLAYER = "#JYRQ8U92C";
const FAN_PLAYER = "#2PP0V9PP";
const FAN_NAME = "Invented Fan";
const OWNER = "bell-owner@example.com";
const FRIEND = "bell-friend@example.com";
const FAN = "bell-fan@example.com";
const STRANGER = "bell-stranger@example.com";
const QUESTION = "Could the season page show the war week first?";

let db, handler;
const sent = [];
const cookies = {};
const ids = {};

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

async function account(email) {
  const {
    rows: [a],
  } = await db.query(
    `insert into account (email_hash, status, role, timezone)
     values ($1, 'approved', 'member', 'UTC') returning account_id`,
    [emailHash(email)],
  );
  return a.account_id;
}

const claim = (accountId, tag, kind) =>
  db.query(
    `insert into claim (account_id, player_tag, is_primary, relationship,
                        notify, status, verified_at)
     values ($1, $2, $3, $4, true, $5, $6)`,
    [
      accountId,
      tag,
      kind === "own",
      kind === "own" ? "primary" : "friend",
      kind === "own" ? "verified" : "unverified",
      kind === "own" ? new Date() : null,
    ],
  );

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
    `insert into account (email_hash, status) values ('bell-op', 'approved')
     returning account_id`,
  );
  await db.query(`insert into player (player_tag) values ($1)`, [PLAYER]);
  await db.query(`insert into player (player_tag, name) values ($1, $2)`, [
    FAN_PLAYER,
    FAN_NAME,
  ]);
  await db.query(
    `insert into recording (subject_type, subject_tag, requested_by) values ('player', $1, $2)`,
    [PLAYER, operator.account_id],
  );
  const {
    rows: [gw],
  } = await db.query(
    `insert into gateway (owner_account_id, name, static_ip, status)
     values ($1, 'bell-gw', '127.0.0.1', 'active') returning gateway_id`,
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
  await db.query(
    `update player set name = 'Invented Owner' where player_tag = $1`,
    [PLAYER],
  );
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
    secret: "bell-secret",
    sendLoginEmail: async (m) => sent.push(m),
    notifyOwner: async () => {},
    sendWelcomeEmail: async () => {},
  });
  ids.owner = await account(OWNER);
  await claim(ids.owner, PLAYER, "own");
  // A follower with no verified player: counted, never named.
  ids.friend = await account(FRIEND);
  await claim(ids.friend, PLAYER, "friend");
  // A follower who verified a player of their own: named by it.
  ids.fan = await account(FAN);
  await claim(ids.fan, FAN_PLAYER, "own");
  await claim(ids.fan, PLAYER, "friend");
  ids.stranger = await account(STRANGER);
  for (const who of ["owner", "friend", "fan", "stranger"])
    cookies[who] = await signIn(
      { owner: OWNER, friend: FRIEND, fan: FAN, stranger: STRANGER }[who],
    );
  const made = await call("POST", "/api/me/highlights", {
    who: "owner",
    body: { battle: battle.battle_id, words: "A close one" },
  });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  // An answered piece of the owner's feedback, not yet read.
  await db.query(
    `insert into feedback (account_id, surface, message, status, response, responded_at)
     values ($1, 'web', $2, 'planned', 'Yes, next week.', now())`,
    [ids.owner, QUESTION],
  );
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
const cheer = (who, item, value) =>
  call("PUT", "/api/me/cheers", {
    who,
    body: {
      item_id: item.id,
      cheer: value,
      subjects: (item.subjects ?? []).map((s) => s.tag),
    },
  });

test("the bell: reactions as counts, followers named only by a verified player, answers", async () => {
  const item = await highlightOf("friend");
  assert.ok(item);
  assert.equal((await cheer("friend", item, "royal")).status, 200);
  assert.equal((await cheer("fan", item, "wow")).status, 200);
  // The owner's own cheer on their own item is not a reaction to it.
  assert.equal((await cheer("owner", item, "royal")).status, 200);

  const bell = await call("GET", "/api/me/bell", { who: "owner" });
  assert.equal(bell.status, 200, JSON.stringify(bell.body));
  assert.equal(bell.body.seen_at, null);
  assert.equal(bell.body.reactions.items.length, 1);
  const r = bell.body.reactions.items[0];
  assert.equal(r.item_id, item.id);
  assert.deepEqual(r.cheers, { royal: 1, wow: 1 });
  assert.equal(r.total, 2);
  assert.equal(r.new, true);
  // Followers: the fan by their own verified player, the friend counted.
  assert.equal(bell.body.followers.count, 2);
  assert.equal(bell.body.followers.unnamed, 1);
  assert.deepEqual(bell.body.followers.players, [
    {
      tag: FAN_PLAYER,
      name: FAN_NAME,
      followed_tag: PLAYER,
      followed_name: "Invented Owner",
      new: true,
    },
  ]);
  assert.equal(bell.body.answers.items.length, 1);
  assert.equal(bell.body.answers.items[0].about, QUESTION);
  assert.equal(bell.body.answers.items[0].new, true);
  assert.equal(bell.body.new, 1 + 2 + 1);
  // Never who cheered or followed, beyond the verified player's name: no
  // email, account id or the friend at all.
  const raw = JSON.stringify(bell.body);
  for (const leak of [FRIEND, FAN, ids.friend, ids.fan, "bell-friend"])
    assert.equal(raw.includes(leak), false, leak);
});

test("opening the bell: what came before is seen; an unread answer stays new", async () => {
  const opened = await call("PUT", "/api/me/bell/seen", { who: "owner" });
  assert.equal(opened.status, 200, JSON.stringify(opened.body));
  assert.ok(opened.body.seen_at);
  const bell = await call("GET", "/api/me/bell", { who: "owner" });
  assert.equal(bell.body.reactions.items[0].new, false);
  assert.equal(bell.body.reactions.new, 0);
  assert.equal(bell.body.followers.new, 0);
  assert.equal(bell.body.followers.players[0].new, false);
  assert.equal(bell.body.answers.new, 1);
  assert.equal(bell.body.new, 1);
  // A cheer changed after the marker is new again.
  const item = await highlightOf("friend");
  assert.equal((await cheer("friend", item, "on_fire")).status, 200);
  const again = await call("GET", "/api/me/bell", { who: "owner" });
  assert.equal(again.body.reactions.new, 1);
  assert.deepEqual(again.body.reactions.items[0].cheers, {
    on_fire: 1,
    wow: 1,
  });
  // Reading the answer, where it always was, is what marks it read.
  await db.query(
    `update feedback set response_seen_at = now() where account_id = $1`,
    [ids.owner],
  );
  const read = await call("GET", "/api/me/bell", { who: "owner" });
  assert.equal(read.body.answers.new, 0);
  assert.equal(read.body.answers.items.length, 1);
});

test("an account with no verified player: no reactions or followers, its own answers only", async () => {
  const bell = await call("GET", "/api/me/bell", { who: "stranger" });
  assert.equal(bell.status, 200);
  assert.equal(bell.body.players, 0);
  assert.deepEqual(bell.body.reactions, { items: [], new: 0 });
  assert.equal(bell.body.followers.count, 0);
  assert.deepEqual(bell.body.answers, { items: [], new: 0 });
  assert.equal(bell.body.new, 0);
  // The friend follows the owner's player, but it is not theirs.
  const friend = await call("GET", "/api/me/bell", { who: "friend" });
  assert.deepEqual(friend.body.reactions, { items: [], new: 0 });
});

test("the bell's refusals: signed out, no contract header, agents, the hour's cap", async () => {
  assert.equal((await call("GET", "/api/me/bell")).status, 401);
  assert.equal((await call("PUT", "/api/me/bell/seen")).status, 401);
  assert.notEqual(
    (await call("PUT", "/api/me/bell/seen", { who: "fan", contract: false }))
      .status,
    200,
  );
  assert.equal(
    (await db.query(`select 1 from bell_seen where account_id = $1`, [ids.fan]))
      .rowCount,
    0,
  );
  for (const key of AGENT_SCOPED_ROUTES)
    assert.equal(/bell/.test(key), false, key);
  await db.query(
    `insert into rate_limit (bucket, window_start, count)
     values ($1, date_trunc('hour', now()), $2)
     on conflict (bucket, window_start) do update set count = excluded.count`,
    [`bell#${ids.fan}`, BELL_READS_PER_HOUR],
  );
  assert.equal((await call("GET", "/api/me/bell", { who: "fan" })).status, 429);
});
