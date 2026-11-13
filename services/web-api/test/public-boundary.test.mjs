/**
 * What opens with no sign-in (#759; DECISIONS "Everyone signs in; shared
 * posts stay public", which replaced "Accounts read the record; one
 * battle page is public" of #526). Every read of the record needs an
 * account. Open without one: a battle link someone sends (its page, its
 * JSON and its picture), a post its owner shares (slice 4, #762: its
 * page, JSON and picture, highlight.test.mjs), status pages that count the recorder, the game's card
 * list, and signing in. The site and docs are the site bucket's, never
 * this router's; the collector door, MCP and /api/v1 each refuse a
 * missing credential in their own tests (sign-in-api.test.mjs: GET
 * /api/v1/me answers 401).
 * The audits' tables: docs/notes/2026-10-12-w1-public.md and
 * docs/notes/2026-11-11-sign-in-gate-measured.md.
 *
 * This walks every route the web API registers with no credential. A
 * route that answers unsigned must be listed in PUBLIC with its class,
 * and a listed route must still exist, so a new public route is a
 * decision rather than an accident.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { CLAN_UNSIGNED, makeHandler } from "../src/handler.mjs";
import {
  createScratch,
  dropScratch,
} from "../../../packages/ingest/test/helpers.mjs";

const adminUrl =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const name = `elixir_mcp_test_public_boundary_${process.pid}`;
const databaseUrl = adminUrl.replace(/\/postgres$/, `/${name}`);
let db, handler;

/** Every route that answers with no sign-in, and why. The classes are
 *  closed (CLASSES); "record" is the record itself and stays the
 *  shortest list of all. */
const PUBLIC = {
  // The record: a battle link someone sends. Its page, its JSON (the
  // page reads it, so it opens with it) and its share picture
  // (DECISIONS "A battle has its own page").
  "GET /battle/*": "record",
  "GET /api/public/battles/*": "record",
  // The record: a post its owner shares, with its preview (slice 4,
  // #762): its page (and picture, /h/<id>.png) and its JSON. The owner's
  // game name, words and the battle; never an account, nickname or
  // sender (highlight.test.mjs pins the shape).
  "GET /h/*": "record",
  "GET /api/public/highlights/*": "record",
  // Status: counts of what the recorder holds, no subject named but
  // the operator credit on /api/public/status. /data and its live
  // figures read these; the site build bakes /api/public/stats.
  "GET /api/public/status": "status",
  "GET /api/public/stats": "status",
  // The game's card list: reference, no subject, no play statistic.
  // The site build bakes /cards from it and poapkings.com's roster
  // import reads it with no key.
  "GET /api/public/cards": "reference",
  "GET /api/public/cards/*": "reference",
  // A private link: your timeline's RSS feed (#765, DECISIONS "Your
  // timeline is an RSS feed"). A feed reader cannot sign in, so the
  // link's token is the credential; a token that opens nothing is a 404
  // (cheers-rss.test.mjs pins it, and that the feed is its owner's own).
  "GET /api/rss/*": "private link",
  // Plumbing: signing in and up, signing out, a mail's stop link.
  "GET /api/me": "plumbing",
  "POST /api/auth": "plumbing",
  "POST /api/auth/redeem": "plumbing",
  "POST /api/auth/poll": "plumbing",
  "POST /api/auth/code": "plumbing",
  // Discord's sign-in (#531): both are browser navigations that end in a
  // redirect; linking needs the session, checked inside.
  "GET /api/auth/discord/start": "plumbing",
  "GET /api/auth/discord/callback": "plumbing",
  "POST /api/session/signout": "plumbing",
  "GET /api/email/unsubscribe": "plumbing",
  "POST /api/email/unsubscribe": "plumbing",
  // Clan's liveness check (CLAN_UNSIGNED): it reads nothing.
  "GET /api/clan/health": "plumbing",
};

const CLASSES = new Set([
  "record",
  "status",
  "reference",
  "private link",
  "plumbing",
]);

/** The record that opens with no account, exactly: a battle link and a
 *  shared post (slice 4, #762). Growing this is a product decision. */
const RECORD = [
  "GET /api/public/battles/*",
  "GET /api/public/highlights/*",
  "GET /battle/*",
  "GET /h/*",
];

const PRIMARY = "#0RYQQRGY";
const ALT = "#0LYL9009";

