/**
 * An agent's console: `/api/agent/<public_id>/...` runs the `/api/me/...`
 * route as an agent the signed-in person owns
 * (docs/reviews/2026-09-23-CONSOLE-ACCOUNT-SWITCHER.md).
 *
 * The whole security risk of the design is one route forgetting the
 * ownership check, so the check lives in the handler and this file walks
 * the table: every scoped route answers for your agent, 404s for anyone
 * else's, and every route off the table is a 404 under the prefix.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import { emailHash } from "../../auth/src/index.mjs";
import { AGENT_SCOPED_ROUTES, makeHandler } from "../src/handler.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_agent_scope_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);

const OWNER = "owner-of-agent@example.com";
const STRANGER = "stranger@example.com";

let db;
let handler;
const sentEmails = [];
let ownerCookie;
let strangerCookie;
let ownerId;
let agentId;
let agentPid;

function event({ method = "GET", path: p, body, cookie, ip = "8.8.4.4" }) {
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

async function signIn(email, ip) {
  await handler(
    event({ method: "POST", path: "/api/auth", body: { email }, ip }),
  );
  const { code } = sentEmails.at(-1);
  const res = await handler(
    event({
      method: "POST",
      path: "/api/auth/code",
      body: { email, code },
      ip,
    }),
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
  handler = makeHandler({
    databaseUrl: DB_URL,
    secret: "agent-scope-secret",
    sendLoginEmail: async (m) => sentEmails.push(m),
    notifyOwner: async () => {},
    sendWelcomeEmail: async () => {},
  });
  await db.query(
    `insert into clan (clan_tag, name) values ('#J2RGCRVG', 'POAP KINGS')`,
  );
  const { rows } = await db.query(
    `insert into account (email_hash, status, role, timezone)
     values ($1, 'approved', 'member', 'America/Chicago') returning account_id`,
    [emailHash(OWNER)],
  );
  ownerId = rows[0].account_id;
  await db.query(
    `insert into account_clan (account_id, clan_tag, scope)
     values ($1, '#J2RGCRVG', 'activity')`,
    [ownerId],
  );
  await db.query(
    `insert into account (email_hash, status, role) values ($1, 'approved', 'member')`,
    [emailHash(STRANGER)],
  );
  ownerCookie = await signIn(OWNER, "8.8.4.4");
  strangerCookie = await signIn(STRANGER, "8.8.4.9");

  const created = await handler(
    event({
      method: "POST",
      path: "/api/me/agents",
      body: { name: "poap-bot", clan_tag: "#J2RGCRVG" },
      cookie: ownerCookie,
    }),
  );
  assert.equal(created.statusCode, 201, created.body);
  const { rows: agent } = await db.query(
    `select account_id, public_id from account where owned_by_account_id = $1`,
    [ownerId],
  );
  agentId = agent[0].account_id;
  agentPid = agent[0].public_id;
  // One call each, today: the agent's and its owner's.
  await db.query(
    `insert into mcp_call_audit (account_id, tool) values ($1, 'war_current'), ($2, 'players_summary')`,
    [agentId, ownerId],
  );
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

/** Every scoped GET, as the agent path it answers at. */
const scopedGets = () =>
  [...AGENT_SCOPED_ROUTES]
    .filter((k) => k.startsWith("GET ") && !k.endsWith("/*"))
    .map((k) => k.slice(4).replace("/api/me", `/api/agent/${agentPid}`));

test("every scoped read answers for your agent, and for nobody else", async () => {
  for (const p of scopedGets()) {
    const mine = await handler(event({ path: p, cookie: ownerCookie }));
    assert.equal(mine.statusCode, 200, `${p}: ${mine.body}`);
    const theirs = await handler(event({ path: p, cookie: strangerCookie }));
    assert.equal(theirs.statusCode, 404, `${p} for a stranger`);
    assert.deepEqual(parse(theirs), { error: "not_found" });
    const anonymous = await handler(event({ path: p }));
    assert.equal(anonymous.statusCode, 401, `${p} signed out`);
  }
});

