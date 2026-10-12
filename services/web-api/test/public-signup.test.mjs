import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import pg from "pg";
import { fileURLToPath } from "node:url";
import { emailHash, startMagicLogin } from "@elixir-mcp/auth";
import { addPlayer } from "@elixir-mcp/claims";
import { migrate } from "../../migrate/src/migrate.mjs";
import { makeHandler } from "../src/handler.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const adminUrl =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const name = `elixir_mcp_test_signup_${process.pid}`;
const databaseUrl = adminUrl.replace(/\/postgres$/, `/${name}`);
let db, handler, tagged;
const mails = [];
// The live lane a signup's first read goes through, faked: a call is a
// read asked for, and beforeMint is the pool's daily first-read charge.
const liveCalls = [];
async function fakeLive(_db, { endpoint, entityKey, beforeMint }) {
  await beforeMint();
  liveCalls.push({ endpoint, entityKey });
  return { ok: false, reason: "pending", queued: true, minted: true };
}
const welcomes = [];
let request = 0;
function event(p, body, cookie, ip = `198.51.100.${++request}`) {
  return {
    rawPath: p,
    requestContext: { http: { method: "POST", sourceIp: ip } },
    headers: {
      "x-elixir-client": "web",
      "cloudfront-viewer-address": `${ip}:443`,
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  };
}
const parse = (r) => JSON.parse(r.body);
const cookieOf = (r) => r.headers["set-cookie"].split(";")[0];
async function ask(email, ip, choice = undefined) {
  const response = await handler(
    event("/api/auth", { email, newsletter_opt_in: choice }, null, ip),
  );
  return { response, mail: mails.findLast((m) => m.email === email) };
}
async function signup(email) {
  const { mail } = await ask(email);
  const r = await handler(event("/api/auth/code", { email, code: mail.code }));
  assert.equal(r.statusCode, 200, r.body);
  return cookieOf(r);
}
before(async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();
  await migrate({
    databaseUrl,
    migrationsDir: path.join(root, "db/migrations"),
  });
  db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  handler = makeHandler({
    databaseUrl,
    secret: "signup-test-secret",
    sendLoginEmail: async (m) => mails.push(m),
    notifyOwner: async () => {},
    sendWelcomeEmail: async (m) => welcomes.push(m),
  });
  tagged = makeHandler({
    databaseUrl,
    secret: "signup-test-secret",
    sendLoginEmail: async (m) => mails.push(m),
    notifyOwner: async () => {},
    sendWelcomeEmail: async (m) => welcomes.push(m),
    live: fakeLive,
  });
});
after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database ${name} with (force)`);
  await admin.end();
});

test("public signup creates only a member after email proof; a failed code and a replay create nothing", async () => {
  const email = "new-public@example.com",
    hash = emailHash(email);
  const { mail, response } = await ask(email);
  assert.equal(response.statusCode, 200);
  assert.ok(mail.token && mail.code);
  assert.equal(mail.newsletter, false, "an unverified email is not enrolled");
  assert.equal(welcomes.length, 0);
  assert.equal(
    (await db.query("select 1 from account where email_hash=$1", [hash]))
      .rowCount,
    0,
  );
  const wrong = mail.code === "000000" ? "111111" : "000000";
  assert.equal(
    (await handler(event("/api/auth/code", { email, code: wrong }))).statusCode,
    400,
  );
  assert.equal(
    (await db.query("select 1 from account where email_hash=$1", [hash]))
      .rowCount,
    0,
  );
  const verified = await handler(
    event("/api/auth/code", {
      email,
      code: mail.code,
      role: "owner",
      is_owner: true,
    }),
  );
  assert.equal(verified.statusCode, 200, verified.body);
  const {
    rows: [account],
  } = await db.query("select * from account where email_hash=$1", [hash]);
  assert.equal(account.role, "member");
  assert.equal(account.kind, "person");
  assert.equal(account.status, "approved");
  assert.equal(account.is_owner, false);
  assert.equal(account.email, email);
  assert.deepEqual(
    welcomes.filter((m) => m.email === email),
    [{ email, newsletter: true }],
  );
  assert.equal(account.max_player_recordings, null);
  for (const table of ["claim", "account_clan", "gateway"]) {
    const column = table === "gateway" ? "owner_account_id" : "account_id";
    assert.equal(
      (
        await db.query(`select 1 from ${table} where ${column}=$1`, [
          account.account_id,
        ])
      ).rowCount,
      0,
    );
  }
  assert.equal(
    (await handler(event("/api/auth/redeem", { token: mail.token })))
      .statusCode,
    400,
  );
  assert.equal(
    (await db.query("select 1 from account where email_hash=$1", [hash]))
      .rowCount,
    1,
  );
});

test("new signup freezes checked and unchecked news choices in code/link proof, ignoring redeem payloads", async () => {
  for (const choice of [false, true]) {
    for (const method of ["code", "redeem"]) {
      const email = `news-${choice}-${method}@example.com`;
      const { mail } = await ask(email, undefined, choice);
      assert.equal(mail.newsletter, false);
      assert.equal(
        (
          await db.query("select 1 from account where email_hash=$1", [
            emailHash(email),
          ])
        ).rowCount,
        0,
      );
      const result = await handler(
        event(`/api/auth/${method}`, {
          email,
          code: mail.code,
          token: mail.token,
          newsletter_opt_in: !choice,
        }),
      );
      assert.equal(result.statusCode, 200, result.body);
      const {
        rows: [account],
      } = await db.query(
        "select newsletter_opt_in from account where email_hash=$1",
        [emailHash(email)],
      );
      assert.equal(account.newsletter_opt_in, choice);
      assert.deepEqual(
        welcomes.filter((m) => m.email === email),
        [{ email, newsletter: choice }],
      );
    }
  }
});

test("unchecked resends, cross-device proof and collection preserve the new account's choice", async () => {
  const email = "news-handoff@example.com";
  await ask(email, "198.51.100.171", false);
  const { mail, response } = await ask(email, "198.51.100.171", false);
  const redeemed = await handler(
    event(
      "/api/auth/redeem",
      { token: mail.token, newsletter_opt_in: true },
      null,
      "198.51.100.172",
    ),
  );
  assert.equal(redeemed.statusCode, 200, redeemed.body);
  const handoff = parse(redeemed).handoff;
  assert.equal(handoff.state, "confirm");
  assert.equal(
    (
      await handler(
        event(
          "/api/auth/handoff",
          { confirm: handoff.confirm },
          cookieOf(redeemed),
        ),
      )
    ).statusCode,
    200,
  );
  const collected = await handler(
    event(
      "/api/auth/poll",
      { poll_id: parse(response).poll_id },
      null,
      "198.51.100.171",
    ),
  );
  assert.equal(parse(collected).ready, true);
  assert.deepEqual(
    welcomes.filter((m) => m.email === email),
    [{ email, newsletter: false }],
  );
  const later = await ask(email, undefined, true);
  assert.equal(
    later.mail.newsletter,
    false,
    "default-on subsequent sign-in does not override the saved opt-out",
  );
});

test("invalid choice cannot issue mail; existing approved and pending accounts preserve either preference", async () => {
  const invalid = await ask("news-invalid@example.com", undefined, "false");
  assert.equal(invalid.response.statusCode, 400);
  assert.equal(invalid.mail, undefined);
  for (const status of ["approved", "requested"]) {
    for (const saved of [false, true]) {
      const email = `news-existing-${status}-${saved}@example.com`;
      await db.query(
        "insert into account (email_hash,email,status,role,kind,newsletter_opt_in) values ($1,$2,$3,'member','person',$4)",
        [emailHash(email), email, status, saved],
      );
      const { mail } = await ask(email, undefined, !saved);
      assert.equal(mail.newsletter, status === "approved" && saved);
      const result = await handler(
        event("/api/auth/code", { email, code: mail.code }),
      );
      assert.equal(result.statusCode, 200);
      const {
        rows: [account],
      } = await db.query(
        "select newsletter_opt_in from account where email_hash=$1",
        [emailHash(email)],
      );
      assert.equal(account.newsletter_opt_in, saved);
    }
  }
});

// Jamie, 2026-10-08: "Approved: new elixir accounts take the browser's
// time zone at signup". The zone rides the request, like the news choice.
async function askZoned(email, timezone, ip) {
  const response = await handler(
    event("/api/auth", { email, timezone }, null, ip),
  );
  assert.equal(response.statusCode, 200, response.body);
  return { response, mail: mails.findLast((m) => m.email === email) };
}
const zoneOf = async (email) =>
  (
    await db.query("select timezone from account where email_hash=$1", [
      emailHash(email),
    ])
  ).rows[0]?.timezone;

test("a new account opens on the signup browser's zone, by code or by link", async () => {
  for (const method of ["code", "redeem"]) {
    const email = `zone-new-${method}@example.com`;
    const { mail } = await askZoned(email, "America/Chicago");
    assert.equal(await zoneOf(email), undefined, "no account before proof");
    const result = await handler(
      event(`/api/auth/${method}`, {
        email,
        code: mail.code,
        token: mail.token,
        timezone: "Asia/Tokyo",
      }),
    );
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(await zoneOf(email), "America/Chicago");
  }
});

test("a link opened on another device opens the account on the asking browser's zone", async () => {
  const email = "zone-handoff@example.com";
  const { mail, response } = await askZoned(
    email,
    "Europe/Berlin",
    "198.51.100.181",
  );
  const redeemed = await handler(
    event(
      "/api/auth/redeem",
      { token: mail.token, timezone: "America/New_York" },
      null,
      "198.51.100.182",
    ),
  );
  assert.equal(parse(redeemed).handoff.state, "confirm");
  assert.equal(await zoneOf(email), "Europe/Berlin");
  await handler(
    event(
      "/api/auth/handoff",
      { confirm: parse(redeemed).handoff.confirm },
      cookieOf(redeemed),
    ),
  );
  const collected = await handler(
    event(
      "/api/auth/poll",
      { poll_id: parse(response).poll_id },
      null,
      "198.51.100.181",
    ),
  );
  assert.equal(parse(collected).ready, true);
  assert.equal(await zoneOf(email), "Europe/Berlin");
});

test("a missing, UTC or invalid signup zone leaves the new account on UTC and never refuses the mail", async () => {
  for (const [i, zone] of [
    undefined,
    "",
    "UTC",
    "utc",
    "Mars/Olympus_Mons",
    "America/Chicago; drop table account",
    "x".repeat(5000),
    42,
    ["America/Chicago"],
    { tz: "America/Chicago" },
  ].entries()) {
    const email = `zone-invalid-${i}@example.com`;
    const { mail } = await askZoned(email, zone);
    assert.ok(mail?.code, `mail issued for ${JSON.stringify(zone)}`);
    const result = await handler(
      event("/api/auth/code", { email, code: mail.code }),
    );
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(await zoneOf(email), null, JSON.stringify(zone));
  }
});

test("signing in to an existing account never changes its zone", async () => {
  for (const status of ["approved", "requested"]) {
    for (const saved of [null, "Europe/Oslo"]) {
      const email = `zone-existing-${status}-${saved ?? "none"}@example.com`;
      await db.query(
        "insert into account (email_hash,email,status,role,kind,timezone) values ($1,$2,$3,'member','person',$4)",
        [emailHash(email), email, status, saved],
      );
      for (const method of ["code", "redeem"]) {
        const { mail } = await askZoned(email, "America/Chicago");
        const result = await handler(
          event(`/api/auth/${method}`, {
            email,
            code: mail.code,
            token: mail.token,
          }),
        );
        assert.equal(result.statusCode, 200, result.body);
        assert.equal(await zoneOf(email), saved, `${status} ${method}`);
      }
    }
  }
});

test("different concurrent signup choices preserve the creator's frozen choice and queue one welcome", async () => {
  const email = "news-concurrent@example.com";
  const first = await ask(email, undefined, false);
  const second = await ask(email, undefined, true);
  const results = await Promise.all(
    [first, second].map(({ mail }) =>
      handler(event("/api/auth/redeem", { token: mail.token })),
    ),
  );
  assert.deepEqual(
    results.map((r) => r.statusCode),
    [200, 200],
  );
  const sent = welcomes.filter((m) => m.email === email);
  assert.equal(sent.length, 1);
  const {
    rows: [account],
  } = await db.query(
    "select newsletter_opt_in from account where email_hash=$1",
    [emailHash(email)],
  );
  assert.equal(account.newsletter_opt_in, sent[0].newsletter);
});

test("repeated and concurrent link redemption opens one account and one session", async () => {
  const email = "racing-public@example.com";
  const first = await ask(email);
  await ask(email);
  const results = await Promise.all(
    [1, 2].map(() =>
      handler(event("/api/auth/redeem", { token: first.mail.token })),
    ),
  );
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 400]);
  const { rows: accounts } = await db.query(
    "select account_id from account where email_hash=$1",
    [emailHash(email)],
  );
  assert.equal(accounts.length, 1);
  assert.equal(
    (
      await db.query("select 1 from session where account_id=$1", [
        accounts[0].account_id,
      ])
    ).rowCount,
    1,
  );
});

test("a new account's cross-device sign-in needs confirmation before the asking screen collects", async () => {
  const email = "handoff-public@example.com";
  const { response, mail } = await ask(email, "198.51.100.70");
  const poll_id = parse(response).poll_id;
  const early = await handler(event("/api/auth/poll", { poll_id }));
  assert.deepEqual(parse(early), { ready: false });
  const redeemed = await handler(
    event("/api/auth/redeem", { token: mail.token }, null, "198.51.100.71"),
  );
  const handoff = parse(redeemed).handoff;
  assert.equal(handoff.state, "confirm");
  assert.deepEqual(parse(await handler(event("/api/auth/poll", { poll_id }))), {
    ready: false,
  });
  assert.equal(
    (
      await handler(
        event(
          "/api/auth/handoff",
          { confirm: handoff.confirm },
          cookieOf(redeemed),
        ),
      )
    ).statusCode,
    200,
  );
  assert.equal(
    parse(await handler(event("/api/auth/poll", { poll_id }))).ready,
    true,
  );
  assert.deepEqual(parse(await handler(event("/api/auth/poll", { poll_id }))), {
    ready: false,
  });
});

test("current denial, disablement or privileged pending state cannot be bypassed by a previously issued signup link", async () => {
  for (const [status, role, kind] of [
    ["denied", "member", "person"],
    ["disabled", "member", "person"],
    ["requested", "admin", "person"],
    ["requested", "member", "agent"],
    ["approved", "member", "agent"],
  ]) {
    const email = `${status}-${role}-${kind}@example.com`;
    const { mail } = await ask(email);
    await db.query(
      "insert into account(email_hash,status,role,kind,owned_by_account_id) values($1,$2,$3,$4,case when $4='agent' then (select account_id from account where email='new-public@example.com') end)",
      [emailHash(email), status, role, kind],
    );
    const res = await handler(event("/api/auth/redeem", { token: mail.token }));
    assert.equal(res.statusCode, 403, res.body);
    assert.equal(res.headers["set-cookie"], undefined);
    const {
      rows: [kept],
    } = await db.query(
      "select status,role,kind from account where email_hash=$1",
      [emailHash(email)],
    );
    assert.deepEqual(kept, { status, role, kind });
    const sent = mails.length;
    const retry = await ask(email);
    assert.equal(retry.response.statusCode, 200);
    assert.equal(mails.length, sent);
  }
});

test("ordinary pending members may verify; existing account tier and opt-out survive a repeat", async () => {
  const email = "pending-public@example.com",
    hash = emailHash(email);
  await db.query(
    "insert into account(email_hash,status) values($1,'requested')",
    [hash],
  );
  const pending = await ask(email);
  assert.equal(pending.mail.newsletter, false);
  assert.equal(
    (await handler(event("/api/auth/code", { email, code: pending.mail.code })))
      .statusCode,
    200,
  );
  assert.deepEqual(
    welcomes.filter((m) => m.email === email),
    [{ email, newsletter: true }],
  );
  await db.query(
    "update account set role='leader',newsletter_opt_in=false where email_hash=$1",
    [hash],
  );
  const { mail } = await ask(email);
  assert.equal(mail.newsletter, false);
  assert.equal(
    (await handler(event("/api/auth/redeem", { token: mail.token })))
      .statusCode,
    200,
  );
  const {
    rows: [kept],
  } = await db.query(
    "select role,newsletter_opt_in from account where email_hash=$1",
    [hash],
  );
  assert.deepEqual(kept, { role: "leader", newsletter_opt_in: false });
});

test("an expired or OAuth-purpose link cannot open a public account or consume another flow", async () => {
  const email = "expired-public@example.com",
    { mail } = await ask(email);
  await db.query(
    "update magic_login set expires_at=now()-interval '1 second' where email_hash=$1",
    [emailHash(email)],
  );
  assert.equal(
    (await handler(event("/api/auth/redeem", { token: mail.token })))
      .statusCode,
    400,
  );
  assert.equal(
    (
      await db.query("select 1 from account where email_hash=$1", [
        emailHash(email),
      ])
    ).rowCount,
    0,
  );
  const oauth = await startMagicLogin(db, {
    emailHash: emailHash(email),
    purpose: "oauth",
    context: { signup_email: email },
  });
  assert.equal(
    (await handler(event("/api/auth/redeem", { token: oauth.token })))
      .statusCode,
    400,
  );
  assert.equal(
    (
      await db.query(
        "select used_at from magic_login where email_hash=$1 and purpose='oauth'",
        [emailHash(email)],
      )
    ).rows[0].used_at,
    null,
  );
});

test("signup repeats respect the existing per-address and per-viewer mail boundaries, including races", async () => {
  const email = "limited-public@example.com";
  const results = await Promise.all(
    Array.from({ length: 7 }, () => ask(email)),
  );
  assert.equal(results.filter((r) => parse(r.response).limited).length, 2);
  assert.equal(mails.filter((m) => m.email === email).length, 5);
  const ip = "203.0.113.200";
  const viewer = await Promise.all(
    Array.from({ length: 12 }, (_, i) => ask(`ip${i}@example.com`, ip)),
  );
  assert.equal(viewer.filter((r) => parse(r.response).limited).length, 2);
});

test("a public member retains recording slot limits across concurrent adds and cannot provision a collector", async () => {
  const email = "quota-public@example.com",
    cookie = await signup(email);
  const {
    rows: [account],
  } = await db.query("select account_id from account where email_hash=$1", [
    emailHash(email),
  ]);
  for (let i = 0; i < 49; i++) {
    const tag = `#P${[...i.toString(4).padStart(5, "0")].map((d) => "0289"[Number(d)]).join("")}`;
    assert.equal(
      (
        await addPlayer(
          db,
          { accountId: account.account_id },
          { tag, via: "test" },
        )
      ).ok,
      true,
    );
  }
  const players = await Promise.all(
    ["#QPPPP", "#QGGGG"].map((player_tag) =>
      handler(event("/api/claims", { player_tag }, cookie)),
    ),
  );
  assert.deepEqual(players.map((r) => r.statusCode).sort(), [200, 429]);
  assert.equal(
    (
      await db.query("select 1 from claim where account_id=$1", [
        account.account_id,
      ])
    ).rowCount,
    50,
  );
  const clans = await Promise.all(
    ["#PQQQQ", "#PGGGG"].map((clan_tag) =>
      handler(event("/api/me/clans", { clan_tag, scope: "activity" }, cookie)),
    ),
  );
  assert.deepEqual(clans.map((r) => r.statusCode).sort(), [200, 429]);
  const deep = await handler(
    event(
      "/api/me/clans",
      { clan_tag: "#PRRRR", scope: "comprehensive" },
      cookie,
    ),
  );
  assert.equal(deep.statusCode, 429);
  const raised = await handler(
    event("/api/gateways", { name: "public-test-collector" }, cookie),
  );
  // Open enrollment (#540): the raise is approved at once, on probation,
  // with its token staged for this account's own reveal. Minting for
  // someone else's collector stays the maintainer's.
  assert.equal(parse(raised).status, "probation");
  const provision = await handler(
    event(
      "/api/admin/gateways",
      { gateway_id: parse(raised).gateway_id, action: "provision_token" },
      cookie,
    ),
  );
  assert.equal(provision.statusCode, 403);
  const {
    rows: [gateway],
  } = await db.query(
    "select status,provision_env from gateway where gateway_id=$1",
    [parse(raised).gateway_id],
  );
  assert.equal(gateway.status, "probation");
  assert.match(gateway.provision_env, /^emcg_/);
});

