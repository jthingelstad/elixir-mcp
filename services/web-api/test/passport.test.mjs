/**
 * Passports (#1015, first slice) through the web API. Pinned here: both
 * reads are a signed-in person's only (signed out 401, any other kind of
 * account 403); the owner sees the public projection plus the profile
 * list and exact progress; anyone else sees the public projection alone,
 * which carries no email, Discord, place, time zone, account id, token,
 * limit, usage or unearned count, for a verified account, an unverified
 * claim and an account with no player; reading another person's
 * passport writes nothing, and reading never grants. Invented names and
 * tags; the fixture's tag.
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
import { passportRoutes } from "../src/routes/passport.mjs";
import { PASSPORT_LEAKS } from "./passport-privacy.mjs";
import {
  createScratch,
  dropScratch,
} from "../../../packages/ingest/test/helpers.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const adminUrl =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const name = `elixir_mcp_test_passport_${process.pid}`;
const databaseUrl = adminUrl.replace(/\/postgres$/, `/${name}`);

// The fixture's own player, and an invented one claimed but not verified.
const PLAYER = "#0QRVVG22J";
const CLAIMED = "#0PYLQ2";
const VERIFIED = "passport-verified@example.com";
const UNVERIFIED = "passport-unverified@example.com";
const NOPLAYER = "passport-noplayer@example.com";
const VIEWER = "passport-viewer@example.com";
const DISCORD_NAME = "invented_discord_name";
const NICKNAME = "Private Nickname";

const STAMP_TABLES = [
  "account_passport",
  "account_stamp_earned",
  "account_stamp_fact",
  "account_profile_list",
];

let db, handler;
const sent = [];
const cookies = {};
const ids = {};

const call = async (method, p, { who } = {}) => {
  const res = await handler({
    path: p,
    method,
    headers: {
      ...(who ? { cookie: cookies[who] } : {}),
      "cloudfront-viewer-address": "8.8.4.4:443",
      "x-elixir-client": "web",
    },
  });
  return { status: res.statusCode, body: JSON.parse(res.body) };
};

async function signIn(email) {
  await handler({
    path: "/api/auth",
    method: "POST",
    headers: { "cloudfront-viewer-address": "8.8.4.4:443" },
    body: JSON.stringify({ age_13: true, email }),
  });
  const { code } = sent.at(-1);
  const res = await handler({
    path: "/api/auth/code",
    method: "POST",
    headers: { "cloudfront-viewer-address": "8.8.4.4:443" },
    body: JSON.stringify({ email, code }),
  });
  assert.equal(res.statusCode, 200, res.body);
  return res.headers["set-cookie"].split(";")[0];
}

async function account(email, timezone) {
  const {
    rows: [a],
  } = await db.query(
    `insert into account (email_hash, status, role, timezone)
     values ($1, 'approved', 'member', $2) returning account_id`,
    [emailHash(email), timezone],
  );
  return a.account_id;
}

const sizes = async () => {
  const out = {};
  for (const t of STAMP_TABLES)
    out[t] = (await db.query(`select count(*)::int as n from ${t}`)).rows[0].n;
  return out;
};

function keysOf(value, out = new Set()) {
  if (Array.isArray(value)) for (const v of value) keysOf(v, out);
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keysOf(v, out);
    }
  return out;
}

/** The public projection's only keys, at any depth. */
const PUBLIC_KEYS = new Set([
  "passport",
  "id",
  "display_name",
  "player",
  "tag",
  "name",
  "verified",
  "avatar_card_id",
  "earned",
  "stamp_id",
  "level",
  "earned_on",
  "earned_before",
  "catalog_version",
]);

function assertPublic(body, accountId) {
  for (const k of keysOf(body)) assert.ok(PUBLIC_KEYS.has(k), `key ${k}`);
  const text = JSON.stringify(body);
  for (const leak of [...PASSPORT_LEAKS, accountId, DISCORD_NAME, NICKNAME])
    assert.ok(!text.includes(leak), `leaked ${leak}`);
}

