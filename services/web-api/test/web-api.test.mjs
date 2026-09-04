import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
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
    `insert into account (email_hash, status, is_owner) values ($1, 'approved', true)`,
    [emailHash(JAMIE)],
  );
  handler = makeHandler({
    databaseUrl: DB_URL,
    secret: SECRET,
    sendLoginEmail: async (m) => sentEmails.push(m),
    notifyOwner: async (n) => ownerNotes.push(n),
  });
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

async function signIn(email) {
  await handler(event({ path: "/api/auth", body: { email } }));
  const { code } = sentEmails.at(-1);
  const res = await handler(
    event({ path: "/api/auth/code", body: { email, code } }),
  );
  assert.equal(res.statusCode, 200);
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

  const claim = await handler(
    event({ path: "/api/claims", cookie, body: { player_tag: "#2PP0V90Y" } }),
  );
  assert.equal(parse(claim).ok, true);
  const rec = await handler(
    event({
      path: "/api/recordings",
      cookie,
      body: { player_tag: "#2PP0V90Y", action: "start" },
    }),
  );
  assert.equal(parse(rec).ok, true);

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

test("recording opt-in requires a claim on the tag", async () => {
  const cookie = newcomerCookie;
  const res = await handler(
    event({
      path: "/api/recordings",
      cookie,
      body: { player_tag: "#J2RGCRVG", action: "start" },
    }),
  );
  assert.equal(res.statusCode, 403);
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

test("owner enrolls and stops clan recordings; non-owners refused", async () => {
  const ownerCookie = await signIn(JAMIE);
  const start = await handler(
    event({
      path: "/api/admin/clans",
      cookie: ownerCookie,
      body: { clan_tag: "gq0ylcyj", action: "start" },
    }),
  );
  assert.equal(parse(start).clan_tag, "#GQ0YLCYJ", "normalized at the door");
  const list = parse(
    await handler(
      event({
        method: "GET",
        path: "/api/admin/clans",
        cookie: ownerCookie,
        body: undefined,
      }),
    ),
  );
  const row = list.clans.find((c) => c.clan_tag === "#GQ0YLCYJ");
  assert.equal(row.status, "active");
  const dupe = await handler(
    event({
      path: "/api/admin/clans",
      cookie: ownerCookie,
      body: { clan_tag: "#GQ0YLCYJ", action: "start" },
    }),
  );
  assert.equal(dupe.statusCode, 200, "idempotent");
  await handler(
    event({
      path: "/api/admin/clans",
      cookie: ownerCookie,
      body: { clan_tag: "#GQ0YLCYJ", action: "stop" },
    }),
  );
  const after = parse(
    await handler(
      event({
        method: "GET",
        path: "/api/admin/clans",
        cookie: ownerCookie,
        body: undefined,
      }),
    ),
  );
  assert.ok(
    after.clans.some(
      (c) => c.clan_tag === "#GQ0YLCYJ" && c.status === "stopped",
    ),
  );

  const nonOwner = await handler(
    event({
      path: "/api/admin/clans",
      cookie: newcomerCookie,
      body: { clan_tag: "#J2RGCRVG", action: "start" },
    }),
  );
  assert.equal(nonOwner.statusCode, 403);
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
    `insert into recording (subject_type, subject_tag, requested_by, status) values ('clan', $1, $2, 'active')`,
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
  const badIp = await handler(
    event({
      path: "/api/gateways",
      cookie,
      body: { name: "kitchen-mac", static_ip: "not-an-ip" },
    }),
  );
  assert.equal(badIp.statusCode, 400);

  const raise = parse(
    await handler(
      event({
        path: "/api/gateways",
        cookie,
        body: { name: "Kitchen-Mac", static_ip: "203.0.113.7" },
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

  // Cap: one active recording exists; drop the cap to 1 and try another.
  await db.query(
    `update account set max_player_recordings = 1 where email_hash = $1`,
    [emailHash(NEWCOMER)],
  );
  await handler(
    event({ path: "/api/claims", cookie, body: { player_tag: "#PLC220" } }),
  );
  const refused = await handler(
    event({
      path: "/api/recordings",
      cookie,
      body: { player_tag: "#PLC220", action: "start" },
    }),
  );
  assert.equal(refused.statusCode, 429);
  assert.match(parse(refused).message, /capped at 1/);
});

test("gateway ladder: points rank gateways with arena tiers; scoring rides admission", async () => {
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
  const top = ladder.ladder[0];
  assert.equal(top.name, "kitchen-mac");
  assert.equal(top.arena, "Barbarian Bandwidth");
  assert.equal(top.rank, 1);

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
  assert.equal(gw.arena.next.name, "Spell Valley Switch");
  assert.equal(gw.arena.next.points_needed, 5400);
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
  assert.equal(denied.is_error, true);

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

  const viaMcp = parse(
    await handler(
      event({
        path: "/api/explore",
        cookie,
        body: {
          tool: "elixir_feedback",
          args: { message: "battles_query filters rock", category: "praise" },
        },
      }),
    ),
  );
  assert.equal(viaMcp.is_error, false);
  assert.ok(viaMcp.body.feedback_id);

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
  assert.ok(list.feedback.some((f) => f.surface === "web"));
  assert.ok(list.feedback.some((f) => f.surface === "mcp"));
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
