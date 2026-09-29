/**
 * Consent honours the site session, and consent by code signs the site in
 * (0083, 2026-09-12). Every consent used to cost a trip to the inbox;
 * connecting the family's own products made that a daily tax.
 *
 * What must hold: a signed-in browser is shown a consent page with no
 * email step and can authorize in one POST; the grant it produces is the
 * ordinary grant (same scope rules, same widening rules, same principal
 * ownership rule); a client that wants account:email from an account with
 * no address on file is still sent the code way; ?switch=1 is a way out;
 * and the code path now sets the session cookie on its redirect.
 *
 * And (2026-09-29) a family app on Elixir's own origin that the person
 * has already granted everything it asks for is not asked again: the
 * code goes straight back. Anything less than a standing grant that
 * covers the request shows the page.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import {
  emailHash,
  createSession,
  resolveSession,
  SESSION_COOKIE_NAME,
  mintTokens,
  normalizeScope,
  registerClient,
  revokeToken,
} from "../../../packages/auth/src/index.mjs";
import { familyClientsOn } from "../../migrate/src/ops-family-clients.mjs";
import { makeHandler } from "../src/handler.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_sconsent_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);
const ISSUER = "https://elixir.poapkings.com";
const SECRET = "site-session-secret";
const EMAIL = "signed-in@example.com";
const NO_ADDRESS = "no-address@example.com";
const REDIRECT = "https://elixir.poapkings.com/api/clan/auth/callback";
const RESOURCE = `${ISSUER}/mcp`;

let db;
let handler;
let clientId;
let accountId;
let noAddressId;
const sentEmails = [];

const event = ({
  method = "POST",
  path: p = "/",
  query,
  body,
  form,
  cookie,
  headers = {},
}) => ({
  rawPath: p,
  requestContext: { http: { method, sourceIp: "9.9.9.9" } },
  queryStringParameters: query,
  headers: {
    ...(cookie ? { cookie: `${SESSION_COOKIE_NAME}=${cookie}` } : {}),
    "cloudfront-viewer-address": "203.0.113.7:4444",
    "cloudfront-viewer-country": "US",
    "user-agent":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    ...headers,
  },
  body: form ? new URLSearchParams(form).toString() : body,
});

const pkce = () => {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  return { verifier, challenge };
};

const authQuery = (scope = "cr:read") => ({
  client_id: clientId,
  redirect_uri: REDIRECT,
  state: "s",
  code_challenge: pkce().challenge,
  code_challenge_method: "S256",
  scope,
  resource: RESOURCE,
});

async function siteSession(email, id) {
  const minted = await createSession(db, {
    secret: SECRET,
    accountId: id,
    emailHash: emailHash(email),
  });
  return minted.token;
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
  const a = await db.query(
    `insert into account (email_hash, status, email) values ($1, 'approved', $2) returning account_id`,
    [emailHash(EMAIL), EMAIL],
  );
  accountId = a.rows[0].account_id;
  const b = await db.query(
    `insert into account (email_hash, status) values ($1, 'approved') returning account_id`,
    [emailHash(NO_ADDRESS)],
  );
  noAddressId = b.rows[0].account_id;
  handler = makeHandler({
    databaseUrl: DB_URL,
    issuer: ISSUER,
    sessionSecret: SECRET,
    sendLoginEmail: async (mail) => sentEmails.push(mail),
  });
  // A family app's client is provisioned, never registered (0185).
  ({
    provisioned: { client_id: clientId },
  } = await familyClientsOn(db, {
    provision: {
      app: "clan",
      client_name: "Elixir Clan",
      redirect_uris: [REDIRECT],
    },
  }));
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

test("a signed-in browser consents in one POST, with no email step and no mail", async () => {
  const cookie = await siteSession(EMAIL, accountId);
  const q = authQuery();
  const page = await handler(
    event({ method: "GET", path: "/oauth/authorize", query: q, cookie }),
  );
  assert.equal(page.statusCode, 200);
  assert.match(
    page.body,
    /You are signed in to Elixir as <strong>signed-in@example.com/,
  );
  assert.match(page.body, /name="step" value="session"/);
  assert.doesNotMatch(page.body, /type="email"/, "no address to type");
  assert.match(page.body, /switch=1/, "a way out for a shared browser");
  // The widening checkboxes are the same ones the code page offers,
  // unticked on a person's own connection (Jamie 2026-09-24).
  assert.match(
    page.body,
    /<input type="checkbox" name="grant" value="recordings:write">/,
  );

  const mailBefore = sentEmails.length;
  const consent = await handler(
    event({
      path: "/oauth/authorize",
      cookie,
      form: { step: "session", confirm: "1", ...q, grant: "feedback:write" },
    }),
  );
  assert.equal(consent.statusCode, 303, consent.body);
  const url = new URL(consent.headers.location);
  assert.equal(url.origin + url.pathname, REDIRECT);
  assert.match(url.searchParams.get("code"), /^eac_/);
  assert.equal(url.searchParams.get("iss"), ISSUER);
  assert.equal(sentEmails.length, mailBefore, "nothing mailed");
  assert.equal(
    consent.headers["set-cookie"],
    undefined,
    "the browser already holds a session; none is minted over it",
  );
  const { rows } = await db.query(
    `select account_id, scope from oauth_code order by created_at desc limit 1`,
  );
  assert.equal(rows[0].account_id, accountId, "the grant is the person's");
  assert.equal(
    rows[0].scope,
    "cr:read feedback:write",
    "the bound scope plus what was ticked; nothing else",
  );
});

test("without a session, or with ?switch=1, the email step is shown as before", async () => {
  const q = authQuery();
  const anon = await handler(
    event({ method: "GET", path: "/oauth/authorize", query: q }),
  );
  assert.match(anon.body, /type="email"/);
  assert.doesNotMatch(anon.body, /You are signed in/);

  const cookie = await siteSession(EMAIL, accountId);
  const switched = await handler(
    event({
      method: "GET",
      path: "/oauth/authorize",
      query: { ...q, switch: "1" },
      cookie,
    }),
  );
  assert.match(switched.body, /type="email"/);
  assert.doesNotMatch(switched.body, /You are signed in/);
});

test("a session POST without a live session falls back to the email step, never a grant", async () => {
  const q = authQuery();
  const res = await handler(
    event({
      path: "/oauth/authorize",
      cookie: "not-a-session-token",
      form: { step: "session", confirm: "1", ...q },
    }),
  );
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /sign-in has ended/);
  assert.match(res.body, /type="email"/);
});

test("a client wanting account:email from an account with no address goes the code way", async () => {
  const cookie = await siteSession(NO_ADDRESS, noAddressId);
  const q = authQuery("cr:read account:email");
  const page = await handler(
    event({ method: "GET", path: "/oauth/authorize", query: q, cookie }),
  );
  assert.match(page.body, /type="email"/, "the code path records the address");
  assert.doesNotMatch(page.body, /You are signed in/);

  // ...and the same client, for the account WITH an address, is served.
  const known = await siteSession(EMAIL, accountId);
  const served = await handler(
    event({
      method: "GET",
      path: "/oauth/authorize",
      query: q,
      cookie: known,
    }),
  );
  assert.match(served.body, /You are signed in/);
  assert.match(served.body, /Know your email address/);
});

test("consent by code signs the browser in to the site", async () => {
  const q = authQuery();
  await handler(
    event({
      path: "/oauth/authorize",
      form: { step: "email", email: EMAIL, ...q },
    }),
  );
  const { code } = sentEmails.at(-1);
  const done = await handler(
    event({
      path: "/oauth/authorize",
      form: { step: "code", confirm: "1", email: EMAIL, code, ...q },
    }),
  );
  assert.equal(done.statusCode, 303, done.body);
  const setCookie = done.headers["set-cookie"];
  assert.match(setCookie, new RegExp(`^${SESSION_COOKIE_NAME}=`));
  assert.match(setCookie, /HttpOnly; SameSite=Lax; Max-Age=7776000$/);
  const token = setCookie.split(";")[0].split("=")[1];
  const session = await resolveSession(db, { secret: SECRET, token });
  assert.equal(session.accountId, accountId);
  // The row remembers the device, for the Profile page.
  const { rows } = await db.query(
    `select client, last_seen_from, last_seen_country from session where session_id = $1`,
    [session.sessionId],
  );
  assert.deepEqual(rows[0], {
    client: "Safari on iPhone",
    last_seen_from: "203.0.113.7",
    last_seen_country: "US",
  });
});

test("consent by session cannot reach an agent the person does not own", async () => {
  // A stranger's agent door: same refusal as before, by session too.
  const { rows } = await db.query(
    `insert into account (kind, status, public_id, owned_by_account_id)
     values ('agent', 'approved', 'strangerbot', $1) returning account_id`,
    [noAddressId],
  );
  assert.ok(rows[0].account_id);
  const cookie = await siteSession(EMAIL, accountId);
  const q = { ...authQuery(), resource: `${ISSUER}/a/strangerbot/mcp` };
  const res = await handler(
    event({
      path: "/oauth/authorize",
      cookie,
      form: { step: "session", confirm: "1", ...q },
    }),
  );
  assert.equal(res.statusCode, 403);
  assert.match(res.body, /Not yours to connect/);
});

// ---- remembered consent (2026-09-29) ---------------------------------------

const API = `${ISSUER}/api/v1`;
const CLAN_SCOPE = "cr:read clans:attest";
const DROP_REDIRECT = "https://drop.poapkings.com/api/auth/callback";

let people = 0;
async function newPerson() {
  people += 1;
  const email = `remembered-${people}@example.com`;
  const { rows } = await db.query(
    `insert into account (email_hash, status, email) values ($1, 'approved', $2) returning account_id`,
    [emailHash(email), email],
  );
  const id = rows[0].account_id;
  return { id, cookie: await siteSession(email, id) };
}

const clanAsk = (scope = CLAN_SCOPE) => ({
  ...authQuery(scope),
  resource: API,
});

const authorize = (query, cookie, extra = {}) =>
  handler(
    event({ method: "GET", path: "/oauth/authorize", query, cookie, ...extra }),
  );

const codesFor = async (id) =>
  (
    await db.query(
      `select client_id, scope, resource from oauth_code where account_id = $1`,
      [id],
    )
  ).rows;

test("a standing grant to Clan that covers the request skips the page", async () => {
  const p = await newPerson();
  await mintTokens(db, {
    clientId,
    accountId: p.id,
    scope: CLAN_SCOPE,
    resource: API,
  });
  const res = await authorize(clanAsk(), p.cookie);
  assert.equal(res.statusCode, 303, res.body);
  const url = new URL(res.headers.location);
  assert.equal(url.origin + url.pathname, REDIRECT);
  assert.match(url.searchParams.get("code"), /^eac_/);
  assert.equal(url.searchParams.get("state"), "s");
  assert.equal(url.searchParams.get("iss"), ISSUER);
  assert.equal(res.headers["cache-control"], "no-store");
  assert.equal(res.headers["set-cookie"], undefined, "no session minted");
  assert.deepEqual(await codesFor(p.id), [
    { client_id: clientId, scope: normalizeScope(CLAN_SCOPE), resource: API },
  ]);

  // ?switch=1 is still the way out for a shared browser.
  const switched = await authorize({ ...clanAsk(), switch: "1" }, p.cookie);
  assert.equal(switched.statusCode, 200);
  assert.match(switched.body, /type="email"/);
});

test("a remembered consent grants what is asked, never more", async () => {
  const p = await newPerson();
  await mintTokens(db, {
    clientId,
    accountId: p.id,
    scope: `${CLAN_SCOPE} feedback:write`,
    resource: API,
  });
  // No page, so no boxes: a grant= riding the request widens nothing.
  const res = await authorize(clanAsk(), p.cookie, {
    form: { grant: "recordings:write" },
  });
  assert.equal(res.statusCode, 303, res.body);
  const [code] = await codesFor(p.id);
  assert.equal(code.scope, normalizeScope(CLAN_SCOPE));
});

test("the page comes back when no standing grant covers the request", async () => {
  const grant = (p, over = {}) =>
    mintTokens(db, {
      clientId,
      accountId: p.id,
      scope: CLAN_SCOPE,
      resource: API,
      ...over,
    });
  const cases = {
    "no grant yet": async () => {},
    "revoked, as Clan's sign-out does": async (p) => {
      const t = await grant(p);
      assert.equal(
        await revokeToken(db, { token: t.refreshToken, clientId }),
        true,
      );
    },
    "narrowed on the Connections page": async (p) => {
      const t = await grant(p);
      await db.query(
        `update oauth_family set scope = 'cr:read' where family_id = $1`,
        [t.familyId],
      );
    },
    "past its 90 days": async (p) => {
      const t = await grant(p);
      await db.query(
        `update oauth_family set absolute_expires_at = now() - interval '1 minute'
          where family_id = $1`,
        [t.familyId],
      );
    },
    "for another door": async (p) => grant(p, { resource: RESOURCE }),
    "another person's": async () => grant(await newPerson()),
  };
  for (const [label, setup] of Object.entries(cases)) {
    const p = await newPerson();
    await setup(p);
    const res = await authorize(clanAsk(), p.cookie);
    assert.equal(res.statusCode, 200, label);
    assert.match(res.body, /name="step" value="session"/, label);
    assert.deepEqual(await codesFor(p.id), [], `${label}: no code`);
  }
});

test("only a family app on Elixir's own origin is spared the page", async () => {
  const {
    provisioned: { client_id: dropId },
  } = await familyClientsOn(db, {
    provision: {
      app: "drop",
      client_name: "Elixir Drop",
      redirect_uris: [DROP_REDIRECT],
    },
  });
  const registered = await registerClient(db, {
    clientName: "Some MCP client",
    redirectUris: ["https://client.example/cb"],
  });
  const cases = [
    ["Drop, on its own origin", dropId, DROP_REDIRECT],
    ["a registered client", registered.clientId, "https://client.example/cb"],
  ];
  for (const [label, id, redirect] of cases) {
    const p = await newPerson();
    await mintTokens(db, {
      clientId: id,
      accountId: p.id,
      scope: "cr:read",
      resource: API,
    });
    const res = await authorize(
      {
        ...authQuery("cr:read"),
        client_id: id,
        redirect_uri: redirect,
        resource: API,
      },
      p.cookie,
    );
    assert.equal(res.statusCode, 200, label);
    assert.match(res.body, /name="step" value="session"/, label);
  }
});