before(async () => {
  await createScratch(name);
  db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  const {
    rows: [operator],
  } = await db.query(
    `insert into account (email_hash, status) values ('passport-op', 'approved')
     returning account_id`,
  );
  await db.query(`insert into player (player_tag) values ($1)`, [PLAYER]);
  await db.query(`insert into player (player_tag, name) values ($1, $2)`, [
    CLAIMED,
    "Invented Claimed",
  ]);
  await db.query(
    `insert into recording (subject_type, subject_tag, requested_by) values ('player', $1, $2)`,
    [PLAYER, operator.account_id],
  );
  const {
    rows: [gw],
  } = await db.query(
    `insert into gateway (owner_account_id, name, static_ip, status)
     values ($1, 'passport-gw', '127.0.0.1', 'active') returning gateway_id`,
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

  handler = makeHandler({
    databaseUrl,
    secret: "passport-secret",
    sendLoginEmail: async (m) => sent.push(m),
    notifyOwner: async () => {},
    sendWelcomeEmail: async () => {},
  });
  // Verified, with a picture, Discord, a nickname for the player and a
  // Central time zone: none of the private parts may reach the public.
  ids.verified = await account(VERIFIED, "America/Chicago");
  await db.query(
    `insert into claim (account_id, player_tag, is_primary, relationship, status, verified_at)
     values ($1, $2, true, 'primary', 'verified', now())`,
    [ids.verified, PLAYER],
  );
  await db.query(
    `update account set avatar_card_id = 26000000 where account_id = $1`,
    [ids.verified],
  );
  await db.query(
    `insert into account_discord (account_id, discord_user_id, username)
     values ($1, '100000000000000001', $2)`,
    [ids.verified, DISCORD_NAME],
  );
  await db.query(
    `insert into player_nickname (account_id, player_tag, nickname) values ($1, $2, $3)`,
    [ids.verified, PLAYER, NICKNAME],
  );
  // Claimed, never verified, with a picture chosen.
  ids.unverified = await account(UNVERIFIED, "America/Chicago");
  await db.query(
    `insert into claim (account_id, player_tag, is_primary, relationship, status)
     values ($1, $2, true, 'primary', 'unverified')`,
    [ids.unverified, CLAIMED],
  );
  await db.query(
    `update account set avatar_card_id = 26000000 where account_id = $1`,
    [ids.unverified],
  );
  ids.noplayer = await account(NOPLAYER, "America/Chicago");
  ids.viewer = await account(VIEWER, "UTC");
  for (const [who, email] of [
    ["verified", VERIFIED],
    ["unverified", UNVERIFIED],
    ["noplayer", NOPLAYER],
    ["viewer", VIEWER],
  ])
    cookies[who] = await signIn(email);
});

after(async () => {
  await db.end();
  await dropScratch(name);
});

test("the passport reads refuse the signed out and any account that is not a person", async () => {
  assert.equal((await call("GET", "/api/me/passport")).status, 401);
  assert.equal((await call("GET", "/api/passports/abcdefghjkmn")).status, 401);
  // An account that is not a person reaches neither route.
  const routes = passportRoutes({
    resolveAccount: async () => ({
      accountId: ids.verified,
      kind: "integration",
    }),
  });
  for (const [key, pathParam] of [
    ["GET /api/me/passport", undefined],
    ["GET /api/passports/*", "abcdefghjkmn"],
  ]) {
    const res = await routes[key](db, { pathParam });
    assert.equal(res.statusCode, 403, key);
    assert.equal(JSON.parse(res.body).error, "not_entitled");
  }
  // Each person's first sign-in made their passport (#1015, earning);
  // nothing else was written.
  assert.deepEqual(await sizes(), {
    account_passport: 4,
    account_stamp_earned: 0,
    account_stamp_fact: 0,
    account_profile_list: 0,
  });
});

test("the owner sees their passport, its steps and exact progress, and nothing is granted", async () => {
  const res = await call("GET", "/api/me/passport", { who: "verified" });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const { passport, owner, catalog_version } = res.body;
  assert.equal(catalog_version, 1);
  assert.match(passport.id, /^[a-km-np-z2-9]{12}$/);
  assert.equal(passport.display_name, "Invented Owner");
  assert.deepEqual(passport.player, {
    tag: PLAYER,
    name: "Invented Owner",
    verified: true,
    avatar_card_id: 26000000,
  });
  assert.deepEqual(passport.earned, []);
  assert.deepEqual(
    owner.profile.steps.map((s) => [s.id, s.state]),
    [
      ["add_player", "done"],
      ["verify_player", "done"],
      ["picture", "done"],
      ["follow_active", "todo"],
      ["digest", "todo"],
      ["map", "todo"],
    ],
  );
  assert.equal(owner.stamps.length, 11);
  const cheer = owner.stamps.find((s) => s.stamp_id === "cheerleader");
  assert.deepEqual(cheer.progress, {
    count: 0,
    next: 3,
    top: 50,
    unknown: false,
  });
  // Eligible for Player verified, Looking Good and Linked; granted none.
  const again = await call("GET", "/api/me/passport", { who: "verified" });
  assert.equal(again.body.passport.id, passport.id);
  assert.deepEqual(await sizes(), {
    account_passport: 4,
    account_stamp_earned: 0,
    account_stamp_fact: 0,
    account_profile_list: 0,
  });
  ids.verifiedPassport = passport.id;
});

test("the public passport carries the whitelist alone, for each kind of account", async () => {
  // Give the verified account an earned Stamp, a fact and profile choices.
  await db.query(
    `insert into account_stamp_earned
       (account_id, stamp_id, level, earned_at, earned_on, definition_version)
     values ($1, 'linked', 1, '2026-11-14T03:00:00Z', '2026-11-13', 1)`,
    [ids.verified],
  );
  await db.query(
    `insert into account_profile_list (account_id, digest_at, map_choice, map_at)
     values ($1, now(), 'not_now', now())`,
    [ids.verified],
  );
  const passports = {};
  for (const who of ["unverified", "noplayer"]) {
    const own = await call("GET", "/api/me/passport", { who });
    assert.equal(own.status, 200, JSON.stringify(own.body));
    passports[who] = own.body.passport.id;
  }
  passports.verified = ids.verifiedPassport;
  const before = await sizes();

  const verified = await call("GET", `/api/passports/${passports.verified}`, {
    who: "viewer",
  });
  assert.equal(verified.status, 200, JSON.stringify(verified.body));
  assert.deepEqual(verified.body, {
    passport: {
      id: passports.verified,
      display_name: "Invented Owner",
      player: {
        tag: PLAYER,
        name: "Invented Owner",
        verified: true,
        avatar_card_id: 26000000,
      },
      earned: [
        {
          stamp_id: "linked",
          level: 1,
          earned_on: "2026-11-13",
          earned_before: null,
        },
      ],
    },
    catalog_version: 1,
  });
  assertPublic(verified.body, ids.verified);

  const unverified = await call(
    "GET",
    `/api/passports/${passports.unverified}`,
    { who: "viewer" },
  );
  assert.equal(unverified.status, 200);
  assert.deepEqual(unverified.body.passport.player, {
    tag: CLAIMED,
    name: "Invented Claimed",
    verified: false,
    avatar_card_id: null,
  });
  assertPublic(unverified.body, ids.unverified);

  const noplayer = await call("GET", `/api/passports/${passports.noplayer}`, {
    who: "viewer",
  });
  assert.equal(noplayer.status, 200);
  assert.deepEqual(noplayer.body, {
    passport: {
      id: passports.noplayer,
      display_name: "New player",
      player: null,
      earned: [],
    },
    catalog_version: 1,
  });
  assertPublic(noplayer.body, ids.noplayer);

  // Reading three other people's passports wrote nothing. The viewer's
  // own passport is the one their sign-up made, never a read's.
  assert.deepEqual(await sizes(), before);
  assert.equal(
    (
      await db.query(`select 1 from account_passport where account_id = $1`, [
        ids.viewer,
      ])
    ).rowCount,
    1,
  );
});

test("unknown, malformed and account ids are not found", async () => {
  const before = await sizes();
  for (const id of [
    "abcdefghjkmn",
    "ABCDEFGHJKMN",
    "short",
    ids.verified,
    "%27%3B%20drop",
  ]) {
    const res = await call("GET", `/api/passports/${id}`, { who: "viewer" });
    assert.equal(res.status, 404, id);
    assert.deepEqual(res.body, { error: "not_found" });
  }
  assert.deepEqual(await sizes(), before);
});