test("a route off the scoped table is a 404 under the prefix", async () => {
  for (const tail of [
    "/sessions",
    "/verify",
    "/email",
    "/principals",
    "/gateways",
    "/first-answer",
  ]) {
    const res = await handler(
      event({ path: `/api/agent/${agentPid}${tail}`, cookie: ownerCookie }),
    );
    assert.equal(res.statusCode, 404, tail);
  }
  // Writes that are not scoped cannot reach the agent either.
  const agents = await handler(
    event({
      method: "POST",
      path: `/api/agent/${agentPid}/agents`,
      body: { name: "nested", clan_tag: "#J2RGCRVG" },
      cookie: ownerCookie,
    }),
  );
  assert.equal(agents.statusCode, 404);
  // An id that is not a public id's shape never matches the prefix.
  const odd = await handler(
    event({ path: "/api/agent/NOT-AN-ID/timeline", cookie: ownerCookie }),
  );
  assert.equal(odd.statusCode, 404);
});

test("the agent's own me: who it is, its clans, and the owner's clock and slots", async () => {
  const agent = parse(
    await handler(
      event({ path: `/api/agent/${agentPid}`, cookie: ownerCookie }),
    ),
  );
  assert.equal(agent.kind, "agent");
  assert.equal(agent.public_id, agentPid);
  assert.equal(agent.name, "poap-bot");
  assert.equal(agent.is_admin, false);
  assert.equal(agent.timezone, "America/Chicago", "the viewer's clock");
  assert.deepEqual(
    agent.clans.map((c) => [c.clan_tag, c.name, c.is_primary]),
    [["#J2RGCRVG", "POAP KINGS", true]],
  );
  assert.equal(agent.email, undefined, "an agent has no address");

  const person = parse(
    await handler(event({ path: "/api/me", cookie: ownerCookie })),
  );
  assert.equal(person.kind, "person");
  assert.deepEqual(
    person.agents.map((a) => [a.public_id, a.name, a.clan.name]),
    [[agentPid, "poap-bot", "POAP KINGS"]],
  );
  // One pool of slots: the clan both track counts once, on both consoles.
  assert.equal(person.entitlements.activity_clans.used, 1);
  assert.deepEqual(
    agent.entitlements.activity_clans,
    person.entitlements.activity_clans,
  );
  assert.equal(person.signals.tracking, 1);
  assert.equal(agent.signals.tracking, 1);
});

test("the agent's calls are its own; the budget they spend is its owner's", async () => {
  const agentCalls = parse(
    await handler(
      event({ path: `/api/agent/${agentPid}/requests`, cookie: ownerCookie }),
    ),
  );
  assert.deepEqual(
    agentCalls.requests.map((r) => r.tool),
    ["war_current"],
  );
  const ownCalls = parse(
    await handler(event({ path: "/api/me/requests", cookie: ownerCookie })),
  );
  assert.deepEqual(
    ownCalls.requests.map((r) => r.tool),
    ["players_summary"],
  );

  const usage = parse(
    await handler(
      event({ path: `/api/agent/${agentPid}/usage`, cookie: ownerCookie }),
    ),
  );
  assert.equal(usage.today_calls, 1, "the agent's share");
  assert.equal(usage.budget_today_calls, 2, "the whole budget's day");
  assert.equal(usage.quota_max, 500, "the owner's member ceiling");
  const ownUsage = parse(
    await handler(event({ path: "/api/me/usage", cookie: ownerCookie })),
  );
  assert.equal(ownUsage.today_calls, 2, "your usage still counts your agents");
  assert.equal(ownUsage.budget_today_calls, undefined);
});

test("the log line names the scoped route, never the agent", async () => {
  const lines = [];
  const log = console.log;
  console.log = (line) => lines.push(line);
  try {
    await handler(
      event({ path: `/api/agent/${agentPid}/timeline`, cookie: ownerCookie }),
    );
  } finally {
    console.log = log;
  }
  const http = lines.map((l) => JSON.parse(l).http).filter(Boolean);
  assert.deepEqual(http, ["GET /api/agent/*/timeline"]);
  assert.ok(!lines.join("").includes(agentPid));
});