const call = async (method, p, { body } = {}) => {
  const res = await handler({
    path: p,
    method,
    headers: {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res;
};
const parse = (res) => JSON.parse(res.body);

before(async () => {
  await createScratch(name);
  db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  const {
    rows: [acct],
  } = await db.query(
    `insert into account (email_hash, status) values ('public-boundary', 'approved')
     returning account_id`,
  );
  for (const [tag, playerName] of [
    [PRIMARY, "Primary Operator"],
    [ALT, "Alt Player"],
  ])
    await db.query(`insert into player (player_tag, name) values ($1, $2)`, [
      tag,
      playerName,
    ]);
  for (const [tag, primary] of [
    [PRIMARY, true],
    [ALT, false],
  ])
    await db.query(
      `insert into claim (account_id, player_tag, status, is_primary, relationship)
       values ($1, $2, 'unverified', $3, $4)`,
      [acct.account_id, tag, primary, primary ? "primary" : "alt"],
    );
  await db.query(
    `insert into gateway (owner_account_id, name, static_ip, status, card_name)
     values ($1, 'boundary-kitchen-box', '127.0.0.1', 'active', 'Knight')`,
    [acct.account_id],
  );
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class)
     values ('public-boundary-battle', '2026-10-01T12:00:00Z', 'PvP', 'pvp')`,
  );
  // A stand-in for Clan, so its door's unsigned answers are exercised.
  handler = makeHandler({
    databaseUrl,
    secret: "test",
    clan: async () => ({ statusCode: 200, headers: {}, body: "{}" }),
  });
});

after(async () => {
  await db.end();
  await dropScratch(name);
});

test("every listed public route exists", () => {
  const keys = new Set(handler.routeKeys);
  for (const key of Object.keys(PUBLIC))
    assert.ok(keys.has(key), `${key} is listed public but not registered`);
});

test("the public list is classed, and its record is a battle link or a shared post", () => {
  for (const [key, cls] of Object.entries(PUBLIC))
    assert.ok(CLASSES.has(cls), `${key} has an unknown class ${cls}`);
  assert.deepEqual(
    Object.keys(PUBLIC)
      .filter((key) => PUBLIC[key] === "record")
      .sort(),
    RECORD,
  );
});

test("signed out, /api/me says so and carries nothing of the record", async () => {
  const res = await call("GET", "/api/me");
  assert.equal(res.statusCode, 200);
  const body = parse(res);
  assert.equal(body.authenticated, false);
  assert.deepEqual(Object.keys(body).sort(), ["authenticated", "features"]);
});

test("every other route refuses a request with no credential", async () => {
  const opened = [];
  for (const key of handler.routeKeys) {
    if (key in PUBLIC) continue;
    const [method, route] = key.split(" ");
    const p = route.endsWith("/*") ? `${route.slice(0, -1)}x` : route;
    const res = await call(method, p, {
      body: method === "GET" ? undefined : {},
    });
    if (![401, 403].includes(res.statusCode))
      opened.push(`${key} answered ${res.statusCode}`);
  }
  assert.deepEqual(opened, [], "routes answering with no sign-in");
});

test("the doors by prefix refuse with no credential", async () => {
  // The JSON API needs a bearer for its one operation; a path it has
  // none for is a 404 to the docs (sign-in-api.test.mjs).
  assert.equal((await call("GET", "/api/v1/me")).statusCode, 401);
  assert.equal((await call("POST", "/api/v1/me/players")).statusCode, 404);
  assert.equal((await call("GET", "/api/v1/me/players")).statusCode, 404);
  // An agent's console needs its owner signed in.
  assert.equal(
    (await call("GET", "/api/agent/abcdefgh/timeline")).statusCode,
    401,
  );
  // Clan: its health is its only unsigned answer (CLAN_UNSIGNED), and
  // everything else resolves a person first. Its retired OAuth routes are
  // gone, so they are ordinary signed-out paths.
  assert.deepEqual(Object.keys(CLAN_UNSIGNED).sort(), ["GET /api/clan/health"]);
  assert.equal((await call("GET", "/api/clan/home")).statusCode, 401);
  // The clan directory is for signed-in members only (#768).
  assert.equal((await call("GET", "/api/clan/directory")).statusCode, 401);
  assert.equal((await call("POST", "/api/clan/actions")).statusCode, 401);
  assert.equal((await call("POST", "/api/clan/health")).statusCode, 401);
  assert.equal((await call("POST", "/api/clan/auth/login")).statusCode, 401);
  assert.equal((await call("GET", "/api/clan/health")).statusCode, 200);
  for (const method of ["GET", "POST"])
    assert.equal(
      (await call(method, "/api/clan/auth/callback")).statusCode,
      401,
    );
  assert.equal((await call("GET", "/api/clan/auth/login")).statusCode, 401);
});

test("public stats carry only counts of what the recorder holds", async () => {
  const res = await call("GET", "/api/public/stats");
  assert.equal(res.statusCode, 200);
  const body = parse(res);
  assert.deepEqual(Object.keys(body).sort(), [
    "as_of",
    "note",
    "series",
    "totals",
  ]);
  assert.deepEqual(Object.keys(body.totals).sort(), [
    "battles",
    "clans",
    "clans_recording",
    "collectors_active",
    "newest_battle",
    "oldest_battle",
    "players",
    "players_recording",
    "snapshots",
    "war_weeks",
  ]);
  assert.deepEqual(Object.keys(body.series).sort(), [
    "battles_daily",
    "fetches_daily",
    "players_observed_daily",
  ]);
  assert.deepEqual(Object.keys(body.series.battles_daily[0]).sort(), [
    "battles",
    "day",
  ]);
  assert.deepEqual(Object.keys(body.series.players_observed_daily[0]).sort(), [
    "day",
    "players",
  ]);
  const blob = JSON.stringify(body);
  for (const subject of [PRIMARY, ALT, "Primary Operator", "Alt Player"])
    assert.ok(!blob.includes(subject), `stats name no subject (${subject})`);
});

test("public status names one subject: the operator's primary player", async () => {
  const res = await call("GET", "/api/public/status");
  assert.equal(res.statusCode, 200);
  const body = parse(res);
  const [collector] = body.collectors;
  assert.equal(collector.name, "Knight");
  assert.equal(collector.operator, "Primary Operator");
  assert.equal(collector.operator_tag, PRIMARY);
  assert.deepEqual(Object.keys(collector).sort(), [
    "card_icon",
    "channel",
    "edge_filtered_24h",
    "fetches_1h",
    "last_heartbeat_at",
    "last_success_at",
    "name",
    "operator",
    "operator_tag",
    "signature",
    "status",
    "version",
    "yield_24h",
  ]);
  const blob = JSON.stringify(body);
  assert.ok(!blob.includes(ALT), "never another claimed player's tag");
  assert.ok(!blob.includes("Alt Player"), "never another claimed player");
  assert.ok(!blob.includes("boundary-kitchen-box"), "no machine label");
});