test("handoff collection and existing sessions refuse an account that becomes a non-person", async () => {
  const email = "changed-kind@example.com";
  const { response, mail } = await ask(email, "198.51.100.92");
  const redeemed = await handler(
    event("/api/auth/redeem", { token: mail.token }, null, "198.51.100.92"),
  );
  assert.equal(redeemed.statusCode, 200);
  const cookie = cookieOf(redeemed);
  await db.query(
    "update account set kind='agent',owned_by_account_id=(select account_id from account where email='new-public@example.com') where email_hash=$1",
    [emailHash(email)],
  );
  const poll = await handler(
    event("/api/auth/poll", { poll_id: parse(response).poll_id }),
  );
  assert.equal(poll.statusCode, 403);
  assert.equal(poll.headers["set-cookie"], undefined);
  const me = event("/api/me", undefined, cookie);
  me.requestContext.http.method = "GET";
  assert.equal(parse(await handler(me)).authenticated, false);
});

test("distinct concurrent verified links keep one identity and send one welcome", async () => {
  const email = "two-proofs@example.com";
  const one = await ask(email),
    two = await ask(email);
  const outcomes = await Promise.all(
    [one.mail.token, two.mail.token].map((token) =>
      handler(event("/api/auth/redeem", { token })),
    ),
  );
  assert.deepEqual(
    outcomes.map((r) => r.statusCode),
    [200, 200],
  );
  assert.equal(
    (
      await db.query("select 1 from account where email_hash=$1", [
        emailHash(email),
      ])
    ).rowCount,
    1,
  );
  assert.equal(welcomes.filter((m) => m.email === email).length, 1);
});

