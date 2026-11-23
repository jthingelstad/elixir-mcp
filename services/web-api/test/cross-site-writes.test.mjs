/**
 * Cross-site request defence (2026-11-23). SameSite=Lax keeps the session
 * cookie off another site's POST, but every other poapkings.com subdomain
 * is the same site, and its requests carry the cookie. So a write that
 * carries the cookie must come from Elixir's own pages, by the browser's
 * own Origin and Sec-Fetch-Site; a request that names neither (an older
 * browser) passes. The x-elixir-client rule stays as it was, after this.
 *
 * This walks every write the web API registers with a foreign Origin and
 * a cookie, and pins the writers that must keep working: the app itself,
 * a browser that names nowhere, the one-click unsubscribe (its signed link
 * is its credential, and a mail client posts it from anywhere), and every
 * caller with no cookie (Drop's server, a bearer tool).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {
  createSession,
  emailHash,
  SESSION_COOKIE_NAME,
} from "../../../packages/auth/src/index.mjs";
import { makeHandler } from "../src/handler.mjs";
import {
  createScratch,
  dropScratch,
} from "../../../packages/ingest/test/helpers.mjs";

const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_cross_site_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);
const SECRET = "cross-site-secret";
const SITE = "https://elixir.poapkings.com";

let db;
let handler;
let cookie;

const event = ({ method = "POST", path: p, headers = {}, body = {} }) => ({
  path: p,
  method,
  headers: { "x-elixir-client": "web", ...headers },
  body: method === "GET" ? undefined : JSON.stringify(body),
});
const refused = (res) =>
  res.statusCode === 403 &&
  JSON.parse(res.body ?? "{}").error === "cross_site_refused";

before(async () => {
  await createScratch(NAME);
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  const {
    rows: [acct],
  } = await db.query(
    `insert into account (email_hash, status, onboarded_at)
     values ($1, 'approved', now()) returning account_id`,
    [emailHash("cross-site@example.com")],
  );
  const minted = await createSession(db, {
    secret: SECRET,
    accountId: acct.account_id,
    emailHash: emailHash("cross-site@example.com"),
  });
  cookie = `${SESSION_COOKIE_NAME}=${minted.token}`;
  handler = makeHandler({
    databaseUrl: DB_URL,
    secret: SECRET,
    sendLoginEmail: async () => {},
    clan: async () => ({ statusCode: 200, headers: {}, body: "{}" }),
  });
});

after(async () => {
  await db.end();
  await dropScratch(NAME);
});

/** A concrete path for a route key: a wildcard segment filled in. */
const pathOf = (route) => route.replace(/\/\*\*$/, "/x").replace(/\/\*$/, "/x");

test("every cookie-carrying write from another origin is refused before it runs", async () => {
  const writes = handler.routeKeys.filter(
    (key) => !key.startsWith("GET ") && !key.startsWith("HEAD "),
  );
  assert.ok(writes.length > 20, `${writes.length} writes`);
  const missed = [];
  for (const key of writes) {
    if (key === "POST /api/email/unsubscribe") continue;
    const [method, route] = key.split(" ");
    for (const headers of [
      { origin: "https://other.poapkings.com", "sec-fetch-site": "same-site" },
      { origin: "https://attacker.example" },
      { "sec-fetch-site": "cross-site" },
    ]) {
      const res = await handler(
        event({ method, path: pathOf(route), headers: { cookie, ...headers } }),
      );
      if (!refused(res))
        missed.push(`${key} ${JSON.stringify(headers)}: ${res.statusCode}`);
    }
  }
  assert.deepEqual(missed, []);
});

test("the app's own writes, and a browser naming nowhere, still go through", async () => {
  for (const headers of [
    { origin: SITE, "sec-fetch-site": "same-origin" },
    // The service worker's notificationclick POST is same-origin too.
    { "sec-fetch-site": "same-origin" },
    // The person's own act (the address bar, a bookmark): no page can
    // cause it.
    { "sec-fetch-site": "none" },
    // A local setup on another address: the browser's word decides when
    // it gives one.
    { origin: "http://127.0.0.1:4321", "sec-fetch-site": "same-origin" },
    // An older browser sends neither.
    {},
  ]) {
    const res = await handler(
      event({
        path: "/api/me/timeline/seen",
        headers: { cookie, ...headers },
        body: {},
      }),
    );
    assert.ok(!refused(res), JSON.stringify(headers));
    assert.notEqual(res.statusCode, 401, JSON.stringify(headers));
  }
});

test("reads, cookie-less callers and the one-click unsubscribe are not this check's", async () => {
  // A read with a foreign Origin: CORS already keeps its answer from the
  // other page, and a GET changes nothing.
  const read = await handler(
    event({
      method: "GET",
      path: "/api/me",
      headers: { cookie, origin: "https://other.poapkings.com" },
    }),
  );
  assert.equal(read.statusCode, 200);
  assert.equal(JSON.parse(read.body).authenticated, true);

  // No cookie (Drop's server, a bearer tool, a fresh browser): nothing
  // ambient to abuse, so the route answers as it always did.
  const cookieless = await handler(
    event({
      path: "/api/auth",
      headers: { origin: "https://drop.poapkings.com" },
      body: { age_13: true, email: "nobody-cross-site@example.com" },
    }),
  );
  assert.ok(!refused(cookieless));
  assert.equal(cookieless.statusCode, 200);

  // The mail client's one-click POST (RFC 8058) carries its signed link
  // and whatever cookie the browser holds; the link decides.
  const unsubscribe = await handler({
    path: "/api/email/unsubscribe",
    method: "POST",
    queryStringParameters: { t: "not-a-real-link" },
    headers: {
      cookie,
      origin: "https://mail.example",
      "sec-fetch-site": "cross-site",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "List-Unsubscribe=One-Click",
  });
  assert.ok(!refused(unsubscribe));
  assert.equal(unsubscribe.statusCode, 400, "the bad link, not the origin");
});
