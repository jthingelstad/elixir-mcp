/**
 * Agents and integrations (0053).
 *
 * These are entitlement tests, which means a wrong answer here is a security
 * bug rather than a bad feature: an agent that can claim a player, or an
 * integration a member can mint, or a token revoke that reaches across
 * accounts. Every one of those is cheap to get wrong and invisible until
 * somebody exploits it.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import { emailHash } from "../../auth/src/index.mjs";
import { makeHandler } from "../src/handler.mjs";
import { addPlayer } from "@elixir-mcp/claims";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_principals_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);
const SECRET = "principal-secret";

const BOSS = "boss@example.com"; // admin
const LEADER = "leader@example.com"; // member tier, one clan
const PARTNER = "partner@example.com";

let db;
let handler;
const sentEmails = [];
// One sign-in per identity, shared across tests. The per-email send limit is
// 5/hour and it is a product value the suite respects rather than works round.
let bossCookie;
let leaderCookie;
let partnerCookie;

function event({ method = "POST", path: p, body, cookie, ip = "8.8.4.4" }) {
  return {
    rawPath: p,
    requestContext: { http: { method, sourceIp: ip } },
    headers: {
      ...(cookie ? { cookie } : {}),
      "x-elixir-client": "web",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}
const parse = (res) => JSON.parse(res.body);

async function seed(email, role, { clans = [] } = {}) {
  const { rows } = await db.query(
    `insert into account (email_hash, status, role) values ($1, 'approved', $2)
     returning account_id`,
    [emailHash(email), role],
  );
  const accountId = rows[0].account_id;
  for (const tag of clans) {
    await db.query(
      `insert into account_clan (account_id, clan_tag, scope) values ($1, $2, 'comprehensive')`,
      [accountId, tag],
    );
  }
  return accountId;
}

async function signIn(email, ip) {
  await handler(event({ path: "/api/auth", body: { email }, ip }));
  const { code } = sentEmails.at(-1);
  const res = await handler(
    event({ path: "/api/auth/code", body: { email, code }, ip }),
  );
  assert.equal(res.statusCode, 200, res.body);
  return res.headers["set-cookie"].split(";")[0];
}

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.query(`create database ${NAME}`);
  await admin.end();
  await migrate({
    databaseUrl: DB_URL,
    migrationsDir: path.join(repoRoot, "db/migrations"),
  });
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  await db.query(
    `insert into player (player_tag, name) values ('#20JJJ2CCRU', 'King Thing')`,
  );
  handler = makeHandler({
    databaseUrl: DB_URL,
    secret: SECRET,
    sendLoginEmail: async (m) => sentEmails.push(m),
    notifyOwner: async () => {},
    sendWelcomeEmail: async () => {},
  });

  await seed(BOSS, "admin", { clans: ["#J2RGCRVG"] });
  await seed(LEADER, "member", { clans: ["#2GUCVLQR"] });
  await seed(PARTNER, "partner");
  bossCookie = await signIn(BOSS, "8.8.4.4");
  leaderCookie = await signIn(LEADER, "8.8.4.7");
  partnerCookie = await signIn(PARTNER, "8.8.5.1");
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

test("an agent is created for a clan you already added, and its key is shown once", async () => {
  const cookie = bossCookie;

  const res = await handler(
    event({
      path: "/api/me/agents",
      cookie,
      body: { name: "poap-kings", clan_tag: "#J2RGCRVG" },
    }),
  );
  assert.equal(res.statusCode, 201, res.body);
  const out = parse(res);
  assert.match(out.token, /^svt_/);
  assert.match(out.agent.public_id, /^[a-z0-9]{8,16}$/);

  // The clan came along, and it is the agent's primary subject — an agent
  // whose "me" is unset is the state this whole model exists to prevent.
  const { rows } = await db.query(
    `select clan_tag, is_primary from account_clan where account_id = $1`,
    [out.agent.account_id],
  );
  assert.deepEqual(rows, [{ clan_tag: "#J2RGCRVG", is_primary: true }]);

  // And nothing about the token is recoverable afterwards.
  const listed = parse(
    await handler(event({ method: "GET", path: "/api/me/principals", cookie })),
  );
  assert.equal(listed.agents.length, 1);
  assert.ok(!JSON.stringify(listed).includes(out.token));
});

test("an admin's agent is not an admin", async () => {
  // Jamie, 2026-09-08: "I'm an admin but my agent for poap kings is not."
  const cookie = bossCookie;
  const listed = parse(
    await handler(event({ method: "GET", path: "/api/me/principals", cookie })),
  );
  assert.equal(listed.agents[0].role, "leader");
});

test("you cannot create an agent for a clan you have not added", async () => {
  const cookie = bossCookie;
  const res = await handler(
    event({
      path: "/api/me/agents",
      cookie,
      body: { name: "someone-else", clan_tag: "#2GUCVLQR" },
    }),
  );
  assert.equal(res.statusCode, 400);
  assert.equal(parse(res).error, "clan_not_added");
});

test("a member can have an agent — this is not a tier feature", async () => {
  const cookie = leaderCookie;
  const res = await handler(
    event({
      path: "/api/me/agents",
      cookie,
      body: { name: "my-clan", clan_tag: "#2GUCVLQR" },
    }),
  );
  assert.equal(res.statusCode, 201, res.body);
  // Its own tier, not borrowed: a member's agent is a member.
  assert.equal(parse(res).agent.role, "member");
});

test("two owners may use the same token name — uniqueness is per account", async () => {
  const cookie = leaderCookie;
  const res = await handler(
    event({
      path: "/api/me/agents",
      cookie,
      body: { name: "poap-kings", clan_tag: "#2GUCVLQR" },
    }),
  );
  // BOSS already has a token named poap-kings. Before 0053 this collided
  // globally, so the first person to pick a name took it from everyone.
  assert.equal(res.statusCode, 201, res.body);
});

test("an agent cannot claim a player: it has no self to be", async () => {
  const { rows } = await db.query(
    `select account_id, role, kind from account where kind = 'agent' limit 1`,
  );
  const agent = rows[0];
  const result = await addPlayer(
    db,
    { accountId: agent.account_id },
    { tag: "#20JJJ2CCRU", makePrimary: true, via: "test" },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error, "not_entitled");
  assert.equal(result.kind, "agent");
});

test("integrations are partner+, unlike agents", async () => {
  const cookie = leaderCookie;
  const res = await handler(
    event({ path: "/api/me/integrations", cookie, body: { name: "my-app" } }),
  );
  assert.equal(res.statusCode, 403);
  assert.equal(parse(res).error, "not_entitled");
});

test("a partner gets exactly the integrations the ladder promises", async () => {
  const cookie = partnerCookie;
  const first = await handler(
    event({ path: "/api/me/integrations", cookie, body: { name: "drop" } }),
  );
  assert.equal(first.statusCode, 201, first.body);
  assert.equal(parse(first).integration.role, "partner");

  const second = await handler(
    event({ path: "/api/me/integrations", cookie, body: { name: "drop-two" } }),
  );
  assert.equal(second.statusCode, 400);
  assert.equal(parse(second).error, "quota_exceeded");
  assert.equal(parse(second).limit, 1);
});

test("a key is minted with exactly the authority it was asked for", async () => {
  const cookie = leaderCookie;
  const res = await handler(
    event({
      path: "/api/me/agents",
      cookie,
      body: { name: "read-only", clan_tag: "#2GUCVLQR", scope: "cr:read" },
    }),
  );
  assert.equal(res.statusCode, 201, res.body);

  const { rows } = await db.query(
    `select scope from service_token where name = 'read-only'`,
  );
  assert.equal(rows[0].scope, "cr:read");

  // And the pre-0053 shape still means "everything", because narrowing keys
  // that already exist would revoke authority nobody agreed to give up.
  const { rows: legacy } = await db.query(
    `select scope from service_token where name = 'poap-kings' limit 1`,
  );
  assert.equal(legacy[0].scope, null);
});

test("revoking someone else's token finds nothing rather than refusing", async () => {
  const { rows } = await db.query(
    `select t.token_id from service_token t
     join account a on a.account_id = t.account_id
     join account o on o.account_id = a.owned_by_account_id
     where o.email_hash = $1 limit 1`,
    [emailHash(BOSS)],
  );
  const bossToken = rows[0].token_id;

  const cookie = leaderCookie;
  const res = await handler(
    event({
      path: "/api/me/principals/revoke",
      cookie,
      body: { token_id: bossToken },
    }),
  );
  // 404, not 403: a refusal that distinguishes "not yours" from "not real"
  // is a probe for other people's token ids.
  assert.equal(res.statusCode, 404);

  const { rows: still } = await db.query(
    `select revoked_at from service_token where token_id = $1`,
    [bossToken],
  );
  assert.equal(still[0].revoked_at, null, "and it is still live");
});

test("revoking your own token works", async () => {
  const cookie = leaderCookie;
  const listed = parse(
    await handler(event({ method: "GET", path: "/api/me/principals", cookie })),
  );
  const tokenId = listed.agents[0].tokens[0].token_id;
  const res = await handler(
    event({
      path: "/api/me/principals/revoke",
      cookie,
      body: { token_id: tokenId },
    }),
  );
  assert.equal(res.statusCode, 200, res.body);
  const { rows } = await db.query(
    `select revoked_at from service_token where token_id = $1`,
    [tokenId],
  );
  assert.ok(rows[0].revoked_at);
});

/* ── The agent lifecycle beyond create-and-revoke ────────────────────────
 *
 * Creating an agent used to be a one-way door. Revoking was a trap rather
 * than a gap: with no way to issue a replacement key, the only path back was
 * delete-and-recreate, which discards the account_id, the public_id in the
 * agent's own MCP URL, and the events_seen_through cursor.
 *
 * These are entitlement tests too. Every route below takes an account_id from
 * the caller, so "does ownership ride in the WHERE clause" is the question
 * that matters most.
 */

