import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import crypto from "node:crypto";
import { emailHash } from "../../../packages/auth/src/index.mjs";
import { makeHandler } from "../src/handler.mjs";
import { signUnsubscribe } from "@elixir-mcp/mail";
import {
  createScratch,
  dropScratch,
  waitUntilBlocked,
} from "../../../packages/ingest/test/helpers.mjs";

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
    path: p,
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      // The caller, as CloudFront delivers it: limits key on this.
      "cloudfront-viewer-address": `${ip}:443`,
      ...(contractHeader ? { "x-elixir-client": "web" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

const parse = (res) => JSON.parse(res.body);

before(async () => {
  await createScratch(NAME);
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
  await dropScratch(NAME);
});

// The sign-in door is rate limited per IP (10/hour) as well as per
// email, so a test that needs a fresh identity gets a fresh source IP.
async function signIn(email, ip = "8.8.4.4") {
  await handler(
    event({ path: "/api/auth", body: { age_13: true, email }, ip }),
  );
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

test("the full journey: sign up -> prove the address -> claim -> record", async () => {
  // 1. A newcomer signs up with the tag they play under. Signup is public
  // since the approval era retired (2026-11-12: no request form, no
  // queue); nothing is opened or claimed until the address is proved.
  const signup = await handler(
    event({
      path: "/api/auth",
      body: { age_13: true, email: NEWCOMER, player_tag: "09CV8UVL" },
    }),
  );
  assert.equal(parse(signup).ok, true);
  assert.equal(sentEmails.length, 1, "the code is mailed");
  assert.equal(ownerNotes.length, 0, "no staff notice: nobody decides");
  const { rows: none } = await db.query(
    `select 1 from account where email_hash = $1`,
    [emailHash(NEWCOMER)],
  );
  assert.equal(none.length, 0, "no account before the proof");

  // 2. The code proves the address and opens the account, with the
  // welcome sent to the newcomer.
  const { code } = sentEmails.at(-1);
  const proved = await handler(
    event({ path: "/api/auth/code", body: { email: NEWCOMER, code } }),
  );
  assert.equal(proved.statusCode, 200, proved.body);
  const cookie = proved.headers["set-cookie"].split(";")[0];
  newcomerCookie = cookie;
  assert.match(cookie, /^__Host-elixir_session=/);
  assert.deepEqual(
    welcomeEmails.map((m) => m.email),
    [NEWCOMER.toLowerCase()],
    "the welcome goes to the newcomer",
  );

  // 3. The account is NOT empty. The proof claims the tag they signed up
  // with and starts recording it (0065), so the newcomer's first act is
  // never typing in a tag they had already given us.
  const me = parse(
    await handler(
      event({ method: "GET", path: "/api/me", cookie, body: undefined }),
    ),
  );
  assert.equal(me.authenticated, true);
  assert.equal(me.is_owner, false);
  assert.equal(me.claims.length, 1, "the signup's player is already claimed");
  assert.equal(me.claims[0].player_tag, "#09CV8UVL");
  assert.equal(me.claims[0].is_primary, true);
  assert.equal(me.recordings.length, 1);
  assert.equal(me.recordings[0].status, "active");

  // Added = recorded: claiming a SECOND player still starts capture.
  await db.query(`update budget_state set tokens = 5`);
  const claim = await handler(
    event({ path: "/api/claims", cookie, body: { player_tag: "#0RGLUUV" } }),
  );
  assert.equal(parse(claim).ok, true);
  assert.equal(parse(claim).recording_started, true);
  // 2026-10-08: one free live read of the new tag's profile, and one
  // recording_started (the route used to log a second one of its own).
  assert.equal(parse(claim).first_read, true);
  assert.equal(parse(claim).not_found, false);
  // 2026-11-09: then its battle log, on the live lane too.
  const liveJobs = async () =>
    (
      await db.query(
        `select endpoint, lane from job where entity_key = '#0RGLUUV' order by job_id`,
      )
    ).rows;
  assert.deepEqual(await liveJobs(), [
    { endpoint: "player", lane: "live" },
    { endpoint: "player_battlelog", lane: "live" },
  ]);
  const { rows: started } = await db.query(
    `select count(*)::int as n from account_event
      where kind = 'recording_started' and detail->>'player_tag' = '#0RGLUUV'`,
  );
  assert.equal(started[0].n, 1);
  // Adding it again asks for nothing more: the job is open.
  const again = parse(
    await handler(
      event({ path: "/api/claims", cookie, body: { player_tag: "#0RGLUUV" } }),
    ),
  );
  assert.equal(again.first_read, false);
  assert.equal((await liveJobs()).length, 2, "no second job either way");

  const me2 = parse(
    await handler(
      event({ method: "GET", path: "/api/me", cookie, body: undefined }),
    ),
  );
  assert.equal(me2.claims.length, 2);
  assert.equal(
    me2.claims[0].is_primary,
    true,
    "the signup's claim stays primary",
  );
  assert.equal(me2.recordings.length, 2);
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
      path: "/api/admin/accounts",
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

test("the approval era's doors are gone (2026-11-12)", async () => {
  const ownerCookie = await signIn(JAMIE, "3.3.3.3");
  for (const [method, p, body] of [
    ["POST", "/api/request-access", { email: "someone@example.com" }],
    ["GET", "/api/admin/requests", undefined],
    ["POST", "/api/admin/decide", { email_hash: "x", decision: "approved" }],
    ["GET", "/api/admin/pulse", undefined],
  ]) {
    const res = await handler(
      event({ method, path: p, body, cookie: ownerCookie }),
    );
    assert.equal(res.statusCode, 404, `${method} ${p}`);
  }
});

// GET /api/clan is gone (2026-09-25: no caller; the console reads clans
// through /api/me/clans). This seeds the recorded clan and the two
// sign-ins the tests below rely on.
test("seed: a recorded clan the newcomer belongs to", async () => {
  memberCookie = await signIn(NEWCOMER);
  bossCookie = await signIn(JAMIE);

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
    `insert into player (player_tag, name) values ('#0GJU2', 'Rascal') on conflict do nothing`,
  );
  await db.query(
    `insert into clan_membership (clan_tag, player_tag, joined_observed_at, role)
     values ($1, '#09CV8UVL', now(), 'member'), ($1, '#0GJU2', now(), 'leader')`,
    [CLAN],
  );
  await db.query(
    `insert into war_week (clan_tag, season_id, section_index, is_colosseum) values ($1, 135, 3, true)`,
    [CLAN],
  );
  await db.query(
    `insert into war_week_clan (clan_tag, season_id, section_index, participant_clan_tag, participant_name, fame, rank)
     values ($1, 135, 3, $1, 'POAP KINGS', 5050, 2), ($1, 135, 3, '#00P8', 'Rivals', 6000, 1)`,
    [CLAN],
  );
});

// A collector that delivered an admitted fetch (ingest stamps
// last_success_at; the door's own test covers the promotion) and was then
// drained: proven, so it no longer holds back its operator's next raise,
// and not active, so later tests do not see an operator bonus.
async function deliveredThenDrained(name) {
  await db.query(
    `update gateway set status = 'draining', last_success_at = now()
     where name = $1 and status = 'probation'`,
    [name],
  );
}

test("open enrollment (#540): a raised hand is approved at once, token staged; the operator re-stages; the owner still drains and revokes", async () => {
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
  // Approved at once: probation is the state the door leases to, and the
  // token is staged for the operator's one-time reveal. No owner step.
  assert.equal(raise.status, "probation");
  assert.equal(raise.provision_ready, true);
  assert.equal(ownerNotes.length, notesBefore + 1, "owner still told");
  const gwId = raise.gateway_id;
  const { rows: born } = await db.query(
    `select status, token_hash, provision_env,
            provision_expires_at > now() + interval '71 hours' as fresh
     from gateway where gateway_id = $1`,
    [gwId],
  );
  assert.equal(born[0].status, "probation");
  assert.match(born[0].provision_env, /^emcg_/, "raw staged for the reveal");
  assert.equal(
    born[0].token_hash,
    crypto.createHash("sha256").update(born[0].provision_env).digest("hex"),
    "the staged raw is the token the door will accept",
  );
  assert.equal(born[0].fresh, true, "staged for 72 hours");

  const dupe = await handler(
    event({
      path: "/api/gateways",
      cookie,
      body: { name: "kitchen-mac", static_ip: "203.0.113.8" },
    }),
  );
  assert.equal(dupe.statusCode, 409, "names are unique among live gateways");

  // One unproven collector per account (Codex on #554): every raise
  // mints a usable token, and the door's limits are per collector.
  const second = await handler(
    event({ path: "/api/gateways", cookie, body: { name: "kitchen-pi" } }),
  );
  assert.equal(second.statusCode, 409);
  assert.equal(parse(second).error, "unproven_collector");
  assert.match(parse(second).message, /kitchen-mac/);

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
  const own = mine.gateways.find((g) => g.gateway_id === gwId);
  assert.equal(own.name, "kitchen-mac");
  assert.equal(own.provision_ready, true, "the operator's page offers it");

  // The Admin view still shows who enrolled, with the operator.
  const ownerCookie = bossCookie;
  const fleet = parse(
    await handler(
      event({
        method: "GET",
        path: "/api/admin/gateways",
        cookie: ownerCookie,
        body: undefined,
      }),
    ),
  );
  const listed = fleet.gateways.find((g) => g.gateway_id === gwId);
  assert.equal(listed.status, "probation");
  assert.equal(listed.owner_is_me, false);

  // The operator reveals it once.
  const reveal = parse(
    await handler(
      event({ path: "/api/me/gateway-env", cookie, body: { id: gwId } }),
    ),
  );
  assert.equal(reveal.env, born[0].provision_env);

  // Their own fresh token, no maintainer: it replaces the one revealed.
  // Another account (even the owner) cannot stage one for it here.
  const notTheirs = await handler(
    event({
      path: "/api/me/gateway-token",
      cookie: ownerCookie,
      body: { id: gwId },
    }),
  );
  assert.equal(notTheirs.statusCode, 404);
  const restaged = parse(
    await handler(
      event({ path: "/api/me/gateway-token", cookie, body: { id: gwId } }),
    ),
  );
  assert.equal(restaged.staged, true);
  const { rows: after } = await db.query(
    `select token_hash, provision_env from gateway where gateway_id = $1`,
    [gwId],
  );
  assert.notEqual(after[0].token_hash, born[0].token_hash, "old token dead");
  assert.equal(
    after[0].token_hash,
    crypto.createHash("sha256").update(after[0].provision_env).digest("hex"),
  );

  // Lifecycle moves stay owner-only.
  const nonOwner = await handler(
    event({
      path: "/api/admin/gateways",
      cookie,
      body: { gateway_id: gwId, action: "revoke" },
    }),
  );
  assert.equal(nonOwner.statusCode, 403);
  const drained = parse(
    await handler(
      event({
        path: "/api/admin/gateways",
        cookie: ownerCookie,
        body: { gateway_id: gwId, action: "drain" },
      }),
    ),
  );
  assert.equal(drained.status, "draining");
  const back = parse(
    await handler(
      event({
        path: "/api/admin/gateways",
        cookie: ownerCookie,
        body: { gateway_id: gwId, action: "probation" },
      }),
    ),
  );
  assert.equal(back.status, "probation");
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
  const deadToken = await handler(
    event({ path: "/api/me/gateway-token", cookie, body: { id: gwId } }),
  );
  assert.equal(deadToken.statusCode, 404, "a revoked collector stays dead");

  // A revoked gateway's name is free again.
  const again = await handler(
    event({
      path: "/api/gateways",
      cookie,
      body: { name: "kitchen-mac", static_ip: "203.0.113.7" },
    }),
  );
  assert.equal(again.statusCode, 200);

  // A drained collector that never delivered still counts; a proven one
  // never does.
  await db.query(
    `update gateway set status = 'draining'
     where name = 'kitchen-mac' and status = 'probation'`,
  );
  const stillHeld = await handler(
    event({ path: "/api/gateways", cookie, body: { name: "kitchen-pi" } }),
  );
  assert.equal(parse(stillHeld).error, "unproven_collector");
  await db.query(
    `update gateway set status = 'probation'
     where name = 'kitchen-mac' and status = 'draining'`,
  );
  await deliveredThenDrained("kitchen-mac");

  // Concurrent raises cannot all pass the check (Codex on #554): each
  // call here is its own connection, and exactly one may win.
  const race = await Promise.all(
    ["kitchen-pi", "kitchen-nas", "kitchen-nuc"].map((n) =>
      handler(event({ path: "/api/gateways", cookie, body: { name: n } })),
    ),
  );
  const won = race.filter((r) => r.statusCode === 200);
  assert.equal(won.length, 1, "one raise wins the race");
  for (const r of race.filter((x) => x.statusCode !== 200))
    assert.equal(parse(r).error, "unproven_collector");
  // Revoked, so it holds no card for the picker test below.
  await db.query(
    `update gateway set status = 'revoked' where gateway_id = $1`,
    [parse(won[0]).gateway_id],
  );
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
  // A Ladder read (the site's own: logged, never charged, #538), an
  // Clan read, a Clan morning read, a Console nickname edit (the
  // bridge's one write: uncharged, and not a read) and an /api/v1 call
  // (none of them spends the daily tool-call budget).
  await db.query(
    `insert into mcp_call_audit (account_id, tool, surface, client_name)
     values ($1, 'battles_query', 'web', null),
            ($1, 'clans_participation', 'web', 'Clan'),
            ($1, 'clans_roster', 'web', 'Clan morning'),
            ($1, 'elixir_nickname', 'web', null),
            ($1, 'players_summary', 'rest', null)`,
    [acct[0].account_id],
  );

  const mine = parse(
    await handler(
      event({ method: "GET", path: "/api/me/usage", cookie, body: undefined }),
    ),
  );
  assert.equal(mine.today_calls, 3, "what the daily limiter charged");
  assert.equal(
    mine.web_calls_today,
    1,
    "the Console's and Ladder's reads, counted apart and uncharged",
  );
  assert.equal(mine.days[0].web_calls, 1, "and on the day's row");
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
  const row = fleet.accounts.find((a) => a.primary_tag === "#09CV8UVL");
  assert.ok(
    Object.hasOwn(row, "primary_name"),
    "the label can name the player",
  );
  // The fleet view counts every recorded call, whatever spent the budget.
  assert.equal(row.calls_7d, 8);
  assert.equal(row.errors_7d, 1);
  assert.ok(fleet.tools.some((t) => t.tool === "battles_query"));
  // A day's capacity is the planner's bulk share, not rate x 86,400 (#64).
  assert.equal(fleet.budget.capacity_24h, 77760);

  const nonOwner = await handler(
    event({ method: "GET", path: "/api/admin/usage", cookie, body: undefined }),
  );
  assert.equal(nonOwner.statusCode, 403);
});

test("call record: own rows and owned agents' rows open; others 404; admin opens any; capture reads back", async () => {
  // A member's call, an agent-of-theirs' call, and somebody else's call.
  const cookie = memberCookie;
  const { rows: acct } = await db.query(
    `select account_id from account where email_hash = $1`,
    [emailHash(NEWCOMER)],
  );
  const me = acct[0].account_id;
  const { rows: agentRows } = await db.query(
    `insert into account (email_hash, status, kind, owned_by_account_id)
     values ('call-record-agent', 'approved', 'agent', $1) returning account_id`,
    [me],
  );
  const agent = agentRows[0].account_id;
  const { rows: strangerRows } = await db.query(
    `insert into account (email_hash, status) values ('call-record-stranger', 'approved')
     returning account_id`,
  );
  const stranger = strangerRows[0].account_id;
  const ids = {
    first: crypto.randomUUID(),
    mine: crypto.randomUUID(),
    later: crypto.randomUUID(),
    agents: crypto.randomUUID(),
    theirs: crypto.randomUUID(),
  };
  // Three calls by the console explorer on the member's account (same
  // credential: no token, no grant, surface web), in order.
  await db.query(
    `insert into mcp_call_audit
       (account_id, request_id, surface, tool, args, duration_ms, result_bytes,
        created_at, captured, db_ms, db_queries, live_wait_ms, serialize_ms,
        cold_start, principal_kind, on_behalf_of, client_name, viewer_country)
     values
       ($1, $2, 'web', 'game_clock', '{}', 12, 200, now() - interval '3 minutes',
        false, 1, 1, null, 0, true, 'person', null, null, 'US'),
       ($1, $3, 'web', 'war_current', '{"clan_tag":"#ABC"}', 340, 9000, now() - interval '2 minutes',
        true, 210, 7, 95, 3, false, 'person', 'discord:1', null, 'US'),
       ($1, $4, 'web', 'players_profile', '{}', 50, 300, now() - interval '1 minute',
        false, 20, 2, null, 1, false, 'person', null, null, 'US')`,
    [me, ids.first, ids.mine, ids.later],
  );
  await db.query(
    `insert into mcp_call_audit (account_id, request_id, surface, tool, principal_kind)
     values ($1, $2, 'mcp', 'clans_roster', 'agent')`,
    [agent, ids.agents],
  );
  await db.query(
    `insert into mcp_call_audit (account_id, request_id, surface, tool)
     values ($1, $2, 'mcp', 'clans_roster')`,
    [stranger, ids.theirs],
  );

  const get = (path, c = cookie, h = handler) =>
    h(event({ method: "GET", path, cookie: c, body: undefined }));

  // The row, with every 0063 column, and its neighbours by credential.
  const res = await get(`/api/me/activity/calls/${ids.mine}`);
  assert.equal(res.statusCode, 200, res.body);
  const rec = parse(res);
  assert.equal(rec.call.tool, "war_current");
  assert.equal(rec.call.request_id, ids.mine);
  assert.equal(rec.call.db_ms, 210);
  assert.equal(rec.call.db_queries, 7);
  assert.equal(rec.call.live_wait_ms, 95);
  assert.equal(rec.call.serialize_ms, 3);
  assert.equal(rec.call.cold_start, false);
  assert.equal(rec.call.principal_kind, "person");
  assert.equal(rec.call.on_behalf_of, "discord:1");
  assert.equal(rec.call.captured, true);
  assert.equal(
    rec.prev.request_id,
    ids.first,
    "previous by the same credential",
  );
  assert.equal(rec.next.request_id, ids.later, "next by the same credential");
  assert.equal(rec.call.viewer_ip, undefined, "the address is not served");
  // captured=true but this handler has no store: say so, never 500.
  assert.equal(rec.capture_error, "unconfigured");
  assert.equal(rec.request, null);

  // An owned agent's row opens; a stranger's does not exist here.
  assert.equal(
    (await get(`/api/me/activity/calls/${ids.agents}`)).statusCode,
    200,
  );
  assert.equal(
    (await get(`/api/me/activity/calls/${ids.theirs}`)).statusCode,
    404,
  );
  assert.equal(
    (await get(`/api/me/activity/calls/not-a-uuid`)).statusCode,
    404,
  );
  assert.equal(
    (await get(`/api/me/activity/calls/${ids.mine}/deeper`)).statusCode,
    404,
  );
  assert.equal(
    (
      await handler(
        event({
          method: "GET",
          path: `/api/me/activity/calls/${ids.mine}`,
          body: undefined,
        }),
      )
    ).statusCode,
    401,
  );

  // Admin: any row; a member is refused.
  assert.equal(
    (await get(`/api/admin/calls/${ids.theirs}`, bossCookie)).statusCode,
    200,
  );
  assert.equal(
    (await get(`/api/admin/calls/${ids.theirs}`, cookie)).statusCode,
    403,
  );

  // With a store, the captured body comes back through the same route,
  // gunzipped, under the same session check.
  const { gzipSync } = await import("node:zlib");
  const { captureKey } =
    await import("../../../packages/tools/src/capture.mjs");
  const stored = {
    request: { tool: "war_current", arguments: { clan_tag: "#ABC" } },
    response: { war: { day: 2 }, meta: { request_id: ids.mine } },
    timings: { db_ms: 210 },
    captured_at: "2026-09-10T12:00:00.000Z",
  };
  const asked = [];
  const fakeS3 = {
    send: async (cmd) => {
      asked.push(cmd.input.Key);
      const body = gzipSync(JSON.stringify(stored));
      return { Body: { transformToByteArray: async () => body } };
    },
  };
  const withStore = makeHandler({
    databaseUrl: DB_URL,
    secret: SECRET,
    sendLoginEmail: async () => {},
    capture: { s3: fakeS3, bucket: "archive" },
  });
  const full = parse(
    await get(`/api/me/activity/calls/${ids.mine}`, cookie, withStore),
  );
  assert.deepEqual(full.request, stored.request);
  assert.deepEqual(full.response, stored.response);
  assert.equal(full.captured_at, stored.captured_at);
  assert.equal(full.capture_error, undefined);
  // The key is rebuilt from the row's created_at, the way the writer built it.
  assert.equal(asked[0], captureKey(full.call.created_at, ids.mine));
  assert.match(asked[0], /^calls\/dt=\d{4}-\d{2}-\d{2}\/request_id=/);

  // A store that cannot find it: the row still answers.
  const missing = makeHandler({
    databaseUrl: DB_URL,
    secret: SECRET,
    sendLoginEmail: async () => {},
    capture: {
      s3: {
        send: async () => {
          throw new Error("NoSuchKey");
        },
      },
      bucket: "archive",
    },
  });
  const orig = console.error;
  console.error = () => {};
  try {
    const gone = parse(
      await get(`/api/me/activity/calls/${ids.mine}`, cookie, missing),
    );
    assert.equal(gone.call.tool, "war_current");
    assert.equal(gone.capture_error, "unavailable");
  } finally {
    console.error = orig;
  }
});

test("connections: list shows OAuth families; revoke disconnects; others' families untouchable", async () => {
  const cookie = memberCookie;
  const { rows: acct } = await db.query(
    `select account_id from account where email_hash = $1`,
    [emailHash(NEWCOMER)],
  );
  await db.query(
    `insert into oauth_client (client_id, client_name, redirect_uris, expires_at)
     values ('cid-test', 'Claude', '{}', now() + interval '30 days')`,
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
  // An event about a player or a clan is named at read time from the
  // record, so the console's DETAIL column never shows a tag alone.
  const claimed = act.events.find((e) => e.kind === "claim_added");
  const claimedTag = claimed.detail.player_tag;
  assert.ok(claimedTag);
  assert.equal(
    claimed.detail.subject_name,
    undefined,
    "unnamed until observed",
  );
  await db.query(`update player set name = 'Newcomer' where player_tag = $1`, [
    claimedTag,
  ]);
  const named = parse(
    await handler(
      event({
        method: "GET",
        path: "/api/me/activity",
        cookie,
        body: undefined,
      }),
    ),
  );
  assert.equal(
    named.events.find((e) => e.kind === "claim_added").detail.subject_name,
    "Newcomer",
  );

  // Cap: one tag added; drop the cap to 1 and the next ADD refuses.
  await db.query(
    `update account set max_player_recordings = 1 where email_hash = $1`,
    [emailHash(NEWCOMER)],
  );
  // The cost is said before the tap (#760): this one would need a slot.
  const cost = (tag, c = cookie) =>
    handler({
      ...event({
        method: "GET",
        path: "/api/me/follow-cost",
        cookie: c,
        body: undefined,
      }),
      queryStringParameters: { player_tag: tag },
    });
  const before = parse(await cost("#0QV2CV"));
  assert.deepEqual(
    {
      free: before.free,
      following: before.following,
      used: before.used,
      limit: before.limit,
    },
    { free: false, following: false, used: 1, limit: 1 },
  );
  assert.equal((await cost("not a tag")).statusCode, 400);
  // No tag asks only for the count.
  const count = parse(await cost(""));
  assert.equal(count.player_tag, null);
  assert.equal(count.free, null);
  assert.equal(count.used, 1);
  assert.equal((await cost("#0QV2CV", null)).statusCode, 401);
  const refused = await handler(
    event({ path: "/api/claims", cookie, body: { player_tag: "#0QV2CV" } }),
  );
  assert.equal(refused.statusCode, 429);
  const no = parse(refused);
  assert.match(no.message, /All 1 of your player slots are in use \(1 of 1\)/);
  assert.match(no.message, /already records stays free/);
  assert.equal(no.used, 1);
  assert.equal(no.limit, 1);
  // A member of a clan recorded in full (the seeded one) is free, even at
  // the limit, and the add says so.
  const freeCost = parse(await cost("#0GJU2"));
  assert.equal(freeCost.free, true);
  assert.equal(freeCost.reason, "in_recorded_clan");
  const added = await handler(
    event({
      path: "/api/claims",
      cookie,
      body: { player_tag: "#0GJU2", relationship: "friend" },
    }),
  );
  assert.equal(added.statusCode, 200);
  assert.deepEqual(parse(added).slot, {
    took: false,
    free: true,
    reason: "in_recorded_clan",
    used: 1,
    limit: 1,
  });
  const mine = parse(
    await handler(
      event({ method: "GET", path: "/api/me", cookie, body: undefined }),
    ),
  );
  const row = mine.claims.find((c) => c.player_tag === "#0GJU2");
  assert.equal(row.slot, "free");
  assert.equal(row.slot_reason, "in_recorded_clan");
  assert.ok(mine.claims.some((c) => c.slot === "used"));
  assert.equal(mine.entitlements.player_slots.used, 1);
  // The main player is a member of that clan too, so two are free.
  assert.equal(mine.entitlements.player_slots.free, 2);
  // Leave the account as later tests expect it.
  const gone = await handler(
    event({
      path: "/api/claims",
      cookie,
      body: { player_tag: "#0GJU2", action: "remove" },
    }),
  );
  assert.equal(gone.statusCode, 200);
  await db.query(
    `update account set max_player_recordings = null where email_hash = $1`,
    [emailHash(NEWCOMER)],
  );
});

test("collector fleet: card-derived identity; points and credits retired (#539)", async () => {
  // fetch_points is a dead column: ingest still counts it, nothing serves it.
  await db.query(
    `update gateway set fetch_points = 2600 where name = 'kitchen-mac' and status <> 'revoked'`,
  );
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
  assert.ok(gw);
  assert.ok(!("fetch_points" in gw) && !("credits" in gw));
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
        body: { tool: "battles_query", args: { player_tag: "#0892G9" } },
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

test("Stats opens for your own players and the players you follow, and refuses the rest", async () => {
  // Jamie, 2026-11-12: "Stats opens for the players you follow", only
  // those and your own; anyone else is refused server-side. Invented tags.
  const cookie = memberCookie;
  const {
    rows: [acct],
  } = await db.query(`select account_id from account where email_hash = $1`, [
    emailHash(NEWCOMER),
  ]);
  const FOLLOWED = "#0LGRJVJ";
  const WATCHED = "#08Y00JG";
  const STRANGER = "#0QGQVC0";
  for (const tag of [FOLLOWED, WATCHED, STRANGER])
    await db.query(
      `insert into player (player_tag) values ($1) on conflict do nothing`,
      [tag],
    );
  await db.query(
    `insert into claim (account_id, player_tag, is_primary, relationship, status)
     values ($1, $2, false, 'friend', 'unverified'),
            ($1, $3, false, 'watching', 'unverified')`,
    [acct.account_id, FOLLOWED, WATCHED],
  );
  const {
    rows: [own],
  } = await db.query(
    `select player_tag from claim where account_id = $1 and is_primary`,
    [acct.account_id],
  );
  const stats = (tool, args) =>
    handler(event({ path: "/api/me/stats", cookie, body: { tool, args } }));

  for (const tag of [own?.player_tag, FOLLOWED].filter(Boolean)) {
    const ok = await stats("battles_query", { player_tag: tag });
    assert.equal(ok.statusCode, 200, `${tag} opens`);
    assert.equal(parse(ok).is_error, false);
  }
  // A tag in its own spelling reaches the same claim.
  const loose = await stats("players_summary", {
    player_tag: FOLLOWED.slice(1).toLowerCase(),
  });
  assert.equal(loose.statusCode, 200);

  for (const tag of [WATCHED, STRANGER]) {
    const refused = await stats("battles_query", { player_tag: tag });
    assert.equal(refused.statusCode, 403, `${tag} is refused`);
    assert.equal(parse(refused).error, "not_followed");
  }
  // Unfollowing closes it again.
  await db.query(
    `delete from claim where account_id = $1 and player_tag = $2`,
    [acct.account_id, FOLLOWED],
  );
  assert.equal(
    (await stats("battles_query", { player_tag: FOLLOWED })).statusCode,
    403,
  );

  // No tag, a bad tag, a tool Stats never reads, an end user: refused.
  assert.equal((await stats("battles_query", {})).statusCode, 400);
  assert.equal(
    (await stats("battles_query", { player_tag: "not a tag!" })).statusCode,
    400,
  );
  assert.equal(
    (await stats("elixir_my_players", { player_tag: STRANGER })).statusCode,
    400,
  );
  assert.equal(
    (
      await stats("battles_performance", {
        player_tag: own?.player_tag ?? STRANGER,
        on_behalf_of: "discord:1",
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await stats("war_current", {
        clan_tag: "#J2RGCRVG",
        player_tag: STRANGER,
      })
    ).statusCode,
    400,
  );

  // Signed out: nothing.
  const anon = await handler(
    event({
      path: "/api/me/stats",
      body: { tool: "battles_query", args: { player_tag: FOLLOWED } },
    }),
  );
  assert.equal(anon.statusCode, 401);
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
        tool: "elixir_send_feedback",
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
  // The MCP-surface path (elixir_send_feedback at the MCP door) is covered in
  // packages/tools/test/tools2 "feedback loop closes".
  assert.equal(list.feedback[0].from_player, "#09CV8UVL");

  const triage = await handler(
    event({
      path: "/api/admin/feedback",
      cookie: bossCookie,
      body: { feedback_id: list.feedback[0].feedback_id, status: "planned" },
    }),
  );
  assert.equal(triage.statusCode, 200);
});

test("0204: one feedback system: a page files with area and refs, the queue filters by area, an answer is a compare-and-set, opening the item reads it", async () => {
  const get = (path, cookie, query) =>
    handler({
      ...event({ method: "GET", path, cookie, body: undefined }),
      ...(query ? { queryStringParameters: query } : {}),
    });
  const filed = parse(
    await handler(
      event({
        path: "/api/feedback",
        cookie: memberCookie,
        body: {
          message: "This rank looks off for me",
          category: "data_quality",
          area: "ladder",
          context: {
            path: "/ladder/global",
            season: "2026-10",
            nested: { x: 1 },
          },
          refs: [
            { kind: "player", ref: "09cv8uvl" },
            { kind: "call", ref: "44444444-4444-4444-8444-444444444444" },
          ],
        },
      }),
    ),
  );
  assert.equal(filed.ok, true, JSON.stringify(filed));
  assert.equal(filed.area, "ladder");
  assert.deepEqual(filed.refs, [{ kind: "player", ref: "#09CV8UVL" }]);
  assert.equal(filed.dropped[0].reason, "not_yours", "a call not theirs");
  const { rows } = await db.query(
    `select surface, area, context from feedback where feedback_id = $1`,
    [filed.feedback_id],
  );
  assert.equal(rows[0].surface, "web");
  assert.deepEqual(rows[0].context, {
    path: "/ladder/global",
    season: "2026-10",
  });

  // A page never claims a door's area.
  const claimed = await handler(
    event({
      path: "/api/feedback",
      cookie: memberCookie,
      body: { message: "hi", area: "mcp" },
    }),
  );
  assert.equal(claimed.statusCode, 400);
  const unknown = await handler(
    event({
      path: "/api/feedback",
      cookie: memberCookie,
      body: { message: "hi", category: "nonsense" },
    }),
  );
  assert.equal(unknown.statusCode, 400);
  assert.equal(parse(unknown).error, "bad_category");

  const ladder = parse(
    await get("/api/admin/feedback", bossCookie, { area: "ladder" }),
  );
  assert.ok(ladder.feedback.length >= 1);
  assert.ok(ladder.feedback.every((f) => f.area === "ladder"));
  assert.ok(ladder.areas.some((a) => a.area === "ladder" && a.unanswered >= 1));
  assert.equal(
    (await get("/api/admin/feedback", memberCookie)).statusCode,
    403,
  );
  const item = parse(
    await get(`/api/admin/feedback/${filed.feedback_id}`, bossCookie),
  ).feedback;
  assert.equal(item.from_player, "#09CV8UVL");
  assert.deepEqual(item.refs, [{ kind: "player", ref: "#09CV8UVL" }]);

  // A compare-and-set against a stale read is refused, never a silent
  // overwrite of someone else's answer.
  const stale = await handler(
    event({
      path: "/api/admin/feedback",
      cookie: bossCookie,
      body: {
        feedback_id: filed.feedback_id,
        status: "done",
        response: "Fixed.",
        expected: { status: "planned", response: null, responded_at: null },
      },
    }),
  );
  assert.equal(stale.statusCode, 409);
  const answered = parse(
    await handler(
      event({
        path: "/api/admin/feedback",
        cookie: bossCookie,
        body: {
          feedback_id: filed.feedback_id,
          status: "done",
          response: "Fixed: the floor was read from last season.",
          shipped_in: "11.3.0",
          expected: { status: "new", response: null, responded_at: null },
        },
      }),
    ),
  );
  assert.equal(answered.answered, true, JSON.stringify(answered));
  assert.equal(
    (
      await handler(
        event({
          path: "/api/admin/feedback",
          cookie: bossCookie,
          body: { feedback_id: "999999999", status: "seen" },
        }),
      )
    ).statusCode,
    404,
  );

  // Opening the item reads the answer; the reply follows it.
  const mine = parse(
    await get(`/api/me/feedback/${filed.feedback_id}`, memberCookie),
  ).feedback;
  assert.equal(mine.shipped_in, "11.3.0");
  assert.equal(mine.response_seen, false, "as it stood before this read");
  const { rows: seen } = await db.query(
    `select response_seen_at from feedback where feedback_id = $1`,
    [filed.feedback_id],
  );
  assert.ok(seen[0].response_seen_at, "opening it marked it seen");
  assert.equal(
    (await get(`/api/me/feedback/${filed.feedback_id}`, bossCookie)).statusCode,
    404,
    "another account's item does not exist for you",
  );
  const reply = parse(
    await handler(
      event({
        path: "/api/feedback",
        cookie: memberCookie,
        body: {
          message: "Thanks, it reads right now.",
          area: "ladder",
          follows_id: filed.feedback_id,
        },
      }),
    ),
  );
  const again = parse(
    await get(`/api/me/feedback/${filed.feedback_id}`, memberCookie),
  ).feedback;
  assert.deepEqual(again.followed_by, [reply.feedback_id]);
  const listed = parse(
    await get("/api/me/feedback", memberCookie, { area: "ladder" }),
  );
  assert.ok(listed.feedback.every((f) => f.area === "ladder"));
  assert.equal(listed.unseen, 0);
});

test("emails sent to me: the list, one record with its archived body (pixel stripped), and a report about it (0139)", async () => {
  const cookie = memberCookie;
  const get = (path, h = handler) =>
    h(event({ method: "GET", path, cookie, body: undefined }));
  const { rows: who } = await db.query(
    `select account_id from account where email_hash = $1`,
    [emailHash(NEWCOMER)],
  );
  const accountId = who[0].account_id;
  const { rows: other } = await db.query(
    `select account_id from account where email_hash = $1`,
    [emailHash(JAMIE)],
  );
  // Two issues, one send each to the member, plus a send to someone else.
  const { rows: issues } = await db.query(
    `insert into email_issue (kind, period_key, subject_key, subject_line, status)
     values ('milestone', '2026-09-19', $1, 'You took Guards Mastery to level 5', 'queued'),
            ('arena_week', '2026-W37', $1, 'Your week in the Arena', 'queued')
     returning issue_id`,
    [accountId],
  );
  const { rows: sends } = await db.query(
    `insert into email_send (issue_id, account_id, subject, archived, enqueued_at)
     values ($1, $3, 'You took Guards Mastery to level 5', true, '2026-09-19T10:20:00Z'),
            ($2, $3, null, false, '2026-09-15T14:00:00Z'),
            ($1, $4, 'Somebody else''s', true, '2026-09-19T10:21:00Z')
     returning send_id, account_id`,
    [issues[0].issue_id, issues[1].issue_id, accountId, other[0].account_id],
  );
  const mine = sends.filter((s) => s.account_id === accountId);
  const theirs = sends.find((s) => s.account_id !== accountId);

  const list = parse(await get("/api/me/email/sends")).sends;
  assert.deepEqual(
    list.map((s) => [s.kind, s.label, s.subject, s.archived]),
    [
      ["milestone", "Milestones", "You took Guards Mastery to level 5", true],
      ["arena_week", "Your week in the Arena", "Your week in the Arena", false],
    ],
    "newest first; an old row without its own subject falls back to the issue's",
  );
  assert.ok(list.every((s) => /^[0-9a-f-]{36}$/.test(s.send_id)));
  // The Profile panel's recent list carries the same ids.
  const prefs = parse(await get("/api/me/email"));
  assert.equal(prefs.recent[0].send_id, mine[0].send_id);
  // Each kind carries its product, when it comes in the account's zone,
  // and the last one sent here, which the page opens as its example.
  const kind = (k) => prefs.kinds.find((x) => x.kind === k);
  // The retired kinds keep their records above and leave the switches
  // (2026-11-12, the one digest).
  for (const k of ["milestone", "arena_week", "clan_report"])
    assert.equal(kind(k), undefined, k);
  assert.deepEqual(prefs.kinds.map((x) => x.kind).sort(), [
    "clan_actions_waiting",
    "collector_activity",
    "feedback_answer",
    "tracking_report",
  ]);
  assert.equal(kind("tracking_report").last_send_id, null);
  assert.equal(kind("tracking_report").product, "Home");
  // The digest carries its cadence, weekly until chosen; no other kind does.
  assert.equal(kind("tracking_report").cadence, "weekly");
  assert.equal(kind("collector_activity").cadence, null);
  assert.match(kind("tracking_report").sends.time, /^\d{1,2}:00 (am|pm)$/);
  assert.equal(kind("clan_actions_waiting").sends, null);
  assert.deepEqual(Object.keys(kind("collector_activity").sends).sort(), [
    "time",
    "weekday",
    "zone",
  ]);
  assert.match(kind("collector_activity").sends.time, /^\d{1,2}:00 (am|pm)$/);

  // The page's Every email switch is the footer's "all": every kind at
  // once, and back.
  const put = (body) =>
    handler(event({ method: "PUT", path: "/api/me/email", cookie, body }));
  assert.equal((await put({ kind: "all", enabled: false })).statusCode, 200);
  assert.ok(
    parse(await get("/api/me/email")).kinds.every((k) => k.enabled === false),
  );
  assert.equal((await put({ kind: "all", enabled: true })).statusCode, 200);
  assert.ok(
    parse(await get("/api/me/email")).kinds.every((k) => k.enabled === true),
  );
  assert.equal((await put({ kind: "nope", enabled: true })).statusCode, 400);
  // The change reads back on the account's events, named as the page names it.
  const choice = parse(await get("/api/me/activity")).events.find(
    (e) => e.kind === "email_pref",
  );
  assert.equal(choice.detail.enabled, true);
  assert.equal(choice.detail.label, "every Elixir email");
  // The digest's cadence: daily or weekly, on the digest only; a turn-off
  // keeps it, and choosing one never turns the mail back on.
  const digest = async () =>
    parse(await get("/api/me/email")).kinds.find(
      (k) => k.kind === "tracking_report",
    );
  assert.equal(
    (await put({ kind: "tracking_report", cadence: "daily" })).statusCode,
    200,
  );
  assert.equal((await digest()).cadence, "daily");
  assert.equal((await digest()).enabled, true);
  assert.equal(
    (await put({ kind: "tracking_report", enabled: false })).statusCode,
    200,
  );
  assert.equal((await digest()).cadence, "daily");
  // A person's own cadence choice is theirs even on a row an operator
  // made, so Home's welcome step sees it (Codex on #811).
  await db.query(
    "update account_email_pref set via = 'ops' where account_id = $1 and kind = 'tracking_report'",
    [accountId],
  );
  assert.equal(
    (await put({ kind: "tracking_report", cadence: "weekly" })).statusCode,
    200,
  );
  assert.equal(
    (
      await db.query(
        "select via from account_email_pref where account_id = $1 and kind = 'tracking_report'",
        [accountId],
      )
    ).rows[0].via,
    "profile",
  );
  assert.deepEqual(
    [(await digest()).enabled, (await digest()).cadence],
    [false, "weekly"],
  );
  assert.equal(
    parse(await put({ kind: "arena_week", cadence: "daily" })).error,
    "no_cadence",
  );
  assert.equal(
    parse(await put({ kind: "tracking_report", cadence: "hourly" })).error,
    "bad_cadence",
  );
  assert.equal(
    (await put({ kind: "tracking_report", enabled: true })).statusCode,
    200,
  );
  // A cadence choice reads back as its own event, the digest named.
  const chose = parse(await get("/api/me/activity")).events.filter(
    (e) => e.kind === "email_pref" && e.detail.cadence,
  );
  assert.deepEqual(
    chose.map((e) => [e.detail.label, e.detail.cadence]),
    [
      ["Your digest", "weekly"],
      ["Your digest", "daily"],
    ],
  );

  // Without a store: the row answers, the body is null.
  const bare = parse(await get(`/api/me/email/sends/${mine[0].send_id}`));
  assert.equal(bare.send.subject, "You took Guards Mastery to level 5");
  assert.equal(bare.html, null);
  // Someone else's send, a malformed id, an unknown id: 404 alike.
  assert.equal(
    (await get(`/api/me/email/sends/${theirs.send_id}`)).statusCode,
    404,
  );
  assert.equal((await get(`/api/me/email/sends/not-a-uuid`)).statusCode, 404);
  assert.equal(
    (await get(`/api/me/email/sends/00000000-0000-4000-8000-000000000000`))
      .statusCode,
    404,
  );

  // With a store: the archived body comes back with the pixel stripped.
  const { gzipSync } = await import("node:zlib");
  const { sentMailKey } =
    await import("../../../packages/mail/src/archive.mjs");
  const { pixelTag } = await import("@elixir-mcp/mail");
  const stored = {
    send_id: mine[0].send_id,
    kind: "milestone",
    subject: "You took Guards Mastery to level 5",
    html: `<html><body><p>Congratulations</p>${pixelTag("/mail/milestone/2026-09-19")}</body></html>`,
    text: "Congratulations",
    archived_at: "2026-09-19T10:20:00.000Z",
  };
  const asked = [];
  const withStore = makeHandler({
    databaseUrl: DB_URL,
    secret: SECRET,
    sendLoginEmail: async () => {},
    capture: {
      s3: {
        send: async (cmd) => {
          asked.push(cmd.input.Key);
          const body = gzipSync(JSON.stringify(stored));
          return { Body: { transformToByteArray: async () => body } };
        },
      },
      bucket: "archive",
    },
  });
  const full = parse(
    await get(`/api/me/email/sends/${mine[0].send_id}`, withStore),
  );
  assert.equal(full.html, "<html><body><p>Congratulations</p></body></html>");
  assert.equal(full.text, "Congratulations");
  assert.equal(full.archived_at, stored.archived_at);
  assert.equal(asked[0], sentMailKey("2026-09-19T10:20:00Z", mine[0].send_id));
  assert.match(asked[0], /^mail\/sent\/dt=2026-09-19\/send_id=/);
  // A row that was never archived never asks the store.
  await get(`/api/me/email/sends/${mine[1].send_id}`, withStore);
  assert.equal(asked.length, 1);

  // A report about the email: send_id is a column, and the queue sees
  // the kind and subject beside it.
  const filed = await handler(
    event({
      path: "/api/feedback",
      cookie,
      body: {
        message: "The badge name was code",
        category: "bug",
        send_id: mine[0].send_id,
      },
    }),
  );
  assert.equal(filed.statusCode, 200);
  const list2 = parse(await get("/api/me/feedback")).feedback;
  assert.equal(list2[0].send_id, mine[0].send_id);
  const queue = parse(
    await handler(
      event({
        method: "GET",
        path: "/api/admin/feedback",
        cookie: bossCookie,
        body: undefined,
      }),
    ),
  ).feedback;
  const item = queue.find((f) => f.send_id === mine[0].send_id);
  assert.equal(item.send_kind, "milestone");
  assert.equal(item.send_subject, "You took Guards Mastery to level 5");
  // The maintainer's side: every send, every account, with the reports
  // counted and the recipient named by player, never by address; and
  // the same record with its body over the admin lane.
  const audit = parse(
    await handler(
      event({
        method: "GET",
        path: "/api/admin/email/sends",
        cookie: bossCookie,
        body: undefined,
      }),
    ),
  ).sends;
  const audited = audit.find((s) => s.send_id === mine[0].send_id);
  assert.equal(audited.reports, 1);
  assert.equal(audited.kind, "milestone");
  assert.ok(!JSON.stringify(audit).includes("@"), "no address in the audit");
  assert.ok(audit.some((s) => s.send_id === theirs.send_id));
  assert.equal(
    (await get(`/api/admin/email/sends`)).statusCode,
    403,
    "a member is not an admin",
  );
  const adminRec = parse(
    await withStore(
      event({
        method: "GET",
        path: `/api/admin/email/sends/${mine[0].send_id}`,
        cookie: bossCookie,
        body: undefined,
      }),
    ),
  );
  assert.equal(
    adminRec.html,
    "<html><body><p>Congratulations</p></body></html>",
  );
  assert.equal(
    (await get(`/api/admin/email/sends/${mine[0].send_id}`)).statusCode,
    403,
  );
  // A malformed send_id is dropped, not refused.
  const loose = await handler(
    event({
      path: "/api/feedback",
      cookie,
      body: { message: "still filed", send_id: "nope" },
    }),
  );
  assert.equal(loose.statusCode, 200);
});

test("service tokens: Admin no longer mints one on a person; an existing one validates, revoke kills it", async () => {
  const minted = await handler(
    event({
      path: "/api/admin/service-tokens",
      cookie: bossCookie,
      body: { name: "elixir-bot" },
    }),
  );
  assert.equal(minted.statusCode, 410);
  assert.equal(parse(minted).error, "mint_moved");

  const { issueServiceToken, validateServiceToken } =
    await import("../../../packages/auth/src/oauth.mjs");
  const {
    rows: [boss],
  } = await db.query(`select account_id from account where email_hash = $1`, [
    emailHash(JAMIE),
  ]);
  const token = await issueServiceToken(db, {
    accountId: boss.account_id,
    name: "elixir-bot",
  });
  const who = await validateServiceToken(db, token);
  assert.ok(who, "a key issued before still validates");
  assert.equal(who.serviceName, "elixir-bot");
  assert.equal(who.credentialType, "service");

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
    await validateServiceToken(db, token),
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

test("entitlement ladder: /api/me exposes tier; Leader and Family are earned; admin grants Partner", async () => {
  const ownerCookie = bossCookie;
  const cookie = memberCookie;
  // Clear the hand-tuned override from the cap test above: the role
  // default (member: 3) must take over when no override is set.
  await db.query(
    `update account set max_player_recordings = null where email_hash = $1`,
    [emailHash(NEWCOMER)],
  );
  const {
    rows: [{ account_id: newcomerId }],
  } = await db.query(`select account_id from account where email_hash = $1`, [
    emailHash(NEWCOMER),
  ]);
  const me = async () =>
    parse(
      await handler(
        event({ method: "GET", path: "/api/me", cookie, body: undefined }),
      ),
    );
  const adminRow = async () =>
    parse(
      await handler(
        event({
          method: "GET",
          path: "/api/admin/accounts",
          cookie: ownerCookie,
          body: undefined,
        }),
      ),
    ).accounts.find((a) => a.account_id === newcomerId);
  const grant = (role, c = ownerCookie) =>
    handler(
      event({
        path: "/api/admin/accounts",
        cookie: c,
        body: { account_id: newcomerId, role },
      }),
    );

  // NEWCOMER is a member (their collector is draining) with the ratified
  // limits on the wire.
  let mine = await me();
  assert.equal(mine.role, "member");
  // Player slots are no longer a rung on the ladder (50 everywhere below
  // unlimited); comprehensive clans and collections still are.
  assert.equal(mine.entitlements.player_slots.limit, 50);
  assert.equal(mine.entitlements.comprehensive_clans.limit, 0);
  assert.ok(!("collections" in mine.entitlements));
  assert.ok(!("operator_bonus_applied" in mine.entitlements));

  // There is nothing to ask for (#530): the request route is gone.
  const req = await handler(
    event({ path: "/api/me/role-request", cookie, body: { role: "family" } }),
  );
  assert.equal(req.statusCode, 404);

  let row = await adminRow();
  assert.equal(row.role, "member");
  assert.equal(row.granted_role, "member");
  assert.equal(row.operator, false, "a draining collector is no ground");
  assert.equal(row.leads_tracked_clan, false);
  assert.ok(!("pending_role_request" in row));

  // Family is earned by an active collector, read on the next request.
  const {
    rows: [gw],
  } = await db.query(
    `insert into gateway (owner_account_id, name, static_ip, status)
     values ($1, 'tier-test-gw', '203.0.113.99', 'active') returning gateway_id`,
    [newcomerId],
  );
  mine = await me();
  assert.equal(mine.role, "family");
  const { roleQuotas } = await import("@elixir-mcp/contracts");
  assert.equal(
    mine.entitlements.comprehensive_clans.limit,
    roleQuotas("family").comprehensive_clans,
    "the Family ceiling, with no bonus on top",
  );
  assert.equal(
    mine.entitlements.player_slots.limit,
    roleQuotas("family").player_slots,
  );
  row = await adminRow();
  assert.equal(row.role, "family");
  assert.equal(row.granted_role, "member", "nothing was stored");
  assert.equal(row.operator, true);
  // ...and lost when the ground goes.
  await db.query(`delete from gateway where gateway_id = $1`, [gw.gateway_id]);
  assert.equal((await me()).role, "member");

  // Leader and Family are never granted, by the owner either.
  for (const role of ["leader", "family"]) {
    const refused = await grant(role);
    assert.equal(refused.statusCode, 400, role);
    assert.equal(parse(refused).code, "tier_is_earned");
  }

  // A stored hand grant from before 2026-10-12 no longer counts, and the
  // admin can see and clear it.
  await db.query(`update account set role = 'family' where account_id = $1`, [
    newcomerId,
  ]);
  assert.equal((await me()).role, "member");
  row = await adminRow();
  assert.equal(row.granted_role, "family");
  assert.equal((await grant("member")).statusCode, 200);

  // Partner stays Jamie-granted in Admin, and is on the account's timeline.
  const set = await grant("partner");
  assert.equal(set.statusCode, 200, set.body);
  const { rows: logged } = await db.query(
    `select kind from account_event where account_id = $1 and kind = 'role_changed'`,
    [newcomerId],
  );
  assert.ok(logged.length > 0, "the tier change is on the account's timeline");
  mine = await me();
  assert.equal(mine.role, "partner");
  assert.ok(!("collections" in mine.entitlements));

  // Non-role strings and non-owner setters are refused.
  const bogus = await grant("emperor");
  assert.equal(bogus.statusCode, 400);
  const sneaky = await grant("admin", cookie);
  assert.equal(sneaky.statusCode, 403);
});

test("clans: added = recorded within slots; notify is the toggle; remove settles the recording", async () => {
  const cookie = bossCookie; // owner: unlimited slots
  const add = await handler(
    event({
      path: "/api/me/clans",
      cookie,
      body: { clan_tag: "0c2ljuvu", action: "add", scope: "activity" },
    }),
  );
  assert.equal(parse(add).clan_tag, "#0C2LJUVU", "normalized at the door");
  assert.equal(parse(add).scope, "activity");
  const list = parse(
    await handler(
      event({ method: "GET", path: "/api/me/clans", cookie, body: undefined }),
    ),
  );
  const row = list.clans.find((c) => c.clan_tag === "#0C2LJUVU");
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
      body: { clan_tag: "#02VLV0R", action: "add", scope: "comprehensive" },
    }),
  );
  assert.equal(refused.statusCode, 429);
  assert.match(parse(refused).message, /no comprehensive-scope clan slots/);
  await db.query(`update account set role = 'partner' where account_id = $1`, [
    acct[0].account_id,
  ]);

  // Notify off, then remove: removal stops the recording (last adder).
  const mute = await handler(
    event({
      path: "/api/me/clans",
      cookie,
      body: { clan_tag: "#0C2LJUVU", action: "notify_off" },
    }),
  );
  assert.equal(parse(mute).notify, false);
  const removed = await handler(
    event({
      path: "/api/me/clans",
      cookie,
      body: { clan_tag: "#0C2LJUVU", action: "remove" },
    }),
  );
  assert.equal(parse(removed).removed, true);
  assert.equal(parse(removed).recording_stopped, true);
  const after = parse(
    await handler(
      event({ method: "GET", path: "/api/me/clans", cookie, body: undefined }),
    ),
  );
  assert.ok(!after.clans.some((c) => c.clan_tag === "#0C2LJUVU"));

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

test("public battle totals and played-day series exclude removed scratch records", async () => {
  const read = async () =>
    parse(
      await handler(
        event({ method: "GET", path: "/api/public/stats", body: undefined }),
      ),
    );
  const before = await read();
  const ids = ["growth-retained-fixture", "growth-removed-fixture"].map(
    (value) => crypto.createHash("sha256").update(value).digest("hex"),
  );
  const sum = (body) =>
    body.series.battles_daily.reduce((total, row) => total + row.battles, 0);
  try {
    for (const id of ids)
      await db.query(
        "insert into battle (battle_id, battle_time, type, type_class) values ($1, '2026-09-13T12:00:00Z', 'PvP', 'pvp')",
        [id],
      );
    const added = await read();
    assert.equal(added.totals.battles, before.totals.battles + 2);
    assert.equal(sum(added), added.totals.battles);
    await db.query("delete from battle where battle_id = $1", [ids[1]]);
    const retained = await read();
    assert.equal(retained.totals.battles, before.totals.battles + 1);
    assert.equal(sum(retained), retained.totals.battles);
    const count = (body) =>
      body.series.battles_daily.find((row) => row.day === "2026-09-13")
        ?.battles ?? 0;
    assert.equal(count(retained), count(before) + 1);
  } finally {
    await db.query("delete from battle where battle_id = any($1::text[])", [
      ids,
    ]);
  }
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
    `select activity_seen_at from account where email_hash = $1`,
    [emailHash(JAMIE)],
  );
  const ev = parse(
    await handler(
      event({
        method: "GET",
        path: "/api/me/timeline",
        cookie,
        body: undefined,
      }),
    ),
  );
  assert.ok(Array.isArray(ev.timeline));
  assert.ok(Array.isArray(ev.entries));
  assert.ok("seen_to" in ev, "the Console's own place, before this read");
  assert.ok(!("read_to" in ev), "the agents' pointer is not the page's");
  const after = await db.query(
    `select activity_seen_at from account where email_hash = $1`,
    [emailHash(JAMIE)],
  );
  assert.equal(
    String(before.rows[0].activity_seen_at),
    String(after.rows[0].activity_seen_at),
    "web view never moves the agents' read pointer",
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

test("admin efficiency: staff read the rule, the days and today so far; nobody else does", async () => {
  const get = (cookie) =>
    handler(
      event({
        method: "GET",
        path: "/api/admin/efficiency",
        cookie,
        body: undefined,
      }),
    );
  const res = await get(bossCookie);
  assert.equal(res.statusCode, 200, res.body);
  assert.doesNotMatch(
    String(res.headers?.["cache-control"] ?? ""),
    /public/,
    "a staff read is never cached at the edge",
  );
  const body = parse(res);
  assert.equal(body.rule.followup_minutes, 30);
  assert.equal(body.rule.ceiling_minutes, 120);
  assert.ok(Array.isArray(body.days));
  assert.equal(body.today.lost_battles, null, "today's loss is not yet known");
  for (const k of ["battlelog_polls", "nothing_new_polls", "gaps"])
    assert.ok(Number.isInteger(body.today[k]), `today carries ${k}`);
  assert.ok(Number.isInteger(body.last_hour.battlelog_polls));
  assert.ok(!JSON.stringify(body).includes("#"), "no player named");
  const member = await get(memberCookie);
  assert.equal(member.statusCode, 403);
  assert.equal(parse(member).error, "not_entitled");
  assert.equal((await get(undefined)).statusCode, 403);
});

test("routes retired with the social-layer pivot answer 404, signed in or not (2026-11-13)", async () => {
  // The Settings year graph's read and the public capture-efficiency
  // read. Efficiency lives on as GET /api/admin/efficiency.
  for (const path of [
    "/api/me/battle-activity/20JJJ2CCRU",
    "/api/me/battle-activity/%2320JJJ2CCRU",
    "/api/public/efficiency",
  ])
    for (const cookie of [undefined, memberCookie, bossCookie]) {
      const r = await handler(
        event({ method: "GET", path, cookie, body: undefined }),
      );
      assert.equal(
        r.statusCode,
        404,
        `${path} ${cookie ? "signed in" : "signed out"}`,
      );
    }
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
  // Work waiting: the pipeline stages the Status gauge draws.
  for (const k of [
    "due_now",
    "queued",
    "leased",
    "done_hour",
    "tick_minutes",
    "next_tick_capacity",
  ])
    assert.ok(k in body.queue, `queue carries ${k}`);
  assert.ok(
    Number.isInteger(body.queue.due_now),
    "due_now is a count, not an error",
  );
  // The budget headline is the last day against the bulk share of a
  // day's capacity, and the charges by lane; no calendar-hour pace
  // (#64).
  assert.equal(
    body.budget.bulk_capacity_24h,
    Math.round(
      body.budget.rate_per_sec * 86400 * (1 - body.budget.live_reserve),
    ),
  );
  assert.ok(Number.isInteger(body.budget.fetches_24h));
  assert.equal(typeof body.budget.share_24h, "number");
  assert.ok(Number.isInteger(body.budget.charged_24h.bulk));
  assert.ok(Number.isInteger(body.budget.charged_24h.live));
  assert.ok(Number.isInteger(body.budget.used_hour));
  assert.ok(!("expected_hour" in body.budget), "no calendar-hour pace");
  assert.ok(!("hour_started_at" in body.budget));
  const blob = JSON.stringify(body);
  assert.ok(!blob.includes("static_ip"), "no IPs on the public surface");
  assert.ok(!blob.includes("email_hash"), "no account data");
  // We keep addresses now (0046). A public surface must never carry one.
  assert.ok(!blob.includes("@"), "no email address on a public surface");
  assert.ok(!blob.includes("kitchen-mac"), "machine labels stay private");
  // The signed badge is public; the hash behind it is not (0184).
  for (const c of body.collectors)
    assert.ok(
      ["signed", "dev_build", "unverified", "mismatch"].includes(c.signature),
      `${c.name}: ${c.signature}`,
    );
  assert.ok(!blob.includes("binary_sha256"), "no binary hash in public");
  assert.ok(!blob.includes("release_key"), "no key report in public");
});

test("provision_token: one click mints, one look claims (zero-trust copy flow)", async () => {
  // Owner provisions; the raw token exists in the DB only until reveal.
  const { rows: gw } = await db.query(
    `select gateway_id from gateway
     where name = 'kitchen-mac' and status <> 'revoked'`,
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
  assert.equal(raise.status, "probation");
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
  // A collector that has never called the door has sent no hash (0184).
  assert.equal(row.signature, "unverified");
  assert.equal(row.binary_sha256, null);
  assert.ok(!("release_signed" in row), "the state, not the join");

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
  await deliveredThenDrained("regress-op-nas");
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
  await handler(
    event({ path: "/api/auth", body: { age_13: true, email: NEWCOMER } }),
  );
  const backfilled = await db.query(
    `select email from account where email_hash = $1`,
    [hash],
  );
  assert.equal(backfilled.rows[0].email, NEWCOMER.toLowerCase());
});

// --------------------------------------------------------------- #16

// --------------------------------------------------------------- #17

// --------------------------------------------------------------- #18

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
  assert.equal(sentEmails.at(-1).ipAddress, "203.0.113.27");
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
    event({
      path: "/api/auth",
      body: { age_13: true, email: newcomer },
      ip: "203.0.113.33",
    }),
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

  // Neither the snoop's own collector list nor the public status page
  // carries another operator's label.
  for (const [path, cookie] of [
    ["/api/me/gateways", snoopCookie],
    ["/api/public/status", undefined],
  ]) {
    const response = await handler(
      event({ method: "GET", path, cookie, body: undefined }),
    );
    assert.equal(response.statusCode, 200, path);
    assert.ok(
      !response.body.includes("jamies-imac-basement"),
      `the machine label is nowhere in ${path}`,
    );
  }

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
    method: "GET",
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
      body: { player_tag: "#0UGYRLY", make_primary: true },
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
        player_tag: "#0UGYRLY",
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
     values ('cid-usage', 'Claude Desktop', '{}', now() + interval '30 days')
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
  // Partner is the grant; Leader and Family are earned (#530) and their
  // ceilings are read the same way.
  await db.query(`update account set role = 'partner' where email_hash = $1`, [
    emailHash(NEWCOMER),
  ]);
  const partner = await usageFor();
  assert.equal(partner.live_max, roleQuotas("partner").live_fetches_per_day);
  assert.equal(partner.quota_max, roleQuotas("partner").mcp_calls_per_day);
  await db.query(
    `update account set live_daily_quota = 7 where email_hash = $1`,
    [emailHash(NEWCOMER)],
  );
  const overridden = await usageFor();
  assert.equal(overridden.live_max, 7, "a per-account override beats the tier");
  assert.equal(overridden.quota_max, roleQuotas("partner").mcp_calls_per_day);
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

test("the explorer takes the hourly bucket but no daily quota, and is read-only", async () => {
  const cookie = memberCookie;
  const { rows: acct } = await db.query(
    `select account_id from account where email_hash = $1`,
    [emailHash(NEWCOMER)],
  );
  const accountId = acct[0].account_id;
  const call = (tool, args = {}) =>
    handler(event({ path: "/api/explore", cookie, body: { tool, args } }));

  // A person's own web read (#538, Jamie 2026-10-12): it bumps the hourly
  // bucket, leaves the daily tool-call counter alone, and is still written
  // to the call log, on the web surface with no client name.
  const today = new Date().toISOString().slice(0, 10);
  const counter = async (bucket) => {
    const { rows } = await db.query(
      `select coalesce(sum(count), 0)::int as n from rate_limit where bucket = $1`,
      [bucket],
    );
    return rows[0].n;
  };
  const logged = async () => {
    const { rows } = await db.query(
      `select count(*)::int as n from mcp_call_audit
        where account_id = $1 and tool = 'elixir_my_players'
          and surface = 'web' and client_name is null`,
      [accountId],
    );
    return rows[0].n;
  };
  const hourBefore = await counter(`mcp#${accountId}`);
  const dayBefore = await counter(`mcpday#${accountId}`);
  const logBefore = await logged();
  assert.equal((await call("elixir_my_players")).statusCode, 200);
  assert.equal(
    await counter(`mcp#${accountId}`),
    hourBefore + 1,
    "a web read bumps the hourly bucket",
  );
  assert.equal(
    await counter(`mcpday#${accountId}`),
    dayBefore,
    "a web read leaves the daily tool-call counter untouched",
  );
  assert.equal(await logged(), logBefore + 1, "and is written to the log");

  // Read-only tools serve; writes other than the console's nickname editor
  // are refused.
  for (const w of ["elixir_follow_player", "elixir_follow_clan"])
    assert.equal((await call(w)).statusCode, 400, w);
  assert.equal(
    (await call("elixir_nickname", { player_tag: "#0892G9" })).statusCode,
    200,
  );

  // The daily quota is the MCP door's alone: an account whose agents and
  // clients have spent the whole day still reads its own record here.
  await db.query(
    `insert into rate_limit (bucket, window_start, count) values ($1, $2::date, 100000)
     on conflict (bucket, window_start) do update set count = 100000`,
    [`mcpday#${accountId}`, today],
  );
  const spent = await call("elixir_my_players");
  assert.equal(spent.statusCode, 200, "a full daily quota refuses no web read");
  assert.equal(
    await counter(`mcpday#${accountId}`),
    100000,
    "and the read does not add to it",
  );
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
  const { MCP_RESULT_MAX_CHARS } =
    await import("../../../packages/tools/src/result-text.mjs");
  const { renderToolResultText } =
    await import("../../../packages/tools/src/result-text.mjs");
  const { makeRegistry } =
    await import("../../../packages/tools/src/tools.mjs");
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
  assert.equal(body.error.code, "result_too_large");
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
    path: "/api/public/status",
    method: "GET",
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

// Jamie is emailed when beta users say something (2026-09-09): feedback
// enqueues an owner notification, shaped so the
// mail names the kind, an excerpt, and who - never an address.
test("feedback notifies the owner; the owner's own feedback does not", async () => {
  const cookie = memberCookie;
  ownerNotes.length = 0;
  const long = "x".repeat(400);
  const fb = await handler(
    event({
      path: "/api/feedback",
      cookie,
      body: { message: `The explorer is great. ${long}`, category: "praise" },
    }),
  );
  assert.equal(fb.statusCode, 200);
  const note = ownerNotes.find((n) => n.kind === "feedback");
  assert.ok(note, "feedback notified");
  assert.equal(note.category, "praise");
  assert.equal(note.surface, "web");
  assert.match(
    note.from,
    /^account [0-9a-f]{8}$/,
    "an 8-hex hash prefix, never an address",
  );
  assert.ok(note.feedbackId);
  const { ownerNotifyMessage } =
    await import("../../../packages/outbox/src/notify.mjs");
  const msg = ownerNotifyMessage(note);
  assert.equal(msg.kind, "owner_notify");
  assert.equal(msg.notify_kind, "feedback");
  assert.ok(
    msg.note.length <= 301 && msg.note.endsWith("…"),
    "excerpt capped at ~300 chars",
  );
  assert.equal(msg.detail.category, "praise");
  assert.equal(msg.detail.area, "console");
  // The notice opens the one queue (0204).
  assert.match(msg.link, /\/admin\/feedback$/);
  assert.ok(
    !msg.note.includes("@") && !JSON.stringify(msg.detail).includes("@"),
  );

  // Tier requests are gone (#530): nothing to file, nothing to notify.
  ownerNotes.length = 0;
  const up = await handler(
    event({
      path: "/api/me/role-request",
      cookie,
      body: { role: "leader", note: "I run a clan" },
    }),
  );
  assert.equal(up.statusCode, 404);
  assert.equal(ownerNotes.length, 0);

  ownerNotes.length = 0;
  const own = await handler(
    event({
      path: "/api/feedback",
      cookie: bossCookie,
      body: { message: "note to self", category: "general" },
    }),
  );
  assert.equal(own.statusCode, 200);
  assert.equal(
    ownerNotes.filter((n) => n.kind === "feedback").length,
    0,
    "the owner is not told about their own feedback",
  );
});

/**
 * Capabilities are editable after the connection exists, on the personal
 * door AND on every agent door the account owns.
 *
 * Scope arrives in the client's own authorize request, so an app that never
 * asks for a capability could not be allowed one, and an app granted more
 * than it needs could not be narrowed without disconnecting it. Owner
 * report, 2026-09-09: agent doors were not even listed here, because their
 * grant is bound to the AGENT's account rather than the owner's.
 */
test("connection capabilities can be edited afterwards, including on an owned agent's door", async () => {
  const cookie = memberCookie;
  const { rows: acct } = await db.query(
    `select account_id from account where email_hash = $1`,
    [emailHash(NEWCOMER)],
  );
  const owner = acct[0].account_id;
  await db.query(
    `insert into oauth_client (client_id, client_name, redirect_uris, expires_at)
     values ('cid-scope', 'Scope Client', '{}', now() + interval '30 days')
     on conflict do nothing`,
  );
  // The person's own door.
  const { rows: mine } = await db.query(
    `insert into oauth_family (client_id, account_id, absolute_expires_at, scope)
     values ('cid-scope', $1, now() + interval '90 days', 'cr:read')
     returning family_id`,
    [owner],
  );
  // An agent this person owns, connected at its own door.
  const { rows: agent } = await db.query(
    `insert into account (email_hash, status, role, kind, owned_by_account_id, public_id)
     values (null, 'approved', 'leader', 'agent', $1, 'scopeagent1')
     returning account_id`,
    [owner],
  );
  const { rows: agentFam } = await db.query(
    `insert into oauth_family (client_id, account_id, absolute_expires_at, scope)
     values ('cid-scope', $1, now() + interval '90 days', 'cr:read')
     returning family_id`,
    [agent[0].account_id],
  );

  // Your Connections lists your door; the agent's is on the agent's own
  // console (2026-09-23), which runs the same route as the agent.
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
  const ids = list.connections.map((c) => c.family_id);
  assert.ok(ids.includes(mine[0].family_id), "the personal door");
  assert.ok(
    !ids.includes(agentFam[0].family_id),
    "the agent's door is not on yours",
  );
  const agentList = parse(
    await handler(
      event({
        method: "GET",
        path: "/api/agent/scopeagent1/connections",
        cookie,
        body: undefined,
      }),
    ),
  );
  assert.deepEqual(
    agentList.connections.map((c) => c.family_id),
    [agentFam[0].family_id],
    "the agent's console lists its door",
  );

  // Widen the personal door.
  const widened = parse(
    await handler(
      event({
        path: "/api/me/connections/scope",
        cookie,
        body: { family_id: mine[0].family_id, scope: "cr:read feedback:write" },
      }),
    ),
  );
  assert.equal(widened.scope, "cr:read feedback:write");

  // Widen the AGENT's door - the case that had no surface at all.
  const agentWidened = parse(
    await handler(
      event({
        path: "/api/me/connections/scope",
        cookie,
        body: {
          family_id: agentFam[0].family_id,
          scope: "feedback:write cr:read",
        },
      }),
    ),
  );
  assert.equal(
    agentWidened.scope,
    "cr:read feedback:write",
    "canonical order, whatever order was sent",
  );

  // Narrowing works too: a capability can be taken back without
  // disconnecting the client.
  const narrowed = parse(
    await handler(
      event({
        path: "/api/me/connections/scope",
        cookie,
        body: { family_id: mine[0].family_id, scope: "cr:read" },
      }),
    ),
  );
  assert.equal(narrowed.scope, "cr:read");

  // A scope this server does not define is refused, not silently dropped.
  const bogus = await handler(
    event({
      path: "/api/me/connections/scope",
      cookie,
      body: { family_id: mine[0].family_id, scope: "cr:read admin:everything" },
    }),
  );
  assert.equal(bogus.statusCode, 400);
  assert.equal(parse(bogus).error, "invalid_scope");

  // cr:read is not optional: a grant without it can do nothing.
  const noRead = await handler(
    event({
      path: "/api/me/connections/scope",
      cookie,
      body: { family_id: mine[0].family_id, scope: "feedback:write" },
    }),
  );
  assert.equal(noRead.statusCode, 400);

  // Somebody else's grant is not editable, and the refusal does not confirm
  // that it exists.
  const foreign = await handler(
    event({
      path: "/api/me/connections/scope",
      cookie: bossCookie,
      body: { family_id: mine[0].family_id, scope: "cr:read feedback:write" },
    }),
  );
  assert.equal(foreign.statusCode, 404);
  const stillMine = await db.query(
    `select scope from oauth_family where family_id = $1`,
    [mine[0].family_id],
  );
  assert.equal(stillMine.rows[0].scope, "cr:read", "untouched by the stranger");
});

// ------------------------------------------------------------- 0078
test("an operator picks their collector's card; a card is one live collector's", async () => {
  // A catalog to pick from: the recorded card table, not a fixture list.
  // Earlier tests raised collectors before any card existed, so the
  // first fleet read below deals those a face; the picks here come from
  // what that leaves free.
  await db.query(
    `insert into card (card_id, name, kind, rarity, elixir_cost, icon_medium) values
       (26000000, 'Knight', 'card', 'common', 3, 'https://cdn/knight.png'),
       (26000001, 'Archers', 'card', 'common', 3, 'https://cdn/archers.png'),
       (26000002, 'Goblins', 'card', 'common', 2, 'https://cdn/goblins.png'),
       (26000003, 'Giant', 'card', 'rare', 5, 'https://cdn/giant.png'),
       (26000004, 'P.E.K.K.A', 'card', 'epic', 7, 'https://cdn/pekka.png'),
       (26000005, 'Minions', 'card', 'common', 3, 'https://cdn/minions.png'),
       (26000006, 'Balloon', 'card', 'epic', 5, 'https://cdn/balloon.png'),
       (26000007, 'Witch', 'card', 'epic', 5, 'https://cdn/witch.png'),
       (26000008, 'Barbarians', 'card', 'common', 5, 'https://cdn/barbs.png'),
       (26000009, 'Golem', 'card', 'epic', 8, 'https://cdn/golem.png'),
       (26000063, 'Mega Knight', 'card', 'legendary', 7, 'https://cdn/mk.png'),
       (159000000, 'Tower Princess', 'support', 'common', null, '{}')
     on conflict (card_id) do nothing`,
  );
  const PICKER = "picker@example.com";
  await db.query(
    `insert into account (email_hash, status, role) values ($1, 'approved', 'member')`,
    [emailHash(PICKER)],
  );
  const cookie = await signIn(PICKER, "203.0.113.41");
  await handler(
    event({
      method: "GET",
      path: "/api/me/gateways",
      cookie,
      body: undefined,
    }),
  );

  // The catalog says what is free. Mega Knight is held by the basement
  // iMac from the test above; tower troops are not a face.
  const catalog = parse(
    await handler(
      event({
        method: "GET",
        path: "/api/gateways/cards",
        cookie,
        body: undefined,
      }),
    ),
  );
  const byName = Object.fromEntries(catalog.cards.map((c) => [c.name, c]));
  assert.equal(byName["Mega Knight"].taken, true);
  assert.equal(
    byName["Mega Knight"].icon,
    "https://elixir.poapkings.com/assets/cards/26000063.png",
  );
  assert.ok(!byName["Tower Princess"], "support cards are not pickable");
  const free = catalog.cards.filter((c) => !c.taken).map((c) => c.name);
  assert.ok(free.length >= 3, `enough free cards to pick from: ${free}`);
  const [first, secondCard, third] = free;

  // A held card is refused with a reason the form can show.
  const held = await handler(
    event({
      path: "/api/gateways",
      cookie,
      body: { name: "picker-one", card: "Mega Knight" },
    }),
  );
  assert.equal(held.statusCode, 409);
  assert.equal(parse(held).error, "card_taken");
  const unknown = await handler(
    event({
      path: "/api/gateways",
      cookie,
      body: { name: "picker-one", card: "Pekka Prime" },
    }),
  );
  assert.equal(unknown.statusCode, 400);
  assert.equal(parse(unknown).error, "unknown_card");

  // The pick lands, case-insensitively, and shows on the operator's own
  // list from the start rather than after a fleet read dealt one.
  const raise = parse(
    await handler(
      event({
        path: "/api/gateways",
        cookie,
        body: { name: "picker-one", card: first.toLowerCase() },
      }),
    ),
  );
  assert.equal(raise.status, "probation");
  assert.equal(raise.card, first);
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
  const g = mine.gateways.find((x) => x.name === "picker-one");
  assert.equal(g.card_name, first);
  assert.equal(g.card_icon, byName[first].icon);

  // A historical stored CDN avatar must be replaced on every read without
  // mutating the stored row or leaking catalog join columns.
  const legacyIcon = "https://api-assets.clashroyale.com/legacy.png";
  await db.query(`update gateway set card_icon = $2 where gateway_id = $1`, [
    raise.gateway_id,
    legacyIcon,
  ]);
  const ownerCookie = await signIn(JAMIE, "203.0.113.42");
  for (const [path, reader, field] of [
    ["/api/me/gateways", cookie, "gateways"],
    ["/api/admin/gateways", ownerCookie, "gateways"],
    ["/api/public/status", undefined, "collectors"],
  ]) {
    const response = await handler(
      event({ method: "GET", path, cookie: reader, body: undefined }),
    );
    assert.equal(response.statusCode, 200, response.body);
    const row = parse(response)[field].find(
      (x) =>
        x.gateway_id === raise.gateway_id ||
        x.card === first ||
        x.name === first,
    );
    assert.ok(row, path);
    assert.equal(row.card_icon, byName[first].icon, path);
    assert.ok(
      !("card_id" in row) && !("icon_medium" in row),
      "join columns stay private",
    );
  }
  assert.equal(
    (
      await db.query(`select card_icon from gateway where gateway_id = $1`, [
        raise.gateway_id,
      ])
    ).rows[0].card_icon,
    legacyIcon,
  );

  // A second collector from the same account is fine once the first has
  // delivered (one unproven at a time, #540) - but not on the same card.
  await deliveredThenDrained("picker-one");
  const twin = await handler(
    event({
      path: "/api/gateways",
      cookie,
      body: { name: "picker-two", card: first },
    }),
  );
  assert.equal(twin.statusCode, 409);
  const second = parse(
    await handler(
      event({
        path: "/api/gateways",
        cookie,
        body: { name: "picker-two", card: secondCard },
      }),
    ),
  );
  assert.equal(second.card, secondCard, JSON.stringify(second));

  // Re-picking your own collector's card: to a free one yes, to a held
  // one no, and only your own.
  const swap = await handler(
    event({
      path: "/api/me/gateway-card",
      cookie,
      body: { id: raise.gateway_id, card: "Mega Knight" },
    }),
  );
  assert.equal(swap.statusCode, 409);
  const same = await handler(
    event({
      path: "/api/me/gateway-card",
      cookie,
      body: { id: raise.gateway_id, card: first },
    }),
  );
  assert.equal(same.statusCode, 200, "your own current card is a no-op");
  // Revoking the twin frees its card for the first.
  await db.query(
    `update gateway set status = 'revoked' where name = 'picker-two'`,
  );
  const moved = parse(
    await handler(
      event({
        path: "/api/me/gateway-card",
        cookie,
        body: { id: raise.gateway_id, card: secondCard },
      }),
    ),
  );
  assert.equal(moved.card, secondCard, JSON.stringify(moved));
  const notMine = await handler(
    event({
      path: "/api/me/gateway-card",
      cookie: memberCookie,
      body: { id: raise.gateway_id, card: third },
    }),
  );
  assert.equal(
    notMine.statusCode,
    404,
    "somebody else's collector is not yours to re-face",
  );

  // The lazy deal only hands out FREE cards, so no two live collectors
  // ever share a face.
  await db.query(
    `insert into gateway (owner_account_id, name, status)
     select account_id, 'picker-blank', 'pending' from account where email_hash = $1`,
    [emailHash(PICKER)],
  );
  await handler(
    event({
      method: "GET",
      path: "/api/me/gateways",
      cookie,
      body: undefined,
    }),
  );
  const { rows: dupes } = await db.query(
    `select card_name, count(*) from gateway
     where status <> 'revoked' group by 1 having count(*) > 1`,
  );
  assert.deepEqual(dupes, [], "no live card is shared, and none is null");
});

test("a route that outlives the soft deadline answers 504 and still logs its route", async () => {
  // The native request context says 1 ms is left after the margin, so the route
  // cannot finish. Without the deadline the runtime would kill the
  // function and the timing line — the only thing that names the
  // route — would never be written.
  const lines = [];
  const realLog = console.info;
  console.info = (line) => lines.push(line);
  let res;
  try {
    res = await handler(
      event({ method: "GET", path: "/api/public/status", body: undefined }),
      { requestId: "req-deadline", remainingMs: () => 1501 },
    );
  } finally {
    console.info = realLog;
  }
  assert.equal(res.statusCode, 504);
  assert.deepEqual(parse(res), { error: "timeout" });
  const timing = lines.find((l) => l.http);
  assert.equal(timing.http, "GET /api/public/status");
  assert.equal(timing.status, 504);
  assert.equal(timing.timed_out, true);
  assert.equal(timing.request_id, "req-deadline");
});

test("a request that finishes carries its request id on the timing line", async () => {
  const lines = [];
  const realLog = console.info;
  console.info = (line) => lines.push(line);
  try {
    await handler(
      event({ method: "GET", path: "/api/public/status", body: undefined }),
      { requestId: "req-fine", remainingMs: () => 20_000 },
    );
  } finally {
    console.info = realLog;
  }
  const timing = lines.find((l) => l.http);
  assert.equal(timing.status, 200);
  assert.equal(timing.request_id, "req-fine");
  assert.equal(timing.timed_out, undefined);
});

test("GET /api/admin/cards: the catalog with its archetype roles, the vocabulary version, the unattested queue; admins only", async () => {
  const member = await handler(
    event({
      method: "GET",
      path: "/api/admin/cards",
      cookie: newcomerCookie,
      body: undefined,
    }),
  );
  assert.equal(member.statusCode, 403, "a member is not an admin");
  const res = await handler(
    event({
      method: "GET",
      path: "/api/admin/cards",
      cookie: bossCookie,
      body: undefined,
    }),
  );
  assert.equal(res.statusCode, 200, res.body);
  const body = parse(res);
  assert.ok(Array.isArray(body.cards));
  assert.equal(body.unattested, undefined);
  assert.ok(Array.isArray(body.aliases));
  assert.ok("version" in body);
  for (const c of body.cards) {
    assert.ok(Number.isInteger(c.card_id));
    assert.ok(c.role === null || typeof c.role.win_condition === "boolean");
  }
});

test("a late one-click unsubscribe on a removed account writes nothing to the tombstone", async () => {
  const {
    rows: [gone],
  } = await db.query(
    `insert into account (email_hash, status, role) values ('removed:' || gen_random_uuid(), 'disabled', 'member')
     returning account_id`,
  );
  const token = signUnsubscribe({
    secret: SECRET,
    accountId: gone.account_id,
    kind: "all",
  });
  const request = event({ method: "POST", path: "/api/email/unsubscribe" });
  request.queryStringParameters = { t: token };
  const reply = await handler(request);
  assert.equal(reply.statusCode, 200, reply.body);
  const { rows } = await db.query(
    `select (select count(*)::int from account_email_pref where account_id = $1) as prefs,
            (select count(*)::int from account_event where account_id = $1) as events`,
    [gone.account_id],
  );
  assert.deepEqual(rows[0], { prefs: 0, events: 0 });
});

test("a one-click unsubscribe racing a removal waits for it and writes nothing", async () => {
  const {
    rows: [leaving],
  } = await db.query(
    `insert into account (email_hash, status, role) values ($1, 'approved', 'member')
     returning account_id`,
    [emailHash("racing-removal@example.com")],
  );
  const token = signUnsubscribe({
    secret: SECRET,
    accountId: leaving.account_id,
    kind: "all",
  });
  // The removal holds the row, as {account_remove} does, while the click lands.
  await db.query("begin");
  await db.query(`select 1 from account where account_id = $1 for update`, [
    leaving.account_id,
  ]);
  const request = event({ method: "POST", path: "/api/email/unsubscribe" });
  request.queryStringParameters = { t: token };
  const {
    rows: [{ pid: remover }],
  } = await db.query("select pg_backend_pid() as pid");
  const pending = handler(request);
  // The click is queued behind the removal's row lock: observed, not
  // assumed after a sleep (on a loaded host a sleep ended before the
  // handler had reached the row, and the click read the finished removal).
  await waitUntilBlocked(db, { blockedBy: remover });
  await db.query(
    `update account set email_hash = 'removed:' || account_id::text, status = 'disabled'
      where account_id = $1`,
    [leaving.account_id],
  );
  await db.query("commit");
  const reply = await pending;
  assert.equal(reply.statusCode, 200, reply.body);
  const { rows } = await db.query(
    `select (select count(*)::int from account_email_pref where account_id = $1) as prefs,
            (select count(*)::int from account_event where account_id = $1) as events`,
    [leaving.account_id],
  );
  assert.deepEqual(rows[0], { prefs: 0, events: 0 });
});

// The site's email page as the build writes it: the bar, the stylesheet,
// the analytics tag and the section the API fills (apps/site
// email-page.njk). Only what the route reads is here.
const EMAIL_SHELL = `<!doctype html><html><head><title>Email - Elixir</title>
<link rel="stylesheet" href="/assets/site.css?v=1" /></head><body>
<header class="kit-top">bar</header><main class="wrap">
<section class="mx-auto" data-email-page><h1>Your Elixir email</h1></section>
</main><footer>not endorsed by Supercell</footer>
<script defer src="https://tinylytics.app/js/script.js" data-site="x"></script>
</body></html>`;

test("a turn-off link is answered in Elixir's own page, and the button gets a page, not the mail client's ok", async () => {
  const {
    rows: [person],
  } = await db.query(
    `insert into account (email_hash, status, role) values ($1, 'approved', 'member')
     returning account_id`,
    [emailHash("turn-off-page@example.com")],
  );
  const withShell = makeHandler({
    databaseUrl: DB_URL,
    secret: SECRET,
    emailShell: async () => EMAIL_SHELL,
  });
  const token = signUnsubscribe({
    secret: SECRET,
    accountId: person.account_id,
    kind: "tracking_report",
  });
  const call = (method, { t = token, body, accept } = {}) => {
    // As the edge delivers it: no Accept header ever reaches /api/*.
    const request = event({ method, path: "/api/email/unsubscribe" });
    request.queryStringParameters = { t };
    if (accept) request.headers.accept = accept;
    if (body !== undefined) request.body = body;
    return withShell(request);
  };

  const ask = await call("GET");
  assert.equal(ask.statusCode, 200);
  assert.match(ask.headers["content-type"], /^text\/html/);
  assert.match(ask.body, /<title>Turn off Your digest\? - Elixir<\/title>/);
  assert.match(ask.body, /class="kit-top"/, "the site's own bar");
  assert.match(ask.body, /site\.css/, "the site's own stylesheet");
  assert.match(
    ask.body,
    new RegExp(
      `<form method="post" action="/api/email/unsubscribe\\?t=${token}">`,
    ),
  );
  assert.doesNotMatch(ask.body, /Your Elixir email/, "the section is replaced");
  // The address carries a credential; no third-party script reads it.
  assert.doesNotMatch(ask.body, /tinylytics/);
  assert.match(ask.body, /not endorsed by Supercell/);

  // The person's button: no body, and no Accept (the edge drops it).
  const pressed = await call("POST");
  assert.equal(pressed.statusCode, 200);
  assert.match(pressed.headers["content-type"], /^text\/html/);
  assert.match(pressed.body, /<title>Your digest: off - Elixir<\/title>/);
  for (const href of ["/home", "/settings/emails", "/signin", "/"])
    assert.ok(pressed.body.includes(`href="${href}"`), `no way on to ${href}`);
  assert.match(pressed.body, /data-session-face="in"/);
  assert.match(pressed.body, /data-session-face="out"/);
  const {
    rows: [pref],
  } = await db.query(
    `select enabled, via from account_email_pref where account_id = $1 and kind = 'tracking_report'`,
    [person.account_id],
  );
  assert.deepEqual(pref, { enabled: false, via: "one_click" });

  // A mail client's RFC 8058 POST still gets a bare 2xx.
  const client = await call("POST", { body: "List-Unsubscribe=One-Click" });
  assert.equal(client.statusCode, 200);
  assert.equal(client.headers["content-type"], "text/plain");
  assert.equal(client.body, "ok");

  // A link that does not verify says so in the same page, with the way on.
  const stale = await call("GET", { t: "not-a-token" });
  assert.equal(stale.statusCode, 400);
  assert.match(stale.body, /This link has expired/);
  assert.match(stale.body, /class="kit-top"/);
  assert.ok(stale.body.includes('href="/signin"'));
});

test("a turn-off page still answers, with its ways on, when the site's page cannot be read", async () => {
  const {
    rows: [person],
  } = await db.query(
    `insert into account (email_hash, status, role) values ($1, 'approved', 'member')
     returning account_id`,
    [emailHash("turn-off-fallback@example.com")],
  );
  const token = signUnsubscribe({
    secret: SECRET,
    accountId: person.account_id,
    kind: "all",
  });
  for (const emailShell of [
    async () => {
      throw new Error("NoSuchKey");
    },
    // A shell without the section is not one to write into.
    async () => "<!doctype html><title>Something else</title>",
    null,
  ]) {
    const h = makeHandler({ databaseUrl: DB_URL, secret: SECRET, emailShell });
    const request = event({ method: "POST", path: "/api/email/unsubscribe" });
    request.queryStringParameters = { t: token };
    const reply = await h(request);
    assert.equal(reply.statusCode, 200);
    assert.match(reply.headers["content-type"], /^text\/html/);
    assert.match(reply.body, /Every email is off/);
    assert.match(reply.body, /Sign-in codes and account notices still come/);
    assert.ok(reply.body.includes('href="/settings/emails"'));
    assert.ok(reply.body.includes('href="/home"'));
    assert.match(reply.body, /not endorsed by Supercell/);
  }
});

test("retired email switches cannot be restored, while history and old unsubscribe links remain readable", async () => {
  const {
    rows: [account],
  } = await db.query("select account_id from account where email_hash = $1", [
    emailHash(NEWCOMER),
  ]);
  const accountId = account.account_id;
  // Every email off and on again leaves a retired row as it stood: the
  // digest reads the clan report's to send no more than before.
  await db.query(
    `insert into account_email_pref (account_id, kind, enabled, via)
     values ($1, 'clan_report', false, 'profile')
     on conflict (account_id, kind) do update set enabled = false`,
    [accountId],
  );
  for (const enabled of [false, true])
    assert.equal(
      (
        await handler(
          event({
            method: "PUT",
            path: "/api/me/email",
            cookie: memberCookie,
            body: { kind: "all", enabled },
          }),
        )
      ).statusCode,
      200,
    );
  const {
    rows: [held],
  } = await db.query(
    `select enabled from account_email_pref where account_id = $1 and kind = 'clan_report'`,
    [accountId],
  );
  assert.equal(held.enabled, false);
  for (const kind of [
    "top_100",
    "card_of_week",
    "clan_report",
    "arena_week",
    "milestone",
  ]) {
    const response = await handler(
      event({
        method: "PUT",
        path: "/api/me/email",
        cookie: memberCookie,
        body: { kind, enabled: true },
      }),
    );
    assert.equal(response.statusCode, 410);
    assert.equal(parse(response).error, "kind_retired");
    const token = signUnsubscribe({ secret: SECRET, accountId, kind });
    for (const method of ["GET", "POST"]) {
      const request = event({ method, path: "/api/email/unsubscribe" });
      request.queryStringParameters = { t: token };
      const reply = await handler(request);
      assert.equal(reply.statusCode, 200, reply.body);
      if (method === "GET") assert.match(reply.body, /has ended/);
    }
  }
  await handler(
    event({
      method: "PUT",
      path: "/api/me/email",
      cookie: memberCookie,
      body: { kind: "all", enabled: true },
    }),
  );
  const preferences = parse(
    await handler(
      event({ method: "GET", path: "/api/me/email", cookie: memberCookie }),
    ),
  ).kinds;
  assert.ok(
    !preferences.some((k) => ["top_100", "card_of_week"].includes(k.kind)),
  );
  const { rows: prefs } = await db.query(
    "select enabled from account_email_pref where account_id = $1 and kind in ('top_100', 'card_of_week')",
    [accountId],
  );
  assert.equal(prefs.length, 2);
  assert.ok(prefs.every((p) => p.enabled === false));
  const {
    rows: [issue],
  } = await db.query(
    "insert into email_issue (kind, period_key, subject_key, subject_line, status) values ('top_100', '2026-W38', $1, 'Archived issue', 'queued') returning issue_id",
    [accountId],
  );
  const {
    rows: [send],
  } = await db.query(
    "insert into email_send (issue_id, account_id, subject, archived) values ($1, $2, 'Archived issue', false) returning send_id",
    [issue.issue_id, accountId],
  );
  const list = parse(
    await handler(
      event({
        method: "GET",
        path: "/api/me/email/sends",
        cookie: memberCookie,
      }),
    ),
  ).sends;
  assert.ok(
    list.some((s) => s.send_id === send.send_id && s.kind === "top_100"),
  );
  const detail = await handler(
    event({
      method: "GET",
      path: `/api/me/email/sends/${send.send_id}`,
      cookie: memberCookie,
    }),
  );
  assert.equal(detail.statusCode, 200);
  assert.equal(parse(detail).send.kind, "top_100");
});

test("the digest's clan part is the person's to turn on and off, on the clan report's row", async () => {
  const {
    rows: [account],
  } = await db.query("select account_id from account where email_hash = $1", [
    emailHash(NEWCOMER),
  ]);
  const accountId = account.account_id;
  const put = async (body) =>
    handler(
      event({
        method: "PUT",
        path: "/api/me/email",
        cookie: memberCookie,
        body,
      }),
    );
  const digest = async () =>
    parse(
      await handler(
        event({ method: "GET", path: "/api/me/email", cookie: memberCookie }),
      ),
    ).kinds.find((k) => k.kind === "tracking_report");
  const stored = async () =>
    (
      await db.query(
        `select enabled from account_email_pref where account_id = $1 and kind = 'clan_report'`,
        [accountId],
      )
    ).rows[0]?.enabled;
  // Turned off before the merge, it stays off until the person says so.
  await db.query(
    `insert into account_email_pref (account_id, kind, enabled, via)
     values ($1, 'clan_report', false, 'profile')
     on conflict (account_id, kind) do update set enabled = false`,
    [accountId],
  );
  assert.equal((await digest()).clan_part, false);
  const on = await put({ kind: "tracking_report", clan_part: true });
  assert.equal(on.statusCode, 200, on.body);
  assert.deepEqual(parse(on), { kind: "tracking_report", clan_part: true });
  assert.equal(await stored(), true);
  assert.equal((await digest()).clan_part, true);
  // The digest's own switch and cadence are untouched by it.
  assert.equal((await digest()).cadence, "weekly");
  assert.equal(
    (await put({ kind: "tracking_report", clan_part: false })).statusCode,
    200,
  );
  assert.equal(await stored(), false);
  // Only the digest has a clan part, and it is a yes or a no.
  assert.equal(
    parse(await put({ kind: "collector_activity", clan_part: true })).error,
    "no_clan_part",
  );
  assert.equal(
    parse(await put({ kind: "tracking_report", clan_part: "on" })).error,
    "bad_clan_part",
  );
  // The clan report stays retired as a mail of its own.
  assert.equal(
    (await put({ kind: "clan_report", enabled: true })).statusCode,
    410,
  );
  assert.equal(await stored(), false);
  // Every other kind carries no clan part.
  const kinds = parse(
    await handler(
      event({ method: "GET", path: "/api/me/email", cookie: memberCookie }),
    ),
  ).kinds;
  for (const k of kinds.filter((x) => x.kind !== "tracking_report"))
    assert.equal(k.clan_part, null, k.kind);
});

test("retired personal and admin Collection routes are absent", async () => {
  for (const path of ["/api/me/collections", "/api/admin/collections"]) {
    for (const method of ["GET", "POST"]) {
      const r = await handler(
        event({
          method,
          path,
          cookie: bossCookie,
          body:
            method === "POST"
              ? {
                  action: "upsert",
                  slug: "retired-route",
                  title: "Retired",
                  kind: "player",
                }
              : undefined,
        }),
      );
      assert.equal(r.statusCode, 404);
    }
  }
});

test("admin Discord: the window's numbers and one clan's posts for an admin, refused to a member", async () => {
  const id = "cccccccc-0000-4000-8000-000000000001";
  await db.query(
    `insert into discord_post (post_id, feature, clan_tag, destination,
       webhook_fp, post_key, revision, action, mode, content, handed_at, outcome)
     values ($1, 'clan_actions', '#J2RGCRVG', '#J2RGCRVG', '0123456789abcdef',
             '12', 1, 'post', 'code', 'Promote Ada to Elder', now(), 'posted')`,
    [id],
  );
  const get = (path, cookie = bossCookie, query = undefined) =>
    handler({
      ...event({ method: "GET", path, cookie, body: undefined }),
      ...(query ? { queryStringParameters: query } : {}),
    });
  const summary = await get("/api/admin/discord", bossCookie, { days: "3" });
  assert.equal(summary.statusCode, 200, summary.body);
  const s = parse(summary);
  assert.equal(s.days, 3);
  assert.equal(
    s.features.find((f) => f.feature === "clan_actions").outcomes.posted,
    1,
  );
  const detail = await get("/api/admin/discord/J2RGCRVG", bossCookie, {
    feature: "clan_actions",
  });
  assert.equal(detail.statusCode, 200, detail.body);
  assert.equal(parse(detail).posts[0].content, "Promote Ada to Elder");
  assert.equal((await get("/api/admin/discord/not%20a%20tag")).statusCode, 404);
  assert.equal((await get("/api/admin/discord", memberCookie)).statusCode, 403);
  assert.equal(
    (await get("/api/admin/discord/J2RGCRVG", memberCookie)).statusCode,
    403,
  );
  await db.query(`delete from discord_post where post_id = $1`, [id]);
});