// The signup form's optional player tag (2026-10-12): normalized at the
// request, frozen with the code like the news choice and the zone, and
// applied only after the address is proved.
async function askTagged(email, player_tag, ip) {
  const response = await tagged(
    event("/api/auth", { email, player_tag }, null, ip),
  );
  return { response, mail: mails.findLast((m) => m.email === email) };
}
const accountOf = async (email) =>
  (
    await db.query(
      "select account_id, requested_player_tag, onboarded_at from account where email_hash=$1",
      [emailHash(email)],
    )
  ).rows[0];

test("a signup tag is frozen at the request and claimed, with its clan, only after proof", async () => {
  const email = "tagged-signup@example.com";
  // Elixir already knows this player's clan (another account records it).
  await db.query(
    "insert into player (player_tag, last_known_clan_tag) values ('#2PYQ8GJ0', '#QPPPP')",
  );
  const before = liveCalls.length;
  const { response, mail } = await askTagged(email, " 2pyq8gjo ");
  assert.equal(response.statusCode, 200, response.body);
  assert.ok(mail?.code);
  const {
    rows: [frozen],
  } = await db.query(
    "select context from magic_login where email_hash=$1 order by created_at desc limit 1",
    [emailHash(email)],
  );
  assert.equal(frozen.context.signup_player_tag, "#2PYQ8GJ0");
  assert.equal(await accountOf(email), undefined, "nothing before proof");
  assert.equal(liveCalls.length, before, "no read for an unproved address");

  const verified = await tagged(
    event("/api/auth/code", { email, code: mail.code, player_tag: "#GGGG" }),
  );
  assert.equal(verified.statusCode, 200, verified.body);
  assert.deepEqual(parse(verified).new_account, { player_tag: "#2PYQ8GJ0" });
  const account = await accountOf(email);
  assert.equal(account.requested_player_tag, "#2PYQ8GJ0");
  assert.ok(account.onboarded_at, "onboarding finished with the clan known");
  const claims = async () =>
    (
      await db.query(
        "select player_tag, is_primary from claim where account_id=$1",
        [account.account_id],
      )
    ).rows;
  const clans = async () =>
    (
      await db.query(
        "select clan_tag, scope from account_clan where account_id=$1",
        [account.account_id],
      )
    ).rows;
  assert.deepEqual(await claims(), [
    { player_tag: "#2PYQ8GJ0", is_primary: true },
  ]);
  assert.deepEqual(await clans(), [{ clan_tag: "#QPPPP", scope: "activity" }]);
  assert.deepEqual(liveCalls.slice(before), [
    { endpoint: "player", entityKey: "#2PYQ8GJ0" },
  ]);

  // A second sign-in, even naming another tag, changes nothing.
  const again = await askTagged(email, "#GGGG");
  const second = await tagged(
    event("/api/auth/code", { email, code: again.mail.code }),
  );
  assert.equal(second.statusCode, 200, second.body);
  assert.equal(parse(second).new_account, undefined);
  assert.deepEqual(await claims(), [
    { player_tag: "#2PYQ8GJ0", is_primary: true },
  ]);
  assert.deepEqual(await clans(), [{ clan_tag: "#QPPPP", scope: "activity" }]);
  assert.equal((await accountOf(email)).requested_player_tag, "#2PYQ8GJ0");
  assert.equal(liveCalls.length, before + 1);
});