/** The shared event() helper predates query-string routes. */
const q = (p, params, cookie) => ({
  rawPath: p,
  requestContext: { http: { method: "GET", sourceIp: "8.8.4.4" } },
  headers: { ...(cookie ? { cookie } : {}), "x-elixir-client": "web" },
  queryStringParameters: params,
});

async function bossAgentId() {
  const listed = parse(
    await handler(
      event({ method: "GET", path: "/api/me/principals", cookie: bossCookie }),
    ),
  );
  return listed.agents[0].account_id;
}

test("rotating a key keeps the principal and replaces the credential", async () => {
  const id = await bossAgentId();
  const before = await db.query(
    `select public_id, events_seen_through from account where account_id = $1`,
    [id],
  );
  const res = await handler(
    event({
      path: "/api/me/principals/rotate",
      cookie: bossCookie,
      body: { account_id: id },
    }),
  );
  assert.equal(res.statusCode, 200, res.body);
  const { token } = parse(res);
  assert.ok(token, "a new key comes back exactly once");

  // The identity survives -- this is the whole point of rotating rather than
  // recreating. A new account_id would change the agent's MCP URL and reset
  // its notification cursor.
  const after = await db.query(
    `select public_id, events_seen_through from account where account_id = $1`,
    [id],
  );
  assert.deepEqual(after.rows[0], before.rows[0]);

  // Exactly one live key, and it is not the old one.
  const { rows: keys } = await db.query(
    `select token_hash, revoked_at from service_token where account_id = $1
      order by created_at`,
    [id],
  );
  assert.equal(keys.filter((k) => !k.revoked_at).length, 1);
  assert.ok(
    keys.some((k) => k.revoked_at),
    "the previous key is revoked",
  );
});

