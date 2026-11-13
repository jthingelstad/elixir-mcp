/**
 * Linking and signing in with Discord (#531). The relay's half (the code
 * traded for the user) is packages/auth/test/discord.test.mjs; here the
 * bridge is a fake that answers with the user a test names, and what is
 * pinned is the web API's half: the browser and session binding, who a
 * sign-in reaches, and what each outcome tells the page.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { emailHash } from "../../../packages/auth/src/index.mjs";
import { makeHandler } from "../src/handler.mjs";
import {
  createScratch,
  dropScratch,
} from "../../../packages/ingest/test/helpers.mjs";

const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_discord_login_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);
const MEMBER = "member-discord@example.com";
const TAKEN = "taken-discord@example.com";

let db;
let handler;
let unconfigured;
const sentEmails = [];
/** What the fake relay answers next. */
let reply = null;
const sent = [];

function event({ method = "GET", path: p, query, body, cookie }) {
  return {
    path: p,
    method,
    queryStringParameters: query ?? {},
    headers: {
      ...(cookie ? { cookie } : {}),
      "x-elixir-client": "web",
      "cloudfront-viewer-address": "198.51.100.20:5000",
      "user-agent": "Mozilla/5.0 Chrome/128.0",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}
const pair = (c) => c.split(";")[0];
const locationOf = (res) => new URL(res.headers.location, "https://x.test");

async function signInByEmail(email) {
  await handler(
    event({ method: "POST", path: "/api/auth", body: { age_13: true, email } }),
  );
  const { token } = sentEmails.at(-1);
  const res = await handler(
    event({ method: "POST", path: "/api/auth/redeem", body: { token } }),
  );
  assert.equal(res.statusCode, 200, res.body);
  return pair(res.headers["set-cookie"]);
}

/** Start a round trip and come back from Discord with `user`. */
async function roundTrip({ intent, user, session = "", query = {}, back }) {
  const start = await handler(
    event({
      path: "/api/auth/discord/start",
      query: { intent, ...query },
      cookie: session || undefined,
    }),
  );
  assert.equal(start.statusCode, 303);
  const consent = locationOf(start);
  assert.equal(consent.host, "discord.com", start.headers.location);
  const nonce = pair(start.cookies[0]);
  reply = user ? { ok: true, user } : { ok: false, code: "discord_refused" };
  return handler(
    event({
      path: "/api/auth/discord/callback",
      query: { code: "the-code", state: consent.searchParams.get("state") },
      cookie: [back ?? session, nonce].filter(Boolean).join("; "),
    }),
  );
}

before(async () => {
  await createScratch(NAME);
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  for (const email of [MEMBER, TAKEN])
    await db.query(
      `insert into account (email_hash, status, onboarded_at)
       values ($1, 'approved', now())`,
      [emailHash(email)],
    );
  const common = {
    databaseUrl: DB_URL,
    secret: "web-secret",
    sendLoginEmail: async (m) => sentEmails.push(m),
    notifyOwner: async () => {},
    sendWelcomeEmail: async () => {},
  };
  handler = makeHandler({
    ...common,
    discordLogin: {
      clientId: "42",
      bridge: {
        send: async (req) => {
          sent.push(req);
          return { ok: true, id: "00000000-0000-4000-8000-000000000000" };
        },
        wait: async () => reply,
      },
    },
  });
  unconfigured = makeHandler(common);
});

after(async () => {
  await db.end();
  await dropScratch(NAME);
});

test("unconfigured, both ways in say so and nothing is started", async () => {
  const res = await unconfigured(
    event({ path: "/api/auth/discord/start", query: { intent: "signin" } }),
  );
  assert.equal(res.headers.location, "/signin?discord=unavailable");
  const me = JSON.parse((await unconfigured(event({ path: "/api/me" }))).body);
  assert.equal(me.features.discord_login, false);
});

test("a new verified address opens an account, linked, with the form's choices", async () => {
  const res = await roundTrip({
    intent: "signin",
    query: { tz: "America/Chicago", news: "1", age: "1" },
    user: {
      id: "300000000000000001",
      username: "newbie",
      email: "newbie-discord@example.com",
      verified: true,
    },
  });
  assert.equal(res.headers.location, "/signin?discord=new");
  assert.equal(sent.at(-1).intent, "signin");
  const session = res.cookies.find((c) =>
    c.startsWith("__Host-elixir_session="),
  );
  assert.ok(session, "a session is set");
  assert.ok(
    res.cookies.some((c) => /^__Host-elixir_discord=;.*Max-Age=0/.test(c)),
    "the round trip's cookie is cleared",
  );
  const me = JSON.parse(
    (await handler(event({ path: "/api/me", cookie: pair(session) }))).body,
  );
  assert.equal(me.authenticated, true);
  assert.equal(me.email, "newbie-discord@example.com");
  assert.equal(me.newsletter_opt_in, true);
  assert.equal(me.timezone, "America/Chicago");
  assert.equal(me.discord.username, "newbie");
  assert.equal(me.features.discord_login, true);

  // Next time the link is the way in, whatever Discord says of the email.
  const again = await roundTrip({
    intent: "signin",
    user: {
      id: "300000000000000001",
      username: "newbie",
      email: null,
      verified: false,
    },
  });
  assert.equal(again.headers.location, "/signin?discord=signed_in");
});

test("plain sign-in with Discord opens no new account; the signup form asks first (#763)", async () => {
  const email = "no-age-discord@example.com";
  const res = await roundTrip({
    intent: "signin",
    query: { tz: "America/Chicago" },
    user: {
      id: "300000000000000009",
      username: "noage",
      email,
      verified: true,
    },
  });
  assert.equal(res.headers.location, "/signin?signup&discord=age");
  assert.ok(
    !res.cookies.some((c) => c.startsWith("__Host-elixir_session=")),
    "no session",
  );
  const { rows } = await db.query(
    `select 1 from account where email = $1
     union all select 1 from account_discord where discord_user_id = $2`,
    [email, "300000000000000009"],
  );
  assert.equal(rows.length, 0, "no account and no link");
});

test("a verified address reaches its existing account and links it", async () => {
  const res = await roundTrip({
    intent: "signin",
    user: {
      id: "300000000000000002",
      username: "member",
      email: MEMBER,
      verified: true,
    },
  });
  assert.equal(res.headers.location, "/signin?discord=signed_in");
  const { rows } = await db.query(
    `select d.username from account_discord d join account a using (account_id)
      where a.email_hash = $1`,
    [emailHash(MEMBER)],
  );
  assert.equal(rows[0].username, "member");

  // A different Discord user with the same address is refused: the
  // account keeps the Discord it has.
  const other = await roundTrip({
    intent: "signin",
    user: {
      id: "300000000000000003",
      username: "imposter",
      email: MEMBER,
      verified: true,
    },
  });
  assert.equal(other.headers.location, "/signin?discord=other");
  assert.equal(
    other.cookies.some((c) => c.startsWith("__Host-elixir_session=")),
    false,
  );
});

test("no verified address and no link is sent to email sign-in", async () => {
  const res = await roundTrip({
    intent: "signin",
    user: {
      id: "300000000000000004",
      username: "x",
      email: "x@example.com",
      verified: false,
    },
  });
  assert.equal(res.headers.location, "/signin?discord=no_email");
  const { rows } = await db.query(
    `select 1 from account where email_hash = $1`,
    [emailHash("x@example.com")],
  );
  assert.equal(rows.length, 0);
});

test("a callback in another browser, or replayed, does nothing", async () => {
  const start = await handler(
    event({ path: "/api/auth/discord/start", query: { intent: "signin" } }),
  );
  const state = locationOf(start).searchParams.get("state");
  const before = sent.length;
  const res = await handler(
    event({
      path: "/api/auth/discord/callback",
      query: { code: "c", state },
      cookie: "__Host-elixir_discord=someone-else",
    }),
  );
  assert.equal(res.headers.location, "/signin?discord=expired");
  assert.equal(sent.length, before, "no code went to the relay");
});

test("Cancel on Discord's page comes back as cancelled", async () => {
  const start = await handler(
    event({ path: "/api/auth/discord/start", query: { intent: "signin" } }),
  );
  const res = await handler(
    event({
      path: "/api/auth/discord/callback",
      query: {
        error: "access_denied",
        state: locationOf(start).searchParams.get("state"),
      },
      cookie: pair(start.cookies[0]),
    }),
  );
  assert.equal(res.headers.location, "/signin?discord=cancelled");
});

test("linking needs the session that asked, and one Discord per account", async () => {
  // Signed out, linking is sent to sign in first.
  const out = await handler(
    event({ path: "/api/auth/discord/start", query: { intent: "link" } }),
  );
  assert.match(out.headers.location, /^\/signin\?return_to=/);

  const session = await signInByEmail(TAKEN);
  // Back in another session of the same account: refused.
  const elsewhere = await signInByEmail(TAKEN);
  const moved = await roundTrip({
    intent: "link",
    session,
    back: elsewhere,
    user: { id: "300000000000000005", username: "t" },
  });
  assert.equal(
    moved.headers.location,
    "/settings/connections/discord?discord=expired",
  );

  // The member's Discord user is already someone's.
  const taken = await roundTrip({
    intent: "link",
    session,
    user: { id: "300000000000000002", username: "member" },
  });
  assert.equal(
    taken.headers.location,
    "/settings/connections/discord?discord=taken",
  );

  const linked = await roundTrip({
    intent: "link",
    session,
    user: { id: "300000000000000005", username: "takenuser" },
  });
  assert.equal(
    linked.headers.location,
    "/settings/connections/discord?discord=linked",
  );
  assert.equal(sent.at(-1).intent, "link");
  const me = JSON.parse(
    (await handler(event({ path: "/api/me", cookie: session }))).body,
  );
  assert.equal(me.discord.username, "takenuser");

  const off = await handler(
    event({
      method: "POST",
      path: "/api/me/discord/unlink",
      body: {},
      cookie: session,
    }),
  );
  assert.deepEqual(JSON.parse(off.body), { ok: true, removed: true });
  const after = JSON.parse(
    (await handler(event({ path: "/api/me", cookie: session }))).body,
  );
  assert.equal(after.discord, null);
});

test("Discord refusing the code is a plain failure", async () => {
  const res = await roundTrip({ intent: "signin", user: null });
  assert.equal(res.headers.location, "/signin?discord=failed");
});
