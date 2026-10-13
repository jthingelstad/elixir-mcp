/**
 * What opens with no sign-in (#526; DECISIONS "Accounts read the record;
 * one battle page is public"). The record opens at one page, a battle's;
 * status pages count the recorder and name no subject but the operator
 * credit; everything else needs an account. The audit's table is
 * docs/notes/2026-10-12-w1-public.md.
 *
 * This walks every route the web API registers with no credential. A
 * route that answers unsigned must be listed in PUBLIC with its class,
 * and a listed route must still exist, so a new public route is a
 * decision rather than an accident.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import { CLAN_UNSIGNED, makeHandler } from "../src/handler.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const adminUrl =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const name = `elixir_mcp_test_public_boundary_${process.pid}`;
const databaseUrl = adminUrl.replace(/\/postgres$/, `/${name}`);
let db, handler;

/** Every route that answers with no sign-in, and why. */
const PUBLIC = {
  // The record: one battle's page, its JSON and its picture.
  "GET /battle/*": "record",
  "GET /api/public/battles/*": "record",
  // Status: counts of what the recorder holds, no subject named but
  // the operator credit on /api/public/status.
  "GET /api/public/status": "status",
  "GET /api/public/stats": "status",
  "GET /api/public/efficiency": "status",
  // The game's card list: reference, no subject, no play statistic.
  "GET /api/public/cards": "status",
  "GET /api/public/cards/*": "status",
  // Plumbing: signing in and up, signing out, a mail's stop link.
  "GET /api/me": "plumbing",
  "POST /api/request-access": "plumbing",
  "POST /api/auth": "plumbing",
  "POST /api/auth/redeem": "plumbing",
  "POST /api/auth/poll": "plumbing",
  "POST /api/auth/code": "plumbing",
  "POST /api/session/signout": "plumbing",
  "GET /api/email/unsubscribe": "plumbing",
  "POST /api/email/unsubscribe": "plumbing",
};

const PRIMARY = "#9QJ2YLR0";
const ALT = "#8GRUV2Q0";

const call = async (method, p, { body } = {}) => {
  const res = await handler({
    rawPath: p,
    requestContext: { http: { method } },
    headers: {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res;
};
const parse = (res) => JSON.parse(res.body);

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
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.end();
});

test("every listed public route exists", () => {
  const keys = new Set(handler.routeKeys);
  for (const key of Object.keys(PUBLIC))
    assert.ok(keys.has(key), `${key} is listed public but not registered`);
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
  // The JSON API needs a bearer.
  assert.equal((await call("GET", "/api/v1/me/players")).statusCode, 401);
  // An agent's console needs its owner signed in.
  assert.equal(
    (await call("GET", "/api/agent/abcdefgh/timeline")).statusCode,
    401,
  );
  // Clan: its health and the retired callback are its only unsigned
  // answers, both in CLAN_UNSIGNED; a GET of auth/login with no session
  // is sent to sign in, and everything else resolves a person first.
  assert.deepEqual(Object.keys(CLAN_UNSIGNED).sort(), [
    "ANY /api/clan/auth/callback",
    "GET /api/clan/health",
  ]);
  assert.equal((await call("GET", "/api/clan/home")).statusCode, 401);
  assert.equal((await call("POST", "/api/clan/actions")).statusCode, 401);
  assert.equal((await call("POST", "/api/clan/health")).statusCode, 401);
  assert.equal((await call("POST", "/api/clan/auth/login")).statusCode, 401);
  assert.equal((await call("GET", "/api/clan/health")).statusCode, 200);
  for (const method of ["GET", "POST"])
    assert.equal(
      (await call(method, "/api/clan/auth/callback")).statusCode,
      410,
    );
  const login = await call("GET", "/api/clan/auth/login");
  assert.equal(login.statusCode, 303);
  assert.match(login.headers.location, /^\/console\/signin/);
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