test("rotation carries the name and scope forward: it is not a re-grant", async () => {
  const id = await bossAgentId();
  const { rows: before } = await db.query(
    `select name, scope from service_token
      where account_id = $1 and revoked_at is null`,
    [id],
  );
  await handler(
    event({
      path: "/api/me/principals/rotate",
      cookie: bossCookie,
      body: { account_id: id },
    }),
  );
  const { rows: after } = await db.query(
    `select name, scope from service_token
      where account_id = $1 and revoked_at is null`,
    [id],
  );
  assert.deepEqual(after, before);
});

test("you cannot rotate somebody else's agent", async () => {
  const id = await bossAgentId();
  const res = await handler(
    event({
      path: "/api/me/principals/rotate",
      cookie: leaderCookie, // not the owner
      body: { account_id: id },
    }),
  );
  assert.equal(res.statusCode, 404, "not found, never 'refused'");
  const { rows } = await db.query(
    `select count(*)::int as live from service_token
      where account_id = $1 and revoked_at is null`,
    [id],
  );
  assert.equal(rows[0].live, 1, "and nothing was rotated");
});

test("a suspended agent is indistinguishable from an invalid token", async () => {
  // Jamie's call. Both doors already require account.status = 'approved', so
  // suspension travels through the ordinary not-found path -- nothing tells
  // the caller the principal exists and is switched off.
  const id = await bossAgentId();
  const res = await handler(
    event({
      path: "/api/me/principals/status",
      cookie: bossCookie,
      body: { account_id: id, status: "disabled" },
    }),
  );
  assert.equal(res.statusCode, 200, res.body);
  const { rows } = await db.query(
    `select status from account where account_id = $1`,
    [id],
  );
  assert.equal(rows[0].status, "disabled");

  // Suspension is NOT revocation: the key survives, so resuming does not
  // require redistributing a credential.
  const { rows: keys } = await db.query(
    `select count(*)::int as live from service_token
      where account_id = $1 and revoked_at is null`,
    [id],
  );
  assert.equal(keys[0].live, 1);

  await handler(
    event({
      path: "/api/me/principals/status",
      cookie: bossCookie,
      body: { account_id: id, status: "approved" },
    }),
  );
  const { rows: back } = await db.query(
    `select status from account where account_id = $1`,
    [id],
  );
  assert.equal(back[0].status, "approved");
});