test("a link carries a new account's landing through the handoff answer", async () => {
  const email = "tagged-link@example.com";
  const { mail } = await askTagged(email, "#LQQQQ", "198.51.100.201");
  const redeemed = await tagged(
    event("/api/auth/redeem", { token: mail.token }, null, "198.51.100.202"),
  );
  assert.equal(redeemed.statusCode, 200, redeemed.body);
  const body = parse(redeemed);
  assert.deepEqual(body.new_account, { player_tag: "#LQQQQ" });
  assert.equal(body.handoff.state, "confirm");
});

test("the first sign-in to an account made for them lands a person on Tracking, once", async () => {
  // As {account_enroll} makes one with no tag: approved, not onboarded.
  const email = "enrolled-tagless@example.com";
  await db.query(
    `insert into account (email_hash, email, status, role, kind, decided_at)
     values ($1, $2, 'approved', 'member', 'person', now())`,
    [emailHash(email), email],
  );
  const first = await ask(email);
  const signedIn = await handler(
    event("/api/auth/code", { email, code: first.mail.code }),
  );
  assert.equal(signedIn.statusCode, 200, signedIn.body);
  assert.deepEqual(parse(signedIn).new_account, { player_tag: null });
  assert.ok((await accountOf(email)).onboarded_at);

  const again = await ask(email);
  const second = await handler(
    event("/api/auth/code", { email, code: again.mail.code }),
  );
  assert.equal(parse(second).new_account, undefined);
});

