import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import crypto from "node:crypto";
import { migrate } from "../../migrate/src/migrate.mjs";
import { emailHash } from "../../auth/src/index.mjs";
import { makeHandler } from "../src/handler.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_webapi_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);
const SECRET = "web-secret";
const JAMIE = "jamie-web@example.com";
const NEWCOMER = "newcomer@example.com";

let db;
let handler;
const sentEmails = [];
const ownerNotes = [];
const welcomeEmails = [];

function event({
  method = "POST",
  path: p,
  body,
  cookie,
  contractHeader = true,
  ip = "8.8.4.4",
}) {
  return {
    rawPath: p,
    requestContext: { http: { method, sourceIp: ip } },
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(contractHeader ? { "x-elixir-client": "web" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

const parse = (res) => JSON.parse(res.body);

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
  // Jamie pre-approved as owner (bootstrap seed in real life).
  await db.query(
    `insert into account (email_hash, status, is_owner, role) values ($1, 'approved', true, 'owner')`,
    [emailHash(JAMIE)],
  );
  handler = makeHandler({
    databaseUrl: DB_URL,
    secret: SECRET,
    sendLoginEmail: async (m) => sentEmails.push(m),
    notifyOwner: async (n) => ownerNotes.push(n),
    sendWelcomeEmail: async (m) => welcomeEmails.push(m),
  });
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

// The sign-in door is rate limited per IP (10/hour) as well as per
// email, so a test that needs a fresh identity gets a fresh source IP.
async function signIn(email, ip = "8.8.4.4") {
  await handler(event({ path: "/api/auth", body: { email }, ip }));
  const { code } = sentEmails.at(-1);
  const res = await handler(
    event({ path: "/api/auth/code", body: { email, code }, ip }),
  );
  assert.equal(res.statusCode, 200, res.body);
  return res.headers["set-cookie"].split(";")[0];
}

// The per-email send limit (5/hour) is a product value the tests respect:
// sign in once per identity and share the cookie across tests.
let newcomerCookie;
// Post-sign-out identities, shared by all later tests (the 5/hour
// send limit is a product value the suite respects).
let memberCookie;
let bossCookie;

test("the full journey: request -> approve -> sign in -> claim -> record", async () => {
  // 1. A newcomer requests access; the owner is notified; response is neutral.
  const req = await handler(
    event({
      path: "/api/request-access",
      body: { email: NEWCOMER, player_tag: "2ppOv90y", note: "hi" },
    }),
  );
  assert.equal(req.statusCode, 200);
  assert.match(parse(req).message, /If your request is approved/);
  assert.equal(ownerNotes.length, 1);

  // 2. Before approval: sign-in mails nothing, same neutral answer.
  const preAuth = await handler(
    event({ path: "/api/auth", body: { email: NEWCOMER } }),
  );
  assert.equal(parse(preAuth).ok, true);
  assert.equal(sentEmails.length, 0, "pending accounts get no magic link");

  // 3. Owner signs in and approves from the admin queue.
  const ownerCookie = await signIn(JAMIE);
  const list = await handler(
    event({
      method: "GET",
      path: "/api/admin/requests",
      cookie: ownerCookie,
      body: undefined,
    }),
  );
  const pending = parse(list).requests;
  assert.equal(pending.length, 1);
  assert.equal(
    pending[0].requested_player_tag,
    "#2PP0V90Y",
    "tag normalized at the door",
  );
  const decide = await handler(
    event({
      path: "/api/admin/decide",
      cookie: ownerCookie,
      body: { email_hash: pending[0].email_hash, decision: "approved" },
    }),
  );
  assert.equal(parse(decide).status, "approved");
  // The request page promises "if your request is approved, you'll hear
  // from us by email". Approval used to notify the OWNER instead, so an
  // approved applicant heard nothing: the welcome template existed and
  // nothing ever queued it.
  assert.equal(parse(decide).notified, true, "the applicant was told");
  assert.deepEqual(
    welcomeEmails.map((m) => m.email),
    [NEWCOMER.toLowerCase()],
    "the welcome goes to the applicant, not the owner",
  );

  // 4. Newcomer signs in with the emailed code and lands a __Host- cookie.
  const cookie = await signIn(NEWCOMER);
  newcomerCookie = cookie;
  assert.match(cookie, /^__Host-elixir_session=/);

  // 5. Dashboard, claim, recording opt-in.
  const me = await handler(
    event({ method: "GET", path: "/api/me", cookie, body: undefined }),
  );
  assert.equal(parse(me).authenticated, true);
  assert.equal(parse(me).is_owner, false);

  // Added = recorded: one act claims AND starts capture.
  const claim = await handler(
    event({ path: "/api/claims", cookie, body: { player_tag: "#2PP0V90Y" } }),
  );
  assert.equal(parse(claim).ok, true);
  assert.equal(parse(claim).recording_started, true);

  const me2 = parse(
    await handler(
      event({ method: "GET", path: "/api/me", cookie, body: undefined }),
    ),
  );
  assert.equal(me2.claims.length, 1);
  assert.equal(me2.claims[0].is_primary, true, "first claim becomes primary");
  assert.equal(me2.recordings.length, 1);
  assert.equal(me2.recordings[0].status, "active");
});

test("notify toggle requires the tag to be added first", async () => {
  const cookie = newcomerCookie;
  const res = await handler(
    event({
      path: "/api/claims",
      cookie,
      body: { player_tag: "#J2RGCRVG", action: "notify_off" },
    }),
  );
  assert.equal(res.statusCode, 404);
});

test("cookie-authed state changes require the contract header (CSRF)", async () => {
  const cookie = newcomerCookie;
  const res = await handler(
    event({
      path: "/api/me/timezone",
      cookie,
      contractHeader: false,
      body: { timezone: "America/Chicago" },
    }),
  );
  assert.equal(res.statusCode, 401);
  const ok = await handler(
    event({
      path: "/api/me/timezone",
      cookie,
      body: { timezone: "America/Chicago" },
    }),
  );
  assert.equal(parse(ok).timezone, "America/Chicago");
  const bad = await handler(
    event({
      path: "/api/me/timezone",
      cookie,
      body: { timezone: "Central Time" },
    }),
  );
  assert.equal(bad.statusCode, 400);
});

test("admin routes refuse non-owners", async () => {
  const cookie = newcomerCookie;
  const res = await handler(
    event({
      method: "GET",
      path: "/api/admin/requests",
      cookie,
      body: undefined,
    }),
  );
  assert.equal(res.statusCode, 403);
  const gw = await handler(
    event({
      method: "GET",
      path: "/api/admin/gateways",
      cookie,
      body: undefined,
    }),
  );
  assert.equal(gw.statusCode, 403);
});

test("sign-out revokes: the same cookie stops resolving (last — consumes the shared session)", async () => {
  const cookie = newcomerCookie;
  await handler(event({ path: "/api/session/signout", cookie, body: {} }));
  const me = await handler(
    event({ method: "GET", path: "/api/me", cookie, body: undefined }),
  );
  assert.equal(parse(me).authenticated, false);
});

test("request-access is rate limited per IP", async () => {
  let limited = 0;
  for (let i = 0; i < 8; i += 1) {
    const res = await handler(
      event({
        path: "/api/request-access",
        ip: "3.3.3.3",
        body: { email: `x${i}@example.com` },
      }),
    );
    if (res.statusCode === 429) limited += 1;
  }
  assert.ok(limited > 0);
});

test("clan page: entitled member sees war + roster; outsiders refused", async () => {
  memberCookie = await signIn(NEWCOMER);
  bossCookie = await signIn(JAMIE);
  const cookie = memberCookie;

  // Before any recorded clan membership: no clan for this account.
  const before = await handler(
    event({ method: "GET", path: "/api/clan", cookie, body: undefined }),
  );
  assert.equal(before.statusCode, 403);

  // Seed a recorded clan the newcomer's claimed tag belongs to.
  const CLAN = "#J2RGCRVG";
  const {
    rows: [owner],
  } = await db.query(`select account_id from account where is_owner`);
  await db.query(
    `insert into clan (clan_tag, name) values ($1, 'POAP KINGS') on conflict do nothing`,
    [CLAN],
  );
  await db.query(
    `insert into recording (subject_type, subject_tag, requested_by, status, scope) values ('clan', $1, $2, 'active', 'comprehensive')`,
    [CLAN, owner.account_id],
  );
  await db.query(
    `insert into player (player_tag, name) values ('#YYYYY', 'Rascal') on conflict do nothing`,
  );
  await db.query(
    `insert into clan_membership (clan_tag, player_tag, joined_observed_at, role)
     values ($1, '#2PP0V90Y', now(), 'member'), ($1, '#YYYYY', now(), 'leader')`,
    [CLAN],
  );
  await db.query(
    `insert into war_week (clan_tag, season_id, section_index, is_colosseum) values ($1, 135, 3, true)`,
    [CLAN],
  );
  await db.query(
    `insert into war_week_clan (clan_tag, season_id, section_index, participant_clan_tag, participant_name, fame, rank)
     values ($1, 135, 3, $1, 'POAP KINGS', 5050, 2), ($1, 135, 3, '#YRLQ', 'Rivals', 6000, 1)`,
    [CLAN],
  );

  const res = parse(
    await handler(
      event({ method: "GET", path: "/api/clan", cookie, body: undefined }),
    ),
  );
  assert.equal(res.clan_tag, CLAN);
  assert.equal(res.name, "POAP KINGS");
  assert.equal(res.war.season_id, 135);
  assert.equal(res.war.is_colosseum, true);
  assert.equal(res.war.standings.length, 2);
  assert.equal(res.war.standings[0].rank, 1, "ordered by final rank");
  assert.equal(res.members.length, 2);

  // The owner falls back to the first active recorded clan.
  const ownerCookie = bossCookie;
  const ownerView = parse(
    await handler(
      event({
        method: "GET",
        path: "/api/clan",
        cookie: ownerCookie,
        body: undefined,
      }),
    ),
  );
  assert.equal(ownerView.clan_tag, CLAN);
});

test("gateway raise-hand and lifecycle: pending -> probation -> active; revoke; guards", async () => {
  const cookie = memberCookie;
  const notesBefore = ownerNotes.length;

  const bad = await handler(
    event({
      path: "/api/gateways",
      cookie,
      body: { name: "x!", static_ip: "1.2.3.4" },
    }),
  );
  assert.equal(bad.statusCode, 400);

  // Zero-trust enrollment is a NAME only - no IP collected; a stray
  // static_ip field is simply ignored (COLLECTOR-ZERO-TRUST.md).
  const raise = parse(
    await handler(
      event({
        path: "/api/gateways",
        cookie,
        body: { name: "Kitchen-Mac" },
      }),
    ),
  );
  assert.equal(raise.status, "pending");
  assert.equal(ownerNotes.length, notesBefore + 1, "owner notified");
  const gwId = raise.gateway_id;

  const dupe = await handler(
    event({
      path: "/api/gateways",
      cookie,
      body: { name: "kitchen-mac", static_ip: "203.0.113.8" },
    }),
  );
  assert.equal(dupe.statusCode, 409, "names are unique among live gateways");

  const mine = parse(
    await handler(
      event({
        method: "GET",
        path: "/api/me/gateways",
        cookie,
        body: undefined,
      }),
    ),
  );
  assert.ok(
    mine.gateways.some(
      (g) => g.gateway_id === gwId && g.name === "kitchen-mac",
    ),
  );

  // Lifecycle is owner-only and forward-only.
  const ownerCookie = bossCookie;
  const nonOwner = await handler(
    event({
      path: "/api/admin/gateways",
      cookie,
      body: { gateway_id: gwId, action: "activate" },
    }),
  );
  assert.equal(nonOwner.statusCode, 403);
  const skip = await handler(
    event({
      path: "/api/admin/gateways",
      cookie: ownerCookie,
      body: { gateway_id: gwId, action: "activate" },
    }),
  );
  assert.equal(skip.statusCode, 409, "pending cannot jump straight to active");
  const prob = parse(
    await handler(
      event({
        path: "/api/admin/gateways",
        cookie: ownerCookie,
        body: {
          gateway_id: gwId,
          action: "probation",
          cr_key_ref: "supercell:kitchen-mac",
        },
      }),
    ),
  );
  assert.equal(prob.status, "probation");
  const act = parse(
    await handler(
      event({
        path: "/api/admin/gateways",
        cookie: ownerCookie,
        body: { gateway_id: gwId, action: "activate" },
      }),
    ),
  );
  assert.equal(act.status, "active");
  const rev = parse(
    await handler(
      event({
        path: "/api/admin/gateways",
        cookie: ownerCookie,
        body: { gateway_id: gwId, action: "revoke" },
      }),
    ),
  );
  assert.equal(rev.status, "revoked");

  // A revoked gateway's name is free again.
  const again = await handler(
    event({
      path: "/api/gateways",
      cookie,
      body: { name: "kitchen-mac", static_ip: "203.0.113.7" },
    }),
  );
  assert.equal(again.statusCode, 200);
});

test("usage: member sees own daily counts and quota; admin sees the fleet", async () => {
  const cookie = memberCookie;
  const { rows: acct } = await db.query(
    `select account_id from account where email_hash = $1`,
    [emailHash(NEWCOMER)],
  );
  await db.query(
    `insert into mcp_call_audit (account_id, tool, duration_ms, result_bytes)
     values ($1, 'players_profile', 120, 900), ($1, 'battles_query', 340, 4000)`,
    [acct[0].account_id],
  );
  await db.query(
    `insert into mcp_call_audit (account_id, tool, error_code)
     values ($1, 'war_current', 'not_entitled')`,
    [acct[0].account_id],
  );

  const mine = parse(
    await handler(
      event({ method: "GET", path: "/api/me/usage", cookie, body: undefined }),
    ),
  );
  assert.equal(mine.today_calls, 3);
  assert.equal(mine.quota_max, 500, "default quota surfaced");
  assert.equal(mine.days[0].errors, 1);
  assert.ok(mine.top_tools.some((t) => t.tool === "players_profile"));

  const ownerCookie = bossCookie;
  const fleet = parse(
    await handler(
      event({
        method: "GET",
        path: "/api/admin/usage",
        cookie: ownerCookie,
        body: undefined,
      }),
    ),
  );
  const row = fleet.accounts.find((a) => a.primary_tag === "#2PP0V90Y");
  assert.equal(row.calls_7d, 3);
  assert.equal(row.errors_7d, 1);
  assert.ok(fleet.tools.some((t) => t.tool === "battles_query"));

  const nonOwner = await handler(
    event({ method: "GET", path: "/api/admin/usage", cookie, body: undefined }),
  );
  assert.equal(nonOwner.statusCode, 403);
});

test("connections: list shows OAuth families; revoke disconnects; others' families untouchable", async () => {
  const cookie = memberCookie;
  const { rows: acct } = await db.query(
    `select account_id from account where email_hash = $1`,
    [emailHash(NEWCOMER)],
  );
  await db.query(
    `insert into oauth_client (client_id, client_name, redirect_uris, expires_at)
     values ('cid-test', 'Claude', '[]', now() + interval '30 days')`,
  );
  const { rows: fam } = await db.query(
    `insert into oauth_family (client_id, account_id, absolute_expires_at)
     values ('cid-test', $1, now() + interval '90 days') returning family_id`,
    [acct[0].account_id],
  );

  const list = parse(
    await handler(
      event({
        method: "GET",
        path: "/api/me/connections",
        cookie,
        body: undefined,
      }),
    ),
  );
  assert.equal(list.connections.length, 1);
  assert.equal(list.connections[0].client_name, "Claude");
  assert.equal(
    list.connections[0].scope,
    "cr:read",
    "legacy/default families are visibly read-only",
  );

  // The owner cannot revoke someone else's family through this route.
  const ownerCookie = bossCookie;
  const foreign = await handler(
    event({
      path: "/api/me/connections/revoke",
      cookie: ownerCookie,
      body: { family_id: fam[0].family_id },
    }),
  );
  assert.equal(foreign.statusCode, 404);

  const revoked = parse(
    await handler(
      event({
        path: "/api/me/connections/revoke",
        cookie,
        body: { family_id: fam[0].family_id },
      }),
    ),
  );
  assert.equal(revoked.ok, true);
  const after = parse(
    await handler(
      event({
        method: "GET",
        path: "/api/me/connections",
        cookie,
        body: undefined,
      }),
    ),
  );
  assert.equal(after.connections.length, 0);
});

test("activity log + recording cap: events accrue; the cap refuses politely", async () => {
  const cookie = memberCookie;
  const act = parse(
    await handler(
      event({
        method: "GET",
        path: "/api/me/activity",
        cookie,
        body: undefined,
      }),
    ),
  );
  const kinds = act.events.map((e) => e.kind);
  assert.ok(kinds.includes("signed_in"));
  assert.ok(kinds.includes("claim_added"));
  assert.ok(kinds.includes("recording_started"));
  assert.ok(kinds.includes("gateway_raised"));
  assert.ok(kinds.includes("connection_revoked"));

  // Cap: one tag added; drop the cap to 1 and the next ADD refuses.
  await db.query(
    `update account set max_player_recordings = 1 where email_hash = $1`,
    [emailHash(NEWCOMER)],
  );
  const refused = await handler(
    event({ path: "/api/claims", cookie, body: { player_tag: "#PLC220" } }),
  );
  assert.equal(refused.statusCode, 429);
  assert.match(parse(refused).message, /capped at 1/);
  await db.query(
    `update account set max_player_recordings = null where email_hash = $1`,
    [emailHash(NEWCOMER)],
  );
});

test("collector fleet: card-derived identity, quota credits; scoring rides admission", async () => {
  await db.query(
    `update gateway set fetch_points = 2600 where name = 'kitchen-mac' and status <> 'revoked'`,
  );
  const ladder = parse(
    await handler(
      event({
        method: "GET",
        path: "/api/gateways/ladder",
        cookie: memberCookie,
        body: undefined,
      }),
    ),
  );
  // The machine label is PRIVATE (#28) - the ladder is found by points,
  // not by the operator's name for their own box.
  const top = ladder.ladder.find((g) => g.points === 2600);
  assert.ok(top, "the collector is on the ladder");
  assert.equal(top.credits, 260, "10 fetches = +1 daily call");
  assert.ok(!("arena" in top), "arenas are gone");
  assert.ok(!("machine" in top), "machine labels never leave the owner");
  assert.equal(top.mine, true, "an operator can still find their own row");

  const mine = parse(
    await handler(
      event({
        method: "GET",
        path: "/api/me/gateways",
        cookie: memberCookie,
        body: undefined,
      }),
    ),
  );
  // The lifecycle test left a revoked twin of the same name behind.
  const gw = mine.gateways.find(
    (g) => g.name === "kitchen-mac" && g.status !== "revoked",
  );
  assert.equal(gw.fetch_points, 2600);
  assert.equal(gw.credits, 260);
  assert.ok(!("arena" in gw));
});

test("explorer bridge: registry tools with session auth, audited as surface web", async () => {
  const cookie = memberCookie;
  const res = parse(
    await handler(
      event({
        path: "/api/explore",
        cookie,
        body: { tool: "elixir_my_players", args: {} },
      }),
    ),
  );
  assert.equal(res.is_error, false);
  assert.ok(Array.isArray(res.body.players));

  // Entitlements ride along: a stranger tag (no shared clan) refuses.
  const denied = parse(
    await handler(
      event({
        path: "/api/explore",
        cookie,
        body: { tool: "battles_query", args: { player_tag: "#PYGRJC" } },
      }),
    ),
  );
  // Universal reads (2026-09-05): any tag serves; an unobserved one is
  // an honest empty, not a refusal.
  assert.equal(denied.is_error, false);
  assert.equal(denied.body.battles.length, 0);

  // Live passthrough is not explorable; unknown tools refuse.
  const live = await handler(
    event({ path: "/api/explore", cookie, body: { tool: "live_fetch" } }),
  );
  assert.equal(live.statusCode, 400);

  // Audit rows carry the web surface.
  const { rows } = await db.query(
    `select count(*)::int n from mcp_call_audit where surface = 'web'`,
  );
  assert.ok(rows[0].n >= 2, "explorer calls audited as web");
});

test("feedback: web form + MCP tool land attributed rows; admin triages", async () => {
  const cookie = memberCookie;
  const web = await handler(
    event({
      path: "/api/feedback",
      cookie,
      body: { message: "Love the explorer", category: "praise" },
    }),
  );
  assert.equal(web.statusCode, 200);

  // Writes do not ride the explorer (2026-09-09): feedback has its own
  // route and its own MCP capability, so the bridge refuses it outright.
  const viaBridge = await handler(
    event({
      path: "/api/explore",
      cookie,
      body: {
        tool: "elixir_feedback",
        args: { message: "battles_query filters rock", category: "praise" },
      },
    }),
  );
  assert.equal(viaBridge.statusCode, 400);
  const viaMcp = parse(
    await handler(
      event({
        path: "/api/feedback",
        cookie,
        body: { message: "battles_query filters rock", category: "praise" },
      }),
    ),
  );
  assert.equal(viaMcp.ok, true, JSON.stringify(viaMcp));

  const list = parse(
    await handler(
      event({
        method: "GET",
        path: "/api/admin/feedback",
        cookie: bossCookie,
        body: undefined,
      }),
    ),
  );
  assert.ok(list.feedback.length >= 2);
  assert.ok(list.feedback.every((f) => f.surface === "web"));
  // The MCP-surface path (elixir_feedback at the MCP door) is covered in
  // services/mcp/test/tools2 "feedback loop closes".
  assert.equal(list.feedback[0].from_player, "#2PP0V90Y");

  const triage = await handler(
    event({
      path: "/api/admin/feedback",
      cookie: bossCookie,
      body: { feedback_id: list.feedback[0].feedback_id, status: "planned" },
    }),
  );
  assert.equal(triage.statusCode, 200);
});

test("service tokens: owner issues, token validates at the MCP door, revoke kills it", async () => {
  const issued = parse(
    await handler(
      event({
        path: "/api/admin/service-tokens",
        cookie: bossCookie,
        body: { name: "elixir-bot" },
      }),
    ),
  );
  assert.ok(issued.token.startsWith("svt_"));

  const { validateServiceToken } = await import("../../auth/src/oauth.mjs");
  const who = await validateServiceToken(db, issued.token);
  assert.ok(who, "token validates");
  assert.equal(who.serviceName, "elixir-bot");
  assert.equal(who.isOwner, true);
  assert.equal(who.credentialType, "service");
  assert.deepEqual(who.scopes, [
    "cr:read",
    "recordings:write",
    "collections:write",
    "account:write",
    "feedback:write",
  ]);

  const list = parse(
    await handler(
      event({
        method: "GET",
        path: "/api/admin/service-tokens",
        cookie: bossCookie,
        body: undefined,
      }),
    ),
  );
  const row = list.tokens.find((t) => t.name === "elixir-bot");
  await handler(
    event({
      path: "/api/admin/service-tokens",
      cookie: bossCookie,
      body: { revoke_token_id: row.token_id },
    }),
  );
  assert.equal(
    await validateServiceToken(db, issued.token),
    null,
    "revoked token refuses",
  );

  const nonOwner = await handler(
    event({
      path: "/api/admin/service-tokens",
      cookie: memberCookie,
      body: { name: "sneaky" },
    }),
  );
  assert.equal(nonOwner.statusCode, 403);
});

test("admin collections: owner curates; non-owner refused", async () => {
  const ownerCookie = await signIn(JAMIE);
  let res = await handler(
    event({
      path: "/api/admin/collections",
      method: "POST",
      cookie: ownerCookie,
      body: {
        action: "upsert",
        slug: "creators",
        title: "Creators",
        kind: "player",
      },
    }),
  );
  assert.equal(JSON.parse(res.body).ok, true);
  res = await handler(
    event({
      path: "/api/admin/collections",
      method: "POST",
      cookie: ownerCookie,
      body: { action: "add", slug: "creators", tags: ["#PYGRJC0"] },
    }),
  );
  assert.equal(JSON.parse(res.body).changed, 1);
  res = await handler(
    event({
      path: "/api/admin/collections",
      method: "GET",
      cookie: ownerCookie,
    }),
  );
  assert.equal(res.statusCode, 200, res.body);
  const list = JSON.parse(res.body).collections;
  const c = list.find((x) => x.slug === "creators");
  assert.equal(c.member_count, 1);
  assert.deepEqual(c.members, ["#PYGRJC0"]);

  const memberCookie = await signIn(NEWCOMER);
  res = await handler(
    event({
      path: "/api/admin/collections",
      method: "GET",
      cookie: memberCookie,
    }),
  );
  assert.equal(res.statusCode, 403);
});

let ladderNewcomerCookie; // shared with the collections test (send limit)

test("entitlement ladder: /api/me exposes tier; upgrades are self-serve; admin sets roles", async () => {
  const ownerCookie = bossCookie;
  const cookie = memberCookie;
  ladderNewcomerCookie = cookie;
  // Clear the hand-tuned override from the cap test above: the role
  // default (member: 3) must take over when no override is set.
  await db.query(
    `update account set max_player_recordings = null where email_hash = $1`,
    [emailHash(NEWCOMER)],
  );

  // NEWCOMER defaults to member with the ratified limits on the wire.
  let me = parse(
    await handler(
      event({ method: "GET", path: "/api/me", cookie, body: undefined }),
    ),
  );
  assert.equal(me.role, "member");
  // Player slots are no longer a rung on the ladder (50 everywhere below
  // unlimited); comprehensive clans and collections still are.
  assert.equal(me.entitlements.player_slots.limit, 50);
  assert.equal(me.entitlements.comprehensive_clans.limit, 0);
  assert.equal(me.entitlements.collections.limit, 0);

  // Self-serve upgrade request: files once, refuses duplicates and
  // sideways moves.
  const sideways = await handler(
    event({ path: "/api/me/role-request", cookie, body: { role: "member" } }),
  );
  assert.equal(sideways.statusCode, 400);
  const req = await handler(
    event({
      path: "/api/me/role-request",
      cookie,
      body: { role: "family", note: "clan family of three" },
    }),
  );
  assert.equal(req.statusCode, 200, req.body);
  const dup = await handler(
    event({ path: "/api/me/role-request", cookie, body: { role: "leader" } }),
  );
  assert.equal(dup.statusCode, 409);

  // The admin sees the pending request on the accounts surface and
  // grants the tier; a feed event records the change.
  const accounts = parse(
    await handler(
      event({
        method: "GET",
        path: "/api/admin/accounts",
        cookie: ownerCookie,
        body: undefined,
      }),
    ),
  );
  const row = accounts.accounts.find(
    (a) => a.role === "member" && a.pending_role_request,
  );
  assert.ok(row, "pending upgrade request visible to admin");
  const set = await handler(
    event({
      path: "/api/admin/accounts",
      cookie: ownerCookie,
      body: { account_id: row.account_id, role: "family" },
    }),
  );
  assert.equal(set.statusCode, 200, set.body);
  const { rows: feed } = await db.query(
    `select topic from event_feed where account_id = $1 order by event_id desc`,
    [row.account_id],
  );
  assert.ok(feed.some((e) => e.topic === "role_changed"));

  me = parse(
    await handler(
      event({ method: "GET", path: "/api/me", cookie, body: undefined }),
    ),
  );
  assert.equal(me.role, "family");
  assert.equal(me.entitlements.collections.limit, 5);

  // Non-role strings and non-owner setters are refused.
  const bogus = await handler(
    event({
      path: "/api/admin/accounts",
      cookie: ownerCookie,
      body: { account_id: row.account_id, role: "emperor" },
    }),
  );
  assert.equal(bogus.statusCode, 400);
  const sneaky = await handler(
    event({
      path: "/api/admin/accounts",
      cookie,
      body: { account_id: row.account_id, role: "admin" },
    }),
  );
  assert.equal(sneaky.statusCode, 403);
});

test("self-serve collections: family curates within its cap, touches only its own", async () => {
  const cookie = ladderNewcomerCookie; // family tier from the prior test
  const make = (slug) =>
    handler(
      event({
        path: "/api/me/collections",
        cookie,
        body: { action: "upsert", slug, title: slug, kind: "player" },
      }),
    );
  for (const slug of ["fam-a", "fam-b", "fam-c", "fam-d", "fam-e"]) {
    const r = await make(slug);
    assert.equal(r.statusCode, 200, r.body);
  }
  const over = await make("fam-f");
  assert.equal(over.statusCode, 429, "cap of 5 for family");

  const add = await handler(
    event({
      path: "/api/me/collections",
      cookie,
      body: { action: "add", slug: "fam-a", tags: ["#PYGRJC0", "#2PLQVU"] },
    }),
  );
  assert.equal(parse(add).changed, 2);

  // The admin-owned 'creators' collection is not theirs to touch.
  const foreign = await handler(
    event({
      path: "/api/me/collections",
      cookie,
      body: { action: "add", slug: "creators", tags: ["#2PLQVU"] },
    }),
  );
  assert.equal(foreign.statusCode, 403);

  // A plain member cannot create at all.
  const { rows: acct } = await db.query(
    `select account_id from account where email_hash = $1`,
    [emailHash(NEWCOMER)],
  );
  await db.query(`update account set role = 'member' where account_id = $1`, [
    acct[0].account_id,
  ]);
  const blocked = await make("fam-g");
  assert.equal(blocked.statusCode, 403);
  await db.query(`update account set role = 'family' where account_id = $1`, [
    acct[0].account_id,
  ]);

  const mine = parse(
    await handler(
      event({
        method: "GET",
        path: "/api/me/collections",
        cookie,
        body: undefined,
      }),
    ),
  );
  assert.equal(mine.collections.length, 5);
  assert.equal(mine.limit, 5);
});

test("clans: added = recorded within slots; notify is the toggle; remove settles the recording", async () => {
  const cookie = bossCookie; // owner: unlimited slots
  const add = await handler(
    event({
      path: "/api/me/clans",
      cookie,
      body: { clan_tag: "gq0ylcyj", action: "add", scope: "activity" },
    }),
  );
  assert.equal(parse(add).clan_tag, "#GQ0YLCYJ", "normalized at the door");
  assert.equal(parse(add).scope, "activity");
  const list = parse(
    await handler(
      event({ method: "GET", path: "/api/me/clans", cookie, body: undefined }),
    ),
  );
  const row = list.clans.find((c) => c.clan_tag === "#GQ0YLCYJ");
  assert.equal(row.recording_status, "active");
  assert.equal(row.notify, true);

  // A member has no comprehensive slots: the ADD refuses.
  const memberCookie2 = memberCookie;
  const { rows: acct } = await db.query(
    `select account_id from account where email_hash = $1`,
    [emailHash(NEWCOMER)],
  );
  await db.query(`update account set role = 'member' where account_id = $1`, [
    acct[0].account_id,
  ]);
  const refused = await handler(
    event({
      path: "/api/me/clans",
      cookie: memberCookie2,
      body: { clan_tag: "#2PPC220", action: "add", scope: "comprehensive" },
    }),
  );
  assert.equal(refused.statusCode, 429);
  assert.match(parse(refused).message, /no comprehensive-scope clan slots/);
  await db.query(`update account set role = 'family' where account_id = $1`, [
    acct[0].account_id,
  ]);

  // Notify off, then remove: removal stops the recording (last adder).
  const mute = await handler(
    event({
      path: "/api/me/clans",
      cookie,
      body: { clan_tag: "#GQ0YLCYJ", action: "notify_off" },
    }),
  );
  assert.equal(parse(mute).notify, false);
  const removed = await handler(
    event({
      path: "/api/me/clans",
      cookie,
      body: { clan_tag: "#GQ0YLCYJ", action: "remove" },
    }),
  );
  assert.equal(parse(removed).removed, true);
  assert.equal(parse(removed).recording_stopped, true);
  const after = parse(
    await handler(
      event({ method: "GET", path: "/api/me/clans", cookie, body: undefined }),
    ),
  );
  assert.ok(!after.clans.some((c) => c.clan_tag === "#GQ0YLCYJ"));

  // The admin clan surface stays GONE - purely a user function.
  const gone = await handler(
    event({
      method: "GET",
      path: "/api/admin/clans",
      cookie,
      body: undefined,
    }),
  );
  assert.equal(gone.statusCode, 404);
});

test("public stats: no auth needed, cacheable, honest totals and series", async () => {
  const res = await handler(
    event({ method: "GET", path: "/api/public/stats", body: undefined }),
  );
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["cache-control"], /max-age=3600/);
  const body = parse(res);
  assert.ok(body.totals.players >= 1);
  assert.ok(Array.isArray(body.series.battles_daily));
  assert.ok(Array.isArray(body.series.fetches_daily));
  assert.ok(
    !JSON.stringify(body).includes("email_hash"),
    "no account data leaks",
  );
});

test("activity APIs: own request log, read-only notification view, collector detail", async () => {
  const cookie = bossCookie;
  const reqs = parse(
    await handler(
      event({
        method: "GET",
        path: "/api/me/requests",
        cookie,
        body: undefined,
      }),
    ),
  );
  assert.ok(Array.isArray(reqs.requests));

  const before = await db.query(
    `select events_seen_through from account where email_hash = $1`,
    [emailHash(JAMIE)],
  );
  const ev = parse(
    await handler(
      event({ method: "GET", path: "/api/me/events", cookie, body: undefined }),
    ),
  );
  assert.ok(Array.isArray(ev.events));
  assert.equal(typeof ev.seen_through, "number");
  const after = await db.query(
    `select events_seen_through from account where email_hash = $1`,
    [emailHash(JAMIE)],
  );
  assert.equal(
    String(before.rows[0].events_seen_through),
    String(after.rows[0].events_seen_through),
    "web view never advances the agents' cursor",
  );

  // Collector detail: owner-scoped; someone else's gateway 404s.
  const { rows: gw } = await db.query(
    `select gateway_id::text as id, owner_account_id from gateway limit 1`,
  );
  if (gw[0]) {
    const res = await handler(
      event({
        method: "GET",
        path: "/api/me/gateway-detail",
        cookie: memberCookie,
        body: undefined,
      }),
    );
    // no id -> not found, never a crash
    assert.equal(res.statusCode, 404);
  }
});

test("gateway config download is strictly one-time and owner-scoped", async () => {
  const cookie = memberCookie; // NEWCOMER raised kitchen-mac earlier
  const { rows: gw } = await db.query(
    `select gateway_id::text as id, owner_account_id from gateway
     where name = 'kitchen-mac' limit 1`,
  );
  await db.query(
    `update gateway set provision_env = 'ELIXIR_MCP_GATEWAY_ID=test',
       provision_claimed_at = null,
       provision_expires_at = now() + interval '72 hours'
     where gateway_id::text = $1`,
    [gw[0].id],
  );
  // Someone else's session can't claim it.
  const foreign = await handler(
    event({
      path: "/api/me/gateway-env",
      cookie: bossCookie,
      body: { id: gw[0].id },
    }),
  );
  assert.equal(foreign.statusCode, 404);
  // The owner claims it once...
  const first = await handler(
    event({
      path: "/api/me/gateway-env",
      cookie,
      body: { id: gw[0].id },
    }),
  );
  assert.equal(first.statusCode, 200, first.body);
  assert.match(parse(first).env, /GATEWAY_ID=test/);
  // ...and only once: the stored copy is gone.
  const second = await handler(
    event({
      path: "/api/me/gateway-env",
      cookie,
      body: { id: gw[0].id },
    }),
  );
  assert.equal(second.statusCode, 404, "one-time means one time");
  const { rows: after } = await db.query(
    `select provision_env, provision_claimed_at from gateway where gateway_id::text = $1`,
    [gw[0].id],
  );
  assert.equal(after[0].provision_env, null);
  assert.ok(after[0].provision_claimed_at);
});

test("public status: no auth, 60s cache, no confidential fields", async () => {
  const res = await handler(
    event({ method: "GET", path: "/api/public/status", body: undefined }),
  );
  assert.equal(res.statusCode, 200, res.body);
  assert.match(res.headers["cache-control"], /max-age=60/);
  const body = parse(res);
  assert.ok("ok" in body.health);
  assert.ok(Array.isArray(body.collectors));
  assert.ok(Array.isArray(body.capture_5m));
  const blob = JSON.stringify(body);
  assert.ok(!blob.includes("static_ip"), "no IPs on the public surface");
  assert.ok(!blob.includes("email_hash"), "no account data");
  // We keep addresses now (0046). A public surface must never carry one.
  assert.ok(!blob.includes("@"), "no email address on a public surface");
  assert.ok(!blob.includes("kitchen-mac"), "machine labels stay private");
});

test("provision_token: one click mints, one look claims (zero-trust copy flow)", async () => {
  // Owner provisions; the raw token exists in the DB only until reveal.
  const { rows: gw } = await db.query(
    `select gateway_id from gateway where name = 'kitchen-mac'`,
  );
  const id = gw[0].gateway_id;
  const minted = parse(
    await handler(
      event({
        path: "/api/admin/gateways",
        cookie: bossCookie,
        body: { gateway_id: id, action: "provision_token" },
      }),
    ),
  );
  assert.equal(minted.ok, true);
  const { rows: after } = await db.query(
    `select token_hash, provision_env from gateway where gateway_id = $1`,
    [id],
  );
  assert.match(after[0].token_hash, /^[0-9a-f]{64}$/);
  assert.ok(after[0].provision_env.startsWith("emcg_"), "raw staged");
  assert.equal(
    after[0].token_hash,
    crypto.createHash("sha256").update(after[0].provision_env).digest("hex"),
    "staged raw hashes to the stored hash",
  );

  // Operator reveal is one-time (existing claim-and-null flow).
  const reveal = parse(
    await handler(
      event({
        path: "/api/me/gateway-env",
        cookie: memberCookie,
        body: { id },
      }),
    ),
  );
  assert.ok(reveal.env.startsWith("emcg_"));
  const again = await handler(
    event({
      path: "/api/me/gateway-env",
      cookie: memberCookie,
      body: { id },
    }),
  );
  assert.equal(again.statusCode, 404, "second claim finds nothing");
});

test("admin provisioning says what it did: staged state and ownership on the admin list (2026-09-06)", async () => {
  // A member's collector, provisioned by the owner.
  const raise = parse(
    await handler(
      event({
        path: "/api/gateways",
        cookie: memberCookie,
        body: { name: "regress-op-nas" },
      }),
    ),
  );
  assert.equal(raise.status, "pending");
  const id = raise.gateway_id;
  const staged = parse(
    await handler(
      event({
        path: "/api/admin/gateways",
        cookie: bossCookie,
        body: { gateway_id: id, action: "provision_token" },
      }),
    ),
  );
  assert.equal(staged.staged, true, "the click reports what it did");

  const list = async () =>
    parse(
      await handler(
        event({
          method: "GET",
          path: "/api/admin/gateways",
          cookie: bossCookie,
          body: undefined,
        }),
      ),
    );
  let row = (await list()).gateways.find((g) => g.gateway_id === id);
  assert.equal(row.provision_ready, true, "admin sees the token is staged");
  assert.equal(row.owner_is_me, false, "...and that someone else reveals it");
  assert.equal(row.channel, "bulk", "channel rides the admin list");

  // The operator's one-time reveal clears the staged state.
  const revealed = parse(
    await handler(
      event({
        path: "/api/me/gateway-env",
        cookie: memberCookie,
        body: { id },
      }),
    ),
  );
  assert.match(revealed.env, /^emcg_/, "the operator gets the raw token once");
  row = (await list()).gateways.find((g) => g.gateway_id === id);
  assert.equal(row.provision_ready, false, "staged state clears on reveal");

  // The owner's own collector: the admin list points at their own reveal.
  const own = parse(
    await handler(
      event({
        path: "/api/gateways",
        cookie: bossCookie,
        body: { name: "regress-boss-nas" },
      }),
    ),
  );
  await handler(
    event({
      path: "/api/admin/gateways",
      cookie: bossCookie,
      body: { gateway_id: own.gateway_id, action: "provision_token" },
    }),
  );
  const mine = (await list()).gateways.find(
    (g) => g.gateway_id === own.gateway_id,
  );
  assert.equal(mine.provision_ready, true);
  assert.equal(
    mine.owner_is_me,
    true,
    "the admin owns this one: the reveal is theirs",
  );
});

test("the address is kept, and sign-in fills it in for older accounts", async () => {
  const hash = emailHash(NEWCOMER.toLowerCase());
  const kept = await db.query(
    `select email, status from account where email_hash = $1`,
    [hash],
  );
  assert.equal(kept.rows[0].status, "approved");
  assert.equal(
    kept.rows[0].email,
    NEWCOMER.toLowerCase(),
    "we keep the address so we can write to this person again",
  );

  // An account approved before addresses were kept has none, and cannot
  // be told retroactively. Signing in records it.
  await db.query(`update account set email = null where email_hash = $1`, [
    hash,
  ]);
  await handler(event({ path: "/api/auth", body: { email: NEWCOMER } }));
  const backfilled = await db.query(
    `select email from account where email_hash = $1`,
    [hash],
  );
  assert.equal(backfilled.rows[0].email, NEWCOMER.toLowerCase());
});

// --------------------------------------------------------------- #14
test("an admin cannot deny the owner or a peer out of the service", async () => {
  // Reported: /api/admin/decide checked only that the ACTOR was an
  // admin. An admin could read the owner's email hash off
  // /api/admin/accounts and deny them, revoking a live owner session —
  // the very move /api/admin/accounts refuses for role changes.
  const ADMIN = "decide-admin@example.com";
  const PEER = "decide-peer@example.com";
  const PLAIN = "decide-plain@example.com";
  for (const [addr, role] of [
    [ADMIN, "admin"],
    [PEER, "admin"],
    [PLAIN, "member"],
  ]) {
    await db.query(
      `insert into account (email_hash, status, role) values ($1, 'approved', $2)`,
      [emailHash(addr), role],
    );
  }
  const adminCookie = await signIn(ADMIN, "203.0.113.14");

  const atOwner = await handler(
    event({
      path: "/api/admin/decide",
      cookie: adminCookie,
      body: { email_hash: emailHash(JAMIE), decision: "denied" },
    }),
  );
  assert.equal(atOwner.statusCode, 403, atOwner.body);
  assert.equal(parse(atOwner).error, "owner_protected");
  const { rows: owner } = await db.query(
    `select status from account where email_hash = $1`,
    [emailHash(JAMIE)],
  );
  assert.equal(owner[0].status, "approved", "the owner keeps their access");

  const atPeer = await handler(
    event({
      path: "/api/admin/decide",
      cookie: adminCookie,
      body: { email_hash: emailHash(PEER), decision: "denied" },
    }),
  );
  assert.equal(atPeer.statusCode, 403);
  assert.equal(parse(atPeer).error, "admin_protected");

  // Ordinary moderation is untouched.
  const atPlain = await handler(
    event({
      path: "/api/admin/decide",
      cookie: adminCookie,
      body: { email_hash: emailHash(PLAIN), decision: "denied" },
    }),
  );
  assert.equal(atPlain.statusCode, 200);
  assert.equal(parse(atPlain).status, "denied");
});

// --------------------------------------------------------------- #16
test("a losing racer cannot overwrite or publish another account's collection", async () => {
  // Reported: the ownership precheck ran in its own SELECT while the
  // upsert's ON CONFLICT had no ownership predicate. Racing another
  // account's creation of the same slug let the loser rewrite the
  // winner's row — including flipping it public and exposing members.
  const OWNER_A = "race-a@example.com";
  const OWNER_B = "race-b@example.com";
  for (const addr of [OWNER_A, OWNER_B]) {
    await db.query(
      `insert into account (email_hash, status, role) values ($1, 'approved', 'family')`,
      [emailHash(addr)],
    );
  }
  const cookieB = await signIn(OWNER_B, "203.0.113.16");
  const { rows: a } = await db.query(
    `select account_id from account where email_hash = $1`,
    [emailHash(OWNER_A)],
  );

  const other = new pg.Client({ connectionString: DB_URL });
  await other.connect();
  try {
    // A's creation is in flight and holds the slug's unique conflict.
    await other.query("begin");
    const { rows: col } = await other.query(
      `insert into collection (slug, title, kind, owner_account, visibility)
       values ('contested', 'A private list', 'player', $1, 'private')
       returning collection_id`,
      [a[0].account_id],
    );
    await other.query(
      `insert into collection_member (collection_id, subject_tag) values ($1, '#2YG98VVQ')`,
      [col[0].collection_id],
    );

    // B's precheck sees nothing committed, so it proceeds to the insert
    // and blocks there. Let A commit underneath it.
    const racing = handler(
      event({
        path: "/api/me/collections",
        cookie: cookieB,
        body: {
          action: "upsert",
          slug: "contested",
          title: "Changed by other account",
          kind: "player",
          visibility: "public",
        },
      }),
    );
    await new Promise((r) => setTimeout(r, 250));
    await other.query("commit");
    const res = await racing;

    assert.equal(res.statusCode, 403, res.body);
    const { rows: after } = await db.query(
      `select title, visibility, owner_account from collection where slug = 'contested'`,
    );
    assert.equal(after[0].title, "A private list", "title untouched");
    assert.equal(after[0].visibility, "private", "still not published");
    assert.equal(after[0].owner_account, a[0].account_id);
  } finally {
    await other.end();
  }
});

// --------------------------------------------------------------- #17
test("two concurrent adds through the route both keep their member", async () => {
  const OWNER_C = "route-add@example.com";
  await db.query(
    `insert into account (email_hash, status, role) values ($1, 'approved', 'family')`,
    [emailHash(OWNER_C)],
  );
  const cookie = await signIn(OWNER_C, "203.0.113.17");
  const created = await handler(
    event({
      path: "/api/me/collections",
      cookie,
      body: {
        action: "upsert",
        slug: "roster-sync",
        title: "Roster",
        kind: "player",
      },
    }),
  );
  assert.equal(created.statusCode, 200, created.body);

  const [one, two] = await Promise.all([
    handler(
      event({
        path: "/api/me/collections",
        cookie,
        body: { action: "add", slug: "roster-sync", tags: ["#RRR8LP2V"] },
      }),
    ),
    handler(
      event({
        path: "/api/me/collections",
        cookie,
        body: { action: "add", slug: "roster-sync", tags: ["#QQQ9UV20"] },
      }),
    ),
  ]);
  assert.equal(one.statusCode, 200);
  assert.equal(two.statusCode, 200);
  const { rows: mem } = await db.query(
    `select m.subject_tag from collection_member m
     join collection c on c.collection_id = m.collection_id
     where c.slug = 'roster-sync' order by m.subject_tag`,
  );
  assert.deepEqual(
    mem.map((r) => r.subject_tag).sort(),
    ["#QQQ9UV20", "#RRR8LP2V"],
    "an add must never drop the other add's member",
  );

  // --------------------------------------------------------------- #19
  // Deleting the collection settles the recordings it was the only
  // reason for, rather than leaving them scheduled forever.
  const active = async () =>
    (
      await db.query(
        `select count(*)::int as n from recording
         where subject_type = 'player' and status = 'active'
           and subject_tag = any($1::text[])`,
        [["#RRR8LP2V", "#QQQ9UV20"]],
      )
    ).rows[0].n;
  assert.equal(await active(), 2, "membership means recording");
  const gone = await handler(
    event({
      path: "/api/me/collections",
      cookie,
      body: { action: "delete", slug: "roster-sync" },
    }),
  );
  assert.equal(gone.statusCode, 200);
  assert.equal(await active(), 0, "deleting the collection stopped them");
});

// --------------------------------------------------------------- #18
test("raising a collection's scope deepens the members it already has", async () => {
  const OWNER_D = "scope-up@example.com";
  await db.query(
    `insert into account (email_hash, status, role) values ($1, 'approved', 'family')`,
    [emailHash(OWNER_D)],
  );
  const cookie = await signIn(OWNER_D, "203.0.113.18");
  const upsert = (scope) =>
    handler(
      event({
        path: "/api/me/collections",
        cookie,
        body: {
          action: "upsert",
          slug: "depth",
          title: "Depth",
          kind: "player",
          scope,
        },
      }),
    );
  assert.equal((await upsert("activity")).statusCode, 200);
  await handler(
    event({
      path: "/api/me/collections",
      cookie,
      body: { action: "add", slug: "depth", tags: ["#9VUP08YL"] },
    }),
  );
  const scopeOf = async () =>
    (
      await db.query(
        `select scope from recording where subject_type = 'player'
         and subject_tag = '#9VUP08YL' and status = 'active'`,
      )
    ).rows[0]?.scope;
  assert.equal(await scopeOf(), "activity");

  assert.equal((await upsert("comprehensive")).statusCode, 200);
  assert.equal(
    await scopeOf(),
    "comprehensive",
    "the promise of battle history has to reach the existing member",
  );
});

test("removing a clan you added leaves a collection's clan recording alone", async () => {
  // Jamie, 2026-09-07: removing personally-added clans that are also in
  // a collection. settleClanRecording counted account_clan and nothing
  // else, so this removal stopped a clan the collection still curated.
  const OWNER_E = "clan-collection@example.com";
  await db.query(
    `insert into account (email_hash, status, role) values ($1, 'approved', 'family')`,
    [emailHash(OWNER_E)],
  );
  const cookie = await signIn(OWNER_E, "203.0.113.19");
  const CLAN = "#P2P2Y880";

  const added = await handler(
    event({
      path: "/api/me/clans",
      cookie,
      body: { action: "add", clan_tag: CLAN, scope: "comprehensive" },
    }),
  );
  assert.equal(added.statusCode, 200, added.body);

  // The same clan is also curated in a collection.
  const { rows: acct } = await db.query(
    `select account_id from account where email_hash = $1`,
    [emailHash(OWNER_E)],
  );
  const { rows: col } = await db.query(
    `insert into collection (slug, title, kind, owner_account, scope)
     values ('watched-clans', 'Watched', 'clan', $1, 'comprehensive')
     returning collection_id`,
    [acct[0].account_id],
  );
  await db.query(
    `insert into collection_member (collection_id, subject_tag) values ($1, $2)`,
    [col[0].collection_id, CLAN],
  );

  const active = async () =>
    (
      await db.query(
        `select count(*)::int as n from recording
         where subject_type = 'clan' and subject_tag = $1 and status = 'active'`,
        [CLAN],
      )
    ).rows[0].n;
  assert.equal(await active(), 1);

  const removed = await handler(
    event({
      path: "/api/me/clans",
      cookie,
      body: { action: "remove", clan_tag: CLAN },
    }),
  );
  assert.equal(removed.statusCode, 200);
  assert.equal(parse(removed).removed, true, "the account association is gone");
  assert.equal(
    parse(removed).recording_stopped,
    false,
    "the collection is still a reason to record it",
  );
  assert.equal(await active(), 1, "the clan is still being recorded");

  // And once the collection lets go, nothing wants it and it stops.
  await db.query(`delete from collection_member where collection_id = $1`, [
    col[0].collection_id,
  ]);
  await handler(
    event({
      path: "/api/me/clans",
      cookie,
      body: { action: "add", clan_tag: CLAN, scope: "comprehensive" },
    }),
  );
  const gone = await handler(
    event({
      path: "/api/me/clans",
      cookie,
      body: { action: "remove", clan_tag: CLAN },
    }),
  );
  assert.equal(parse(gone).recording_stopped, true);
  assert.equal(await active(), 0);
});

// --------------------------------------------------------------- #27
test("beta accounts are enrolled by default, and an opt-out is never overridden", async () => {
  const READER = "newsletter@example.com";
  await db.query(
    `insert into account (email_hash, status, role) values ($1, 'approved', 'member')`,
    [emailHash(READER)],
  );
  const cookie = await signIn(READER, "203.0.113.27");

  // Opt-OUT by policy (0051): this is a hand-approved private beta and
  // taking part includes the product email. The login send carries the
  // enrollment with it.
  assert.equal(
    sentEmails.at(-1).newsletter,
    true,
    "a beta sign-in enrolls the address",
  );
  const me = parse(
    await handler(
      event({ method: "GET", path: "/api/me", cookie, body: undefined }),
    ),
  );
  assert.equal(me.newsletter_opt_in, true, "and the account says so");

  // There is deliberately NO in-app control. A switch that stops future
  // enrollment without unsubscribing you from Buttondown would be a
  // control that lies about what it does; the unsubscribe link in every
  // issue is the one mechanism.
  const gone = await handler(
    event({ path: "/api/me/newsletter", cookie, body: { opt_in: false } }),
  );
  assert.equal(gone.statusCode, 404, "no endpoint claims to unsubscribe you");

  // The suppression that matters is Buttondown's own, and the relay
  // never overrides it - an address that already exists there, whether
  // subscribed or unsubscribed, is left exactly as it is. Pinned in the
  // relay suite; asserted here as the contract this endpoint relies on.
  const newcomer = "newsletter-2@example.com";
  await db.query(
    `insert into account (email_hash, status, role) values ($1, 'approved', 'member')`,
    [emailHash(newcomer)],
  );
  await handler(
    event({ path: "/api/auth", body: { email: newcomer }, ip: "203.0.113.33" }),
  );
  assert.equal(sentEmails.at(-1).newsletter, true);
});

// --------------------------------------------------------------- #29
test("a refused role change is not reported, logged, or announced as one", async () => {
  const ADMIN_ACTOR = "role-admin@example.com";
  const PEER = "role-peer@example.com";
  await db.query(
    `insert into account (email_hash, status, role) values ($1, 'approved', 'admin')`,
    [emailHash(ADMIN_ACTOR)],
  );
  const {
    rows: [peer],
  } = await db.query(
    `insert into account (email_hash, status, role) values ($1, 'approved', 'admin')
     returning account_id`,
    [emailHash(PEER)],
  );
  const cookie = await signIn(ADMIN_ACTOR, "203.0.113.29");

  // One admin may not demote another - the hierarchy now rides in the
  // predicate of the write, so the refusal and the check are one act.
  const refused = await handler(
    event({
      path: "/api/admin/accounts",
      cookie,
      body: { account_id: peer.account_id, role: "member" },
    }),
  );
  assert.equal(refused.statusCode, 403);
  const { rows: after } = await db.query(
    `select role from account where account_id = $1`,
    [peer.account_id],
  );
  assert.equal(after[0].role, "admin", "the peer is untouched");
  const { rows: logged } = await db.query(
    `select 1 from account_event where account_id = $1 and kind = 'role_changed'`,
    [peer.account_id],
  );
  assert.equal(logged.length, 0, "a refusal is not logged as a change");
  const { rows: announced } = await db.query(
    `select 1 from event_feed where account_id = $1 and topic = 'role_changed'`,
    [peer.account_id],
  );
  assert.equal(announced.length, 0, "and never announced to the target");

  // A malformed account_id is a 404, not a Postgres uuid error as a 500.
  const malformed = await handler(
    event({
      path: "/api/admin/accounts",
      cookie,
      body: { account_id: "not-a-uuid", role: "member" },
    }),
  );
  assert.equal(malformed.statusCode, 404);
  const missing = await handler(
    event({
      path: "/api/admin/accounts",
      cookie,
      body: {
        account_id: "00000000-0000-0000-0000-000000000000",
        role: "member",
      },
    }),
  );
  assert.equal(missing.statusCode, 404);
});

// --------------------------------------------------------------- #28
test("one operator cannot read another operator's machine label", async () => {
  const OPERATOR = "gw-operator@example.com";
  const SNOOP = "gw-snoop@example.com";
  const {
    rows: [op],
  } = await db.query(
    `insert into account (email_hash, status, role) values ($1, 'approved', 'member')
     returning account_id`,
    [emailHash(OPERATOR)],
  );
  await db.query(
    `insert into account (email_hash, status, role) values ($1, 'approved', 'member')`,
    [emailHash(SNOOP)],
  );
  // A label of exactly the kind that makes this matter: a hostname with
  // a username and a location in it.
  await db.query(
    `insert into gateway (owner_account_id, name, status, fetch_points, card_name)
     values ($1, 'jamies-imac-basement', 'active', 40, 'Mega Knight')`,
    [op.account_id],
  );
  const snoopCookie = await signIn(SNOOP, "203.0.113.28");

  const ladder = await handler(
    event({
      method: "GET",
      path: "/api/gateways/ladder",
      cookie: snoopCookie,
      body: undefined,
    }),
  );
  assert.equal(ladder.statusCode, 200);
  assert.ok(
    !ladder.body.includes("jamies-imac-basement"),
    "the machine label is nowhere in the response",
  );
  const row = parse(ladder).ladder.find((g) => g.card === "Mega Knight");
  assert.ok(row, "the collector is still on the ladder under its card");
  assert.equal(row.mine, false, "and it is not the snoop's");
  assert.ok(!("machine" in row));

  // The operator still sees their own, on their own surface.
  const opCookie = await signIn(OPERATOR, "203.0.113.30");
  const own = parse(
    await handler(
      event({
        method: "GET",
        path: "/api/me/gateways",
        cookie: opCookie,
        body: undefined,
      }),
    ),
  );
  assert.ok(
    own.gateways.some((g) => g.name === "jamies-imac-basement"),
    "your own machine label is yours to see",
  );
  const ownLadder = parse(
    await handler(
      event({
        method: "GET",
        path: "/api/gateways/ladder",
        cookie: opCookie,
        body: undefined,
      }),
    ),
  );
  assert.equal(
    ownLadder.ladder.find((g) => g.card === "Mega Knight").mine,
    true,
    "an operator can still pick their own row out of the ladder",
  );
});

// --------------------------------------------------------------- #31
test("a staged collector credential expires, and is claimed by POST only", async () => {
  const OP = "stage-op@example.com";
  const {
    rows: [acct],
  } = await db.query(
    `insert into account (email_hash, status, role) values ($1, 'approved', 'member')
     returning account_id`,
    [emailHash(OP)],
  );
  const cookie = await signIn(OP, "203.0.113.31");
  const stage = async (name, expiresSql) => {
    const {
      rows: [g],
    } = await db.query(
      `insert into gateway (owner_account_id, name, status, provision_env,
                            provision_expires_at)
       values ($1, $2, 'pending', 'ELIXIR_TOKEN=emcg_staged', ${expiresSql})
       returning gateway_id`,
      [acct.account_id, name],
    );
    return g.gateway_id;
  };

  // A GET must not spend the credential: link scanners, prefetch and
  // cross-site top-level navigation all issue GETs, and SameSite=Lax
  // sends the session cookie with them.
  const live = await stage("stage-live", "now() + interval '72 hours'");
  const viaGet = await handler({
    ...event({ path: "/api/me/gateway-env", cookie, body: undefined }),
    requestContext: { http: { method: "GET", sourceIp: "8.8.4.4" } },
    queryStringParameters: { id: live },
  });
  assert.notEqual(viaGet.statusCode, 200, "a GET never claims");
  const { rows: untouched } = await db.query(
    `select provision_env from gateway where gateway_id = $1`,
    [live],
  );
  assert.ok(untouched[0].provision_env, "and leaves the secret staged");

  // The POST needs the web contract header, like every other mutation.
  const noHeader = await handler(
    event({
      path: "/api/me/gateway-env",
      cookie,
      contractHeader: false,
      body: { id: live },
    }),
  );
  assert.equal(noHeader.statusCode, 401);

  // The real claim works, once, and refuses to be cached anywhere.
  const claimed = await handler(
    event({ path: "/api/me/gateway-env", cookie, body: { id: live } }),
  );
  assert.equal(claimed.statusCode, 200);
  assert.match(parse(claimed).env, /emcg_staged/);
  assert.equal(claimed.headers["cache-control"], "no-store");
  const repeat = await handler(
    event({ path: "/api/me/gateway-env", cookie, body: { id: live } }),
  );
  assert.equal(repeat.statusCode, 404, "one-time means one time");

  // An expired stage is not claimable at all - this is the window that
  // used to have no end.
  const stale = await stage("stage-stale", "now() - interval '1 minute'");
  const tooLate = await handler(
    event({ path: "/api/me/gateway-env", cookie, body: { id: stale } }),
  );
  assert.equal(tooLate.statusCode, 404, "the staging window closed");
  const { rows: still } = await db.query(
    `select provision_env from gateway where gateway_id = $1`,
    [stale],
  );
  assert.ok(still[0].provision_env, "refused, but the sweep is what clears it");

  // A stage with no clock fails CLOSED rather than living forever.
  const clockless = await stage("stage-clockless", "null");
  assert.equal(
    (
      await handler(
        event({ path: "/api/me/gateway-env", cookie, body: { id: clockless } }),
      )
    ).statusCode,
    404,
    "no expiry reads as expired, never as unlimited",
  );

  // And an expired stage does not advertise itself as ready.
  const mine = parse(
    await handler(
      event({
        method: "GET",
        path: "/api/me/gateways",
        cookie,
        body: undefined,
      }),
    ),
  );
  assert.equal(
    mine.gateways.find((g) => g.name === "stage-stale").provision_ready,
    false,
    "provision_ready means claimable, not merely staged",
  );
});

test("re-provisioning invalidates the previous bearer in the same statement", async () => {
  const OWNER_G = "reprov@example.com";
  await db.query(
    `insert into account (email_hash, status, role, is_owner)
     values ($1, 'approved', 'owner', true)`,
    [emailHash(OWNER_G)],
  );
  const ownerCookie = await signIn(OWNER_G, "203.0.113.32");
  const {
    rows: [g],
  } = await db.query(
    `insert into gateway (owner_account_id, name, status)
     values ((select account_id from account where email_hash = $1),
             'reprov-box', 'pending')
     returning gateway_id`,
    [emailHash(OWNER_G)],
  );
  const provision = () =>
    handler(
      event({
        path: "/api/admin/gateways",
        cookie: ownerCookie,
        body: { action: "provision_token", gateway_id: g.gateway_id },
      }),
    );
  assert.equal((await provision()).statusCode, 200);
  const { rows: first } = await db.query(
    `select token_hash, provision_env, provision_expires_at from gateway where gateway_id = $1`,
    [g.gateway_id],
  );
  assert.ok(first[0].provision_expires_at > new Date(), "staged with a clock");

  assert.equal((await provision()).statusCode, 200);
  const { rows: second } = await db.query(
    `select token_hash, provision_env from gateway where gateway_id = $1`,
    [g.gateway_id],
  );
  assert.notEqual(
    second[0].token_hash,
    first[0].token_hash,
    "the old bearer stops working the moment a new one is minted",
  );
  assert.notEqual(second[0].provision_env, first[0].provision_env);
});

/**
 * claim.relationship had a reader and no writer.
 *
 * 0055 added the column and describeIdentity groups the MCP identity block by
 * it, so an agent is told "you are watching N players". Nothing could ever set
 * it -- no console control, no API action, no MCP tool -- so every non-primary
 * player was announced as "watching" from the day it shipped, and the
 * alt/friend vocabulary in the docs described something unreachable.
 */
test("a claim's relationship can be set, and primary is not one of them", async () => {
  const cookie = await signIn(JAMIE);
  await handler(
    event({ path: "/api/claims", cookie, body: { player_tag: "#20JJJ2CCRU" } }),
  );
  await handler(
    event({
      path: "/api/claims",
      cookie,
      body: { player_tag: "#9U82PLQ", make_primary: true },
    }),
  );

  const set = await handler(
    event({
      path: "/api/claims",
      cookie,
      body: {
        action: "relationship",
        player_tag: "#20JJJ2CCRU",
        relationship: "alt",
      },
    }),
  );
  assert.equal(set.statusCode, 200, set.body);
  const me = parse(
    await handler(event({ method: "GET", path: "/api/me", cookie })),
  );
  const claim = me.claims.find((c) => c.player_tag === "#20JJJ2CCRU");
  assert.equal(claim.relationship, "alt", "and /api/me reports it back");

  // 'primary' is not settable here: exactly one claim is primary and
  // promoting one must demote the other, which make_primary does atomically.
  const bad = await handler(
    event({
      path: "/api/claims",
      cookie,
      body: {
        action: "relationship",
        player_tag: "#20JJJ2CCRU",
        relationship: "primary",
      },
    }),
  );
  assert.equal(bad.statusCode, 400);

  // And renaming the primary is refused rather than leaving an account with
  // no primary at all.
  const onPrimary = await handler(
    event({
      path: "/api/claims",
      cookie,
      body: {
        action: "relationship",
        player_tag: "#9U82PLQ",
        relationship: "friend",
      },
    }),
  );
  assert.equal(onPrimary.statusCode, 404);
});

/**
 * A connection has to say what it has DONE, not merely that it exists.
 *
 * The list showed client name, scope and "last active" — which read
 * last_token_at, i.e. when the client last collected a token. A client that
 * refreshes on a timer looks busy by that measure while having answered
 * nothing for weeks, and a person holding several connections could not tell
 * which one was doing the work or where from.
 */
test("connections report their own usage, origin, and refused credentials", async () => {
  const cookie = memberCookie;
  const { rows: acct } = await db.query(
    `select account_id from account where email_hash = $1`,
    [emailHash(NEWCOMER)],
  );
  const accountId = acct[0].account_id;
  await db.query(
    `insert into oauth_client (client_id, client_name, redirect_uris, expires_at)
     values ('cid-usage', 'Claude Desktop', '[]', now() + interval '30 days')
     on conflict (client_id) do nothing`,
  );
  const { rows: fam } = await db.query(
    `insert into oauth_family (client_id, account_id, absolute_expires_at, scope)
     values ('cid-usage', $1, now() + interval '30 days', 'cr:read')
     returning family_id`,
    [accountId],
  );
  const familyId = fam[0].family_id;

  // One call under that grant, from a known address, and one older call that
  // must not count toward the seven-day figure.
  await db.query(
    `insert into mcp_call_audit
       (account_id, oauth_family_id, surface, tool, viewer_ip, viewer_country, created_at)
     values ($1, $2, 'mcp', 'war_current', '203.0.113.9', 'GB', now()),
            ($1, $2, 'mcp', 'war_current', '198.51.100.4', 'DE', now() - interval '30 days')`,
    [accountId, familyId],
  );
  // And a credential of theirs still being presented after it stopped working.
  await db.query(
    `insert into credential_refusal
       (credential_hash, account_id, kind, reason, attempts, viewer_ip, viewer_country)
     values ('deadbeef', $1, 'access_token', 'revoked_key', 12, '203.0.113.9', 'GB')`,
    [accountId],
  );

  const listed = parse(
    await handler(
      event({
        method: "GET",
        path: "/api/me/connections",
        cookie,
        body: undefined,
      }),
    ),
  );
  const mine = listed.connections.find((c) => c.family_id === familyId);
  assert.ok(mine, "the grant is listed");
  assert.equal(mine.usage.calls_7d, 1, "the month-old call is not this week's");
  assert.equal(
    mine.usage.ip,
    "203.0.113.9",
    "most recent origin, not the oldest",
  );
  assert.equal(mine.usage.country, "GB");
  assert.ok(mine.usage.at, "and when it last actually called");

  assert.equal(listed.refusals.length, 1);
  assert.equal(listed.refusals[0].reason, "revoked_key");
  assert.equal(listed.refusals[0].attempts, 12);
});

// --- hardening batch 2026-09-09 ------------------------------------------

test("usage reports the tier's real ceilings, not member's hardcoded ones", async () => {
  const cookie = memberCookie;
  const { roleQuotas } = await import("@elixir-mcp/contracts");
  const usageFor = async () =>
    parse(
      await handler(
        event({
          method: "GET",
          path: "/api/me/usage",
          cookie,
          body: undefined,
        }),
      ),
    );
  await db.query(`update account set role = 'leader' where email_hash = $1`, [
    emailHash(NEWCOMER),
  ]);
  const leader = await usageFor();
  assert.equal(leader.live_max, roleQuotas("leader").live_fetches_per_day);
  assert.equal(leader.quota_max, roleQuotas("leader").mcp_calls_per_day);
  await db.query(
    `update account set role = 'family', live_daily_quota = 7 where email_hash = $1`,
    [emailHash(NEWCOMER)],
  );
  const family = await usageFor();
  assert.equal(family.live_max, 7, "a per-account override beats the tier");
  assert.equal(family.quota_max, roleQuotas("family").mcp_calls_per_day);
  await db.query(
    `update account set role = 'member', live_daily_quota = null where email_hash = $1`,
    [emailHash(NEWCOMER)],
  );
});

test("malformed ids are 400s, never uuid or bigint syntax errors", async () => {
  const cookie = memberCookie;

  for (const p of ["rotate", "rename", "status"]) {
    const res = await handler(
      event({
        path: `/api/me/principals/${p}`,
        cookie,
        body: { account_id: "not-a-uuid", name: "x", status: "suspended" },
      }),
    );
    assert.equal(res.statusCode, 400, p);
    assert.equal(parse(res).error, "invalid_account_id", p);
  }
  const events = await handler({
    ...event({
      method: "GET",
      path: "/api/me/principals/events",
      cookie,
      body: undefined,
    }),
    queryStringParameters: { account_id: "nope" },
  });
  assert.equal(events.statusCode, 400);
  const revoke = await handler(
    event({
      path: "/api/admin/service-tokens",
      cookie: bossCookie,
      body: { revoke_token_id: "abc" },
    }),
  );
  assert.equal(revoke.statusCode, 400);
  assert.equal(parse(revoke).error, "invalid_token_id");
  const fb = await handler(
    event({
      path: "/api/admin/feedback",
      cookie: bossCookie,
      body: { feedback_id: "1; drop", status: "seen" },
    }),
  );
  assert.equal(fb.statusCode, 400);
});

test("the explorer is metered and capped like the MCP door, and read-only", async () => {
  const cookie = memberCookie;
  const { rows: acct } = await db.query(
    `select account_id from account where email_hash = $1`,
    [emailHash(NEWCOMER)],
  );
  const accountId = acct[0].account_id;
  const call = (tool, args = {}) =>
    handler(event({ path: "/api/explore", cookie, body: { tool, args } }));

  // Read-only tools serve; writes other than the console's nickname editor
  // are refused before any quota is spent.
  assert.equal((await call("elixir_my_players")).statusCode, 200);
  for (const w of [
    "elixir_add_player",
    "elixir_add_clan",
    "collections_edit",
    "elixir_identify",
  ])
    assert.equal((await call(w)).statusCode, 400, w);
  assert.equal(
    (await call("elixir_nickname", { player_tag: "#PYGRJC" })).statusCode,
    200,
  );

  // The daily quota is the account's, shared with /mcp: fill it and the
  // explorer refuses too.
  const today = new Date().toISOString().slice(0, 10);
  await db.query(
    `insert into rate_limit (bucket, window_start, count) values ($1, $2::date, 100000)
     on conflict (bucket, window_start) do update set count = 100000`,
    [`mcpday#${accountId}`, today],
  );
  const quota = await call("elixir_my_players");
  assert.equal(quota.statusCode, 429);
  assert.equal(parse(quota).error, "quota_exceeded");
  await db.query(`delete from rate_limit where bucket = $1`, [
    `mcpday#${accountId}`,
  ]);

  // The hourly bucket too (same bucket as the MCP door).
  const { rows: hourly } = await db.query(
    `select bucket, window_start from rate_limit where bucket = $1 order by window_start desc limit 1`,
    [`mcp#${accountId}`],
  );
  assert.equal(
    hourly.length,
    1,
    "explorer calls count against the hourly bucket",
  );
  await db.query(
    `update rate_limit set count = 100000 where bucket = $1 and window_start = $2`,
    [hourly[0].bucket, hourly[0].window_start],
  );
  const rate = await call("elixir_my_players");
  assert.equal(rate.statusCode, 429);
  assert.equal(parse(rate).error, "rate_limited");
  await db.query(`delete from rate_limit where bucket = $1`, [
    `mcp#${accountId}`,
  ]);

  // Arguments are validated on this door as well.
  const bad = parse(await call("battles_query", { limit: "ten" }));
  assert.equal(bad.is_error, true);
  assert.equal(bad.body.error.code, "bad_request");
});

test("an oversized explorer result is the same bounded failure the MCP door returns", async () => {
  const { MCP_RESULT_MAX_CHARS } = await import("../../mcp/src/protocol.mjs");
  const { renderToolResultText } = await import("../../mcp/src/protocol.mjs");
  const { makeRegistry } = await import("../../mcp/src/tools.mjs");
  const huge = {
    battles: "x".repeat(MCP_RESULT_MAX_CHARS + 1),
    meta: { as_of: new Date().toISOString() },
  };
  const { text, truncated } = renderToolResultText(
    makeRegistry(),
    "battles_query",
    huge,
  );
  assert.equal(truncated, true);
  const body = JSON.parse(text);
  assert.equal(body.error.code, "bad_request");
  assert.ok(text.length < MCP_RESULT_MAX_CHARS);
});

test("with an origin secret set, the site API refuses requests that did not come through CloudFront", async () => {
  const gated = makeHandler({
    databaseUrl: DB_URL,
    secret: SECRET,
    sendLoginEmail: async () => {},
    originSecret: "s3cret-origin",
  });
  const status = (headers = {}) => ({
    rawPath: "/api/public/status",
    requestContext: { http: { method: "GET", sourceIp: "1.1.1.1" } },
    headers,
  });
  assert.equal((await gated(status())).statusCode, 403);
  assert.equal(parse(await gated(status())).error, "forbidden_origin");
  assert.equal(
    (await gated(status({ "x-elixir-origin": "nope" }))).statusCode,
    403,
  );
  assert.equal(
    (await gated(status({ "x-elixir-origin": "s3cret-origin" }))).statusCode,
    200,
  );
  assert.equal(
    (await handler(status())).statusCode,
    200,
    "unset: check is off",
  );
});
