/**
 * The OAuth door opens accounts (Jamie, 2026-10-12: "whatever page Drop
 * sends for login with Elixir allows someone to sign in OR create an
 * account"), exactly as the website's signup does.
 *
 * What must hold: a new address is mailed a code and gets NO account
 * until the code is proved; the proved code opens an ordinary member
 * account (the product-news box as posted, the welcome mail once) and
 * finishes the authorization; a denied address is still refused; the
 * existing-account path is unchanged; and the door carries the website's
 * guards: a malformed address mails nothing, and one caller's ceiling is
 * shared with the website's sign-in.
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
  registerClient,
  signinMailFromAllowed,
  SIGNIN_MAIL_PER_IP_HOUR,
} from "../../../packages/auth/src/index.mjs";
import { familyClientsOn } from "../../migrate/src/ops-family-clients.mjs";
import { makeHandler } from "../src/handler.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_osignup_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);
const ISSUER = "https://elixir.poapkings.com";
const SECRET = "site-session-secret";
const REDIRECT = "https://client.example/cb";
const DROP_REDIRECT = "https://drop.poapkings.com/api/auth/callback";
const API = `${ISSUER}/api/v1`;

let db;
let handler;
let registeredId;
let dropId;
let ips = 0;
const logins = [];
const welcomes = [];

/** Each test its own caller, so one test's mail never spends another's
 *  per-caller ceiling. */
const nextIp = () => {
  ips += 1;
  return `198.51.100.${ips}`;
};

const event = ({ method = "POST", query, form, ip }) => ({
  path: "/oauth/authorize",
  method,
  queryStringParameters: query,
  headers: { "cloudfront-viewer-address": `${ip}:4444` },
  body: form ? new URLSearchParams(form).toString() : undefined,
});

const pkce = () =>
  crypto
    .createHash("sha256")
    .update(crypto.randomBytes(32).toString("base64url"))
    .digest("base64url");

const ask = ({ family = false, scope = "cr:read" } = {}) => ({
  client_id: family ? dropId : registeredId,
  redirect_uri: family ? DROP_REDIRECT : REDIRECT,
  state: "s",
  code_challenge: pkce(),
  code_challenge_method: "S256",
  scope,
  resource: API,
});

const accountOf = async (email) =>
  (
    await db.query(
      `select account_id, status, role, kind, email, newsletter_opt_in
         from account where email_hash = $1`,
      [emailHash(email)],
    )
  ).rows[0] ?? null;

/** The email step, then the code it mailed (or null when none went). */
async function emailStep(email, q, ip, extra = { product_news: "1" }) {
  const before = logins.length;
  const res = await handler(
    event({ form: { step: "email", email, ...q, ...extra }, ip }),
  );
  return { res, mail: logins.length > before ? logins.at(-1) : null };
}

