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
let liveProfile = null;

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
    liveFetch: async () =>
      liveProfile
        ? { ok: true, payload: liveProfile }
        : { ok: false, reason: "timeout" },
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

test("liveness verification: challenge -> wrong favourite -> right favourite -> verified", async () => {
  // Seed the card catalog the picker draws from.
  await db.query(
    `insert into api_payload (endpoint, entity_key, payload_hash, payload_json)
     values ('cards', 'GLOBAL', 'vh', '{"items": [{"id": 26000055, "name": "Mega Knight"}]}')
     on conflict do nothing`,
  );
  // The newcomer's claim from the journey test (#2PP0V90Y) is unverified.
  const cookie = await signIn(NEWCOMER);
  const start = await handler(
    event({
      path: "/api/claims/verify",
      cookie,
      body: { player_tag: "#2PP0V90Y" },
    }),
  );
  assert.equal(start.statusCode, 200, start.body);
  const ch = parse(start);
  assert.equal(ch.card_name, "Mega Knight");
  assert.match(ch.instructions, /favourite card/);

  // Wrong favourite: stays pending with an honest message.
  liveProfile = {
    tag: "#2PP0V90Y",
    currentFavouriteCard: { id: 1, name: "Knight" },
  };
  const wrong = parse(
    await handler(
      event({
        path: "/api/claims/verify/check",
        cookie,
        body: { player_tag: "#2PP0V90Y" },
      }),
    ),
  );
  assert.equal(wrong.verified, false);
  assert.match(wrong.message, /Knight/);

  // Right favourite: claim flips to verified.
  liveProfile = {
    tag: "#2PP0V90Y",
    currentFavouriteCard: { id: 26000055, name: "Mega Knight" },
  };
  const right = parse(
    await handler(
      event({
        path: "/api/claims/verify/check",
        cookie,
        body: { player_tag: "#2PP0V90Y" },
      }),
    ),
  );
  assert.equal(right.verified, true);
  const { rows } = await db.query(
    `select status, verified_method from claim where player_tag = '#2PP0V90Y'`,
  );
  assert.equal(rows[0].status, "verified");
  assert.equal(rows[0].verified_method, "favourite_card");

  // Already verified short-circuits.
  const again = parse(
    await handler(
      event({
        path: "/api/claims/verify",
        cookie,
        body: { player_tag: "#2PP0V90Y" },
      }),
    ),
  );
  assert.equal(again.already_verified, true);
});

test("clan page: entitled member sees war + roster; share toggle; outsiders refused", async () => {
  const cookie = await signIn(NEWCOMER);

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
  assert.ok(res.my_claims.some((c) => c.player_tag === "#2PP0V90Y"));

  // The owner falls back to the first active recorded clan.
  const ownerCookie = await signIn(JAMIE);
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

  // Consent toggle: flips the claim's share flag; unclaimed tags refused.
  const on = parse(
    await handler(
      event({
        path: "/api/me/share-battles",
        cookie,
        body: { player_tag: "#2PP0V90Y", share: true },
      }),
    ),
  );
  assert.equal(on.share, true);
  const { rows } = await db.query(
    `select share_battles_with_clan from claim where player_tag = '#2PP0V90Y'`,
  );
  assert.equal(rows[0].share_battles_with_clan, true);
  const notMine = await handler(
    event({
      path: "/api/me/share-battles",
      cookie,
      body: { player_tag: "#YYYYY", share: true },
    }),
  );
  assert.equal(notMine.statusCode, 403);
});

test("gateway raise-hand and lifecycle: pending -> probation -> active; revoke; guards", async () => {
  const cookie = await signIn(NEWCOMER);
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
  const ownerCookie = await signIn(JAMIE);
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