test("suspending refuses a status that is not a status", async () => {
  const id = await bossAgentId();
  const res = await handler(
    event({
      path: "/api/me/principals/status",
      cookie: bossCookie,
      body: { account_id: id, status: "requested" },
    }),
  );
  assert.notEqual(res.statusCode, 200);
  const { rows } = await db.query(
    `select status from account where account_id = $1`,
    [id],
  );
  assert.equal(rows[0].status, "approved");
});

test("an agent's feed is readable by its owner and nobody else", async () => {
  const id = await bossAgentId();
  const { emitFeedEvent } = await import("../../mcp/src/feed.mjs");
  await emitFeedEvent(db, id, "member_joined", "#20JJJ2CCRU", { name: "Ada" });

  const mine = parse(
    await handler(
      q("/api/me/principals/events", { account_id: id }, bossCookie),
    ),
  );
  assert.equal(mine.events.length, 1);
  assert.equal(mine.events[0].topic, "member_joined");

  const theirs = await handler(
    q("/api/me/principals/events", { account_id: id }, leaderCookie),
  );
  assert.equal(theirs.statusCode, 404);
});

test("reading an agent's feed never advances its cursor", async () => {
  // That cursor belongs to the agent's own elixir_events polling. Moving it
  // from the console would silently eat notifications it has not read.
  const id = await bossAgentId();
  const before = await db.query(
    `select events_seen_through from account where account_id = $1`,
    [id],
  );
  await handler(q("/api/me/principals/events", { account_id: id }, bossCookie));
  const after = await db.query(
    `select events_seen_through from account where account_id = $1`,
    [id],
  );
  assert.deepEqual(after.rows[0], before.rows[0]);
});

test("the on_behalf_of map is listable and correctable by the owner alone", async () => {
  const id = await bossAgentId();
  await db.query(
    `insert into agent_identity (account_id, external_id, player_tag)
     values ($1, 'discord:123', '#20JJJ2CCRU')`,
    [id],
  );

  const listed = parse(
    await handler(
      q("/api/me/principals/identities", { account_id: id }, bossCookie),
    ),
  );
  assert.equal(listed.identities.length, 1);
  assert.equal(listed.identities[0].external_id, "discord:123");

  const nosy = await handler(
    q("/api/me/principals/identities", { account_id: id }, leaderCookie),
  );
  assert.equal(nosy.statusCode, 404);

  const denied = await handler(
    event({
      path: "/api/me/principals/identities/remove",
      cookie: leaderCookie,
      body: { account_id: id, external_id: "discord:123" },
    }),
  );
  assert.equal(denied.statusCode, 404);
  const { rows: survived } = await db.query(
    `select count(*)::int as n from agent_identity where account_id = $1`,
    [id],
  );
  assert.equal(survived[0].n, 1, "a stranger's remove changed nothing");

  const ok = await handler(
    event({
      path: "/api/me/principals/identities/remove",
      cookie: bossCookie,
      body: { account_id: id, external_id: "discord:123" },
    }),
  );
  assert.equal(ok.statusCode, 200, ok.body);
});

test("an agent's calls surface on the owner's principal list", async () => {
  // budgetFor charges an agent's calls to owned_by_account_id, but
  // /api/me/usage filters to the owner's OWN account_id -- so the calls that
  // exhausted the budget were invisible everywhere.
  const id = await bossAgentId();
  await db.query(
    `insert into mcp_call_audit (account_id, tool, surface)
     values ($1, 'war_current', 'mcp')`,
    [id],
  );
  const listed = parse(
    await handler(
      event({ method: "GET", path: "/api/me/principals", cookie: bossCookie }),
    ),
  );
  const agent = listed.agents.find((a) => a.account_id === id);
  assert.ok(agent.calls_7d >= 1, `calls_7d was ${agent.calls_7d}`);
});