const codeStep = (email, code, q, ip) =>
  handler(event({ form: { step: "code", email, code, ...q }, ip }));

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
    issuer: ISSUER,
    sessionSecret: SECRET,
    sendLoginEmail: async (mail) => logins.push(mail),
    sendWelcomeEmail: async (mail) => welcomes.push(mail),
  });
  ({ clientId: registeredId } = await registerClient(db, {
    clientName: "Some MCP client",
    redirectUris: [REDIRECT],
  }));
  ({
    provisioned: { client_id: dropId },
  } = await familyClientsOn(db, {
    provision: {
      app: "drop",
      client_name: "Elixir Drop",
      redirect_uris: [DROP_REDIRECT],
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

test("the email page offers sign-in or a new account, with the news box", async () => {
  for (const family of [false, true]) {
    const res = await handler(
      event({ method: "GET", query: ask({ family }), ip: nextIp() }),
    );
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /sign in to Elixir, or to create your free/);
    assert.match(
      res.body,
      /<input type="checkbox" name="product_news" value="1" checked> Send me Elixir product news/,
    );
    assert.doesNotMatch(res.body, /request access|approved account/i);
  }
});

test("a new address gets an account only once its code is proved, then is authorized", async () => {
  const email = "New.Person@Example.com";
  const ip = nextIp();
  const q = ask();
  const { res, mail } = await emailStep(email, q, ip);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /creates your Elixir account if you are new/);
  assert.ok(mail, "a new address is mailed a code");
  assert.equal(mail.newsletter, false, "no saved choice to carry yet");
  assert.equal(await accountOf(email), null, "nothing is created before proof");

  // A wrong code opens nothing.
  const wrong = await codeStep(
    email,
    mail.code === "000000" ? "111111" : "000000",
    q,
    ip,
  );
  assert.equal(wrong.statusCode, 400);
  assert.equal(await accountOf(email), null, "a wrong code opens nothing");

  const done = await codeStep(email, mail.code, q, ip);
  assert.equal(done.statusCode, 303, done.body);
  const url = new URL(done.headers.location);
  assert.equal(url.origin + url.pathname, REDIRECT);
  assert.match(url.searchParams.get("code"), /^eac_/);
  assert.match(done.headers["set-cookie"], /^__Host-/, "signed in to the site");

  const account = await accountOf(email);
  assert.deepEqual(
    {
      status: account.status,
      role: account.role,
      kind: account.kind,
      email: account.email,
      newsletter_opt_in: account.newsletter_opt_in,
    },
    {
      status: "approved",
      role: "member",
      kind: "person",
      email: "new.person@example.com",
      newsletter_opt_in: true,
    },
  );
  const { rows } = await db.query(
    `select scope, resource from oauth_code where account_id = $1`,
    [account.account_id],
  );
  assert.deepEqual(rows, [{ scope: "cr:read", resource: API }]);
  assert.deepEqual(welcomes.at(-1), {
    email: "new.person@example.com",
    newsletter: true,
    ipAddress: ip,
  });

  // A duplicate submit (iOS fills and taps) repeats the answer and does
  // not welcome twice.
  const welcomed = welcomes.length;
  const again = await codeStep(email, mail.code, q, ip);
  assert.equal(again.statusCode, 303, again.body);
  assert.equal(welcomes.length, welcomed, "one welcome");
});

test("an unticked news box opens the account without product news", async () => {
  const email = "no-news@example.com";
  const ip = nextIp();
  const q = ask();
  const { mail } = await emailStep(email, q, ip, {});
  const done = await codeStep(email, mail.code, q, ip);
  assert.equal(done.statusCode, 303, done.body);
  assert.equal((await accountOf(email)).newsletter_opt_in, false);
  assert.deepEqual(welcomes.at(-1), { email, newsletter: false });
});

test("a code proved for another request opens nothing", async () => {
  const email = "mismatch@example.com";
  const ip = nextIp();
  const { mail } = await emailStep(email, ask(), ip);
  const other = await codeStep(email, mail.code, ask(), ip);
  assert.equal(other.statusCode, 400);
  assert.match(other.body, /That didn&#39;t work|That didn't work/);
  assert.equal(await accountOf(email), null);
});

test("a new address signs in to a family app and is sent straight back", async () => {
  const email = "drop-newcomer@example.com";
  const ip = nextIp();
  const q = ask({ family: true, scope: "cr:read account:email" });
  const { res, mail } = await emailStep(email, q, ip);
  assert.match(res.body, /Elixir Drop will be able to:/);
  assert.doesNotMatch(res.body, /name="grant"/);
  assert.equal(mail.clientName, "Elixir Drop");
  const done = await codeStep(email, mail.code, q, ip);
  assert.equal(done.statusCode, 303, done.body);
  assert.equal(new URL(done.headers.location).host, "drop.poapkings.com");
  const account = await accountOf(email);
  assert.equal(account.status, "approved");
  const { rows } = await db.query(
    `select scope from oauth_code where account_id = $1`,
    [account.account_id],
  );
  assert.deepEqual(rows, [{ scope: "cr:read account:email" }]);
});

test("a pending ordinary request is opened by its proved code", async () => {
  const email = "pending-member@example.com";
  await db.query(
    `insert into account (email_hash, status, email) values ($1, 'requested', $2)`,
    [emailHash(email), email],
  );
  const ip = nextIp();
  const q = ask();
  const { mail } = await emailStep(email, q, ip);
  assert.ok(mail);
  const done = await codeStep(email, mail.code, q, ip);
  assert.equal(done.statusCode, 303, done.body);
  assert.equal((await accountOf(email)).status, "approved");
});

test("a denied address is still refused: no code, no account change", async () => {
  const email = "refused@example.com";
  await db.query(
    `insert into account (email_hash, status, email) values ($1, 'denied', $2)`,
    [emailHash(email), email],
  );
  const ip = nextIp();
  const q = ask();
  const { res, mail } = await emailStep(email, q, ip);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /A 6-digit code is on its way/, "the same page");
  assert.equal(mail, null, "nothing sent");
  // Even holding a code (as a deny landing between the two steps leaves
  // one), the code step opens nothing and says why.
  const late = "denied-late@example.com";
  const { mail: lateMail } = await emailStep(late, q, ip);
  await db.query(
    `insert into account (email_hash, status, email) values ($1, 'denied', $2)`,
    [emailHash(late), late],
  );
  const refused = await codeStep(late, lateMail.code, q, ip);
  assert.equal(refused.statusCode, 400);
  assert.match(refused.body, /This account cannot sign in/);
  assert.equal((await accountOf(late)).status, "denied");
  assert.equal((await accountOf(email)).status, "denied");
});

test("an existing account signs in as before: its saved news choice, no welcome", async () => {
  const email = "existing@example.com";
  await db.query(
    `insert into account (email_hash, status, email, newsletter_opt_in)
     values ($1, 'approved', $2, true)`,
    [emailHash(email), email],
  );
  const before = await accountOf(email);
  const ip = nextIp();
  const q = ask();
  // The box unticked changes nothing for an account that exists.
  const { mail } = await emailStep(email, q, ip, {});
  assert.equal(mail.newsletter, true, "the saved choice rides the mail");
  assert.equal(mail.ipAddress, ip, "the viewer address rides the login");
  const welcomed = welcomes.length;
  const done = await codeStep(email, mail.code, q, ip);
  assert.equal(done.statusCode, 303, done.body);
  assert.equal(welcomes.length, welcomed, "no welcome");
  assert.deepEqual(await accountOf(email), before);
});

test("a malformed address mails nothing", async () => {
  const ip = nextIp();
  for (const email of ["not-an-address", "a@b", `${"x".repeat(250)}@e.com`]) {
    const { res, mail } = await emailStep(email, ask(), ip);
    assert.equal(res.statusCode, 400, email);
    assert.match(res.body, /That is not an email address/);
    assert.equal(mail, null, email);
  }
});

test("one caller's ceiling on sign-in mail is shared with the website's", async () => {
  const ip = nextIp();
  for (let i = 0; i < SIGNIN_MAIL_PER_IP_HOUR; i += 1) {
    const { mail } = await emailStep(`ceiling-${i}@example.com`, ask(), ip);
    assert.ok(mail, `mail ${i + 1}`);
  }
  const { res, mail } = await emailStep("ceiling-x@example.com", ask(), ip);
  assert.equal(mail, null, "past the ceiling nothing is sent");
  assert.match(res.body, /That is the limit on sign-in emails for now/);
  assert.equal(await accountOf("ceiling-x@example.com"), null);
  assert.equal(
    await signinMailFromAllowed(db, ip),
    false,
    "and the website's sign-in reads the same ceiling",
  );
});