test("configuring the agent: a rival in the owner's slots, a watched player, a new primary", async () => {
  await db.query(
    `insert into clan (clan_tag, name) values ('#PGLQYRJ2', 'Rivals') on conflict do nothing`,
  );
  const post = (tail, body) =>
    handler(
      event({
        method: "POST",
        path: `/api/agent/${agentPid}${tail}`,
        body,
        cookie: ownerCookie,
      }),
    );
  // The owner (member tier) has one activity clan slot, and the clan they
  // and the agent share already fills it: a rival does not fit.
  const full = await post("/clans", {
    clan_tag: "#PGLQYRJ2",
    scope: "activity",
  });
  assert.equal(full.statusCode, 429, full.body);
  assert.match(parse(full).message, /shared with your agents/);
  // Freeing the owner's copy does not free the slot: the agent still
  // tracks the clan, and the pool counts the clan once, not the copies.
  await db.query(
    `delete from account_clan where account_id = $1 and clan_tag = '#J2RGCRVG'`,
    [ownerId],
  );
  assert.equal(
    (await post("/clans", { clan_tag: "#PGLQYRJ2", scope: "activity" }))
      .statusCode,
    429,
  );
  // One more slot for the owner (an override): now the rival fits, in
  // the agent's own copy.
  await db.query(`update account set role = 'family' where account_id = $1`, [
    ownerId,
  ]);
  const added = await post("/clans", {
    clan_tag: "#PGLQYRJ2",
    scope: "activity",
  });
  assert.equal(added.statusCode, 200, added.body);
  const clans = parse(
    await handler(
      event({ path: `/api/agent/${agentPid}/clans`, cookie: ownerCookie }),
    ),
  );
  assert.deepEqual(
    clans.clans.map((c) => [c.clan_tag, c.is_primary]),
    [
      ["#J2RGCRVG", true],
      ["#PGLQYRJ2", false],
    ],
  );
  assert.equal(clans.slots.activity.used, 2, "the pool, not the copy");

  // The clan it acts for stays: not removable while primary.
  const keep = await post("/clans", {
    clan_tag: "#J2RGCRVG",
    action: "remove",
  });
  assert.equal(keep.statusCode, 409);
  assert.equal(parse(keep).error, "primary_clan");
  // Re-point it, and then the old one can go.
  assert.equal(
    (await post("/clans", { clan_tag: "#PGLQYRJ2", action: "primary" }))
      .statusCode,
    200,
  );
  const me = parse(
    await handler(
      event({ path: `/api/agent/${agentPid}`, cookie: ownerCookie }),
    ),
  );
  assert.equal(me.clans[0].clan_tag, "#PGLQYRJ2");
  assert.equal(me.clans[0].is_primary, true);
  assert.equal(
    (await post("/clans", { clan_tag: "#J2RGCRVG", action: "remove" }))
      .statusCode,
    200,
  );
  // Its last clan is its "me": never removable.
  const last = await post("/clans", {
    clan_tag: "#PGLQYRJ2",
    action: "remove",
  });
  assert.equal(last.statusCode, 409);

  // A player it watches, never one it is.
  await db.query(
    `insert into player (player_tag, name) values ('#PQLGR2C9', 'Rival Star') on conflict do nothing`,
  );
  const watch = await post("/players", { player_tag: "#PQLGR2C9" });
  assert.equal(watch.statusCode, 200, watch.body);
  const rel = await post("/players", {
    player_tag: "#PQLGR2C9",
    action: "relationship",
    relationship: "friend",
  });
  assert.equal(rel.statusCode, 403);
  const primary = await post("/players", {
    player_tag: "#PYVJ8UL2",
    make_primary: true,
  });
  assert.equal(primary.statusCode, 403);
  const agentMe = parse(
    await handler(
      event({ path: `/api/agent/${agentPid}`, cookie: ownerCookie }),
    ),
  );
  assert.deepEqual(
    agentMe.claims.map((c) => [c.player_tag, c.relationship, c.is_primary]),
    [["#PQLGR2C9", "watching", false]],
  );
  // The events say what happened on the agent's account, and how.
  const events = parse(
    await handler(
      event({ path: `/api/agent/${agentPid}/activity`, cookie: ownerCookie }),
    ),
  );
  const kinds = events.events.map((e) => e.kind);
  for (const k of [
    "clan_added",
    "primary_clan_changed",
    "clan_removed",
    "claim_added",
  ])
    assert.ok(kinds.includes(k), `${k} in ${kinds}`);
});