test("a malformed signup tag is refused before any mail; an empty one is no tag", async () => {
  const sent = mails.length;
  for (const [player_tag, error] of [
    ["not a tag!", "invalid_tag"],
    ["#AB", "invalid_tag"],
    ["#" + "2".repeat(13), "invalid_tag"],
    [42, "bad_request"],
    [["#2PYQ8GJ0"], "bad_request"],
  ]) {
    const { response } = await askTagged(
      "malformed-tag@example.com",
      player_tag,
    );
    assert.equal(response.statusCode, 400, JSON.stringify(player_tag));
    assert.equal(parse(response).error, error);
  }
  assert.equal(mails.length, sent, "no code was mailed");
  assert.equal(await accountOf("malformed-tag@example.com"), undefined);

  for (const [i, player_tag] of ["", "   ", null].entries()) {
    const email = `empty-tag-${i}@example.com`;
    const { response, mail } = await askTagged(email, player_tag);
    assert.equal(response.statusCode, 200, response.body);
    const verified = await tagged(
      event("/api/auth/code", { email, code: mail.code }),
    );
    assert.deepEqual(parse(verified).new_account, { player_tag: null });
    const account = await accountOf(email);
    assert.equal(account.requested_player_tag, null);
    assert.equal(
      (
        await db.query("select 1 from claim where account_id=$1", [
          account.account_id,
        ])
      ).rowCount,
      0,
    );
  }
});

test("a signup tag Elixir has never seen is claimed; its clan waits for the first profile", async () => {
  const email = "unseen-tag@example.com";
  const { mail } = await askTagged(email, "#CCCCC");
  const verified = await tagged(
    event("/api/auth/code", { email, code: mail.code }),
  );
  assert.deepEqual(parse(verified).new_account, { player_tag: "#CCCCC" });
  const account = await accountOf(email);
  const {
    rows: [claim],
  } = await db.query(
    "select player_tag, is_primary from claim where account_id=$1",
    [account.account_id],
  );
  assert.deepEqual(claim, { player_tag: "#CCCCC", is_primary: true });
  // No clan is knowable yet: the primary's clan is followed when its
  // first profile is admitted (claims followClanForPlayer), which this
  // new account is switched on for.
  const {
    rows: [acct],
  } = await db.query(
    "select auto_follow_clan from account where account_id=$1",
    [account.account_id],
  );
  assert.equal(acct.auto_follow_clan, true);
  assert.equal(
    (
      await db.query("select 1 from account_clan where account_id=$1", [
        account.account_id,
      ])
    ).rowCount,
    0,
  );
});
