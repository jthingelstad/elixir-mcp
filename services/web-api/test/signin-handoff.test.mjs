/**
 * The sign-in review of 2026-09-12 (0083): the cross-context handoff, the
 * plain answer at the mail limit, and the Profile page's device list.
 *
 * The handoff: a sign-in started on one screen and finished on another
 * hands the session back to the screen that asked. From the same address
 * at once; from a different address only after the screen that opened
 * the link says yes. The poll id is minted for every request so the
 * answer's shape cannot say whether an account exists.
 */

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
const NAME = `elixir_mcp_test_handoff_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);
const SECRET = "web-secret";
const MEMBER = "member-handoff@example.com";
const OTHER = "other-handoff@example.com";
const NOBODY = "nobody-handoff@example.com";

let db;
let handler;
const sentEmails = [];

function event({
  method = "POST",
  path: p,
  body,
  cookie,
  contractHeader = true,
  ip = "8.8.4.4",
  viewer = "198.51.100.10:5000",
  country = "US",
  ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
}) {
  return {
    rawPath: p,
    requestContext: { http: { method, sourceIp: ip } },
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(contractHeader ? { "x-elixir-client": "web" } : {}),
      "cloudfront-viewer-address": viewer,
      "cloudfront-viewer-country": country,
      "user-agent": ua,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}
const parse = (res) => JSON.parse(res.body);
const cookieOf = (res) => res.headers["set-cookie"].split(";")[0];
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

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
  for (const email of [MEMBER, OTHER])
    await db.query(
      `insert into account (email_hash, status) values ($1, 'approved')`,
      [emailHash(email)],
    );
  handler = makeHandler({
    databaseUrl: DB_URL,
    secret: SECRET,
    sendLoginEmail: async (m) => sentEmails.push(m),
    notifyOwner: async () => {},
    sendWelcomeEmail: async () => {},
  });
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

test("same address: the link opened elsewhere hands the session to the screen that asked", async () => {
  const ask = await handler(
    event({ path: "/api/auth", body: { email: MEMBER }, ip: "10.0.0.1" }),
  );
  const { poll_id } = parse(ask);
  assert.match(poll_id, /^[A-Za-z0-9_-]{32,}$/);

  // Nothing to collect yet.
  const early = await handler(
    event({ path: "/api/auth/poll", body: { poll_id }, ip: "10.0.0.1" }),
  );
  assert.deepEqual(parse(early), { ready: false });
  assert.equal(early.headers["set-cookie"], undefined);

  // The mail app on the same phone opens the link: same viewer address.
  const { token } = sentEmails.at(-1);
  const redeem = await handler(
    event({
      path: "/api/auth/redeem",
      body: { token },
      ip: "10.0.0.2",
      ua: IPHONE,
    }),
  );
  assert.equal(redeem.statusCode, 200, redeem.body);
  assert.deepEqual(parse(redeem), {
    authenticated: true,
    handoff: { state: "done" },
  });
  assert.match(redeem.headers["set-cookie"], /^__Host-elixir_session=/);

  // The screen that asked collects: a session of its own, once.
  const got = await handler(
    event({ path: "/api/auth/poll", body: { poll_id }, ip: "10.0.0.1" }),
  );
  assert.equal(got.statusCode, 200);
  assert.deepEqual(parse(got), { authenticated: true, ready: true });
  const cookie = cookieOf(got);
  assert.notEqual(cookie, cookieOf(redeem), "two screens, two sessions");
  const me = await handler(
    event({ method: "GET", path: "/api/me", cookie, ip: "10.0.0.1" }),
  );
  assert.equal(parse(me).authenticated, true);

  const again = await handler(
    event({ path: "/api/auth/poll", body: { poll_id }, ip: "10.0.0.1" }),
  );
  assert.deepEqual(parse(again), { ready: false }, "collected exactly once");
});

test("different address: the redeeming screen is asked, and nothing moves until it says yes", async () => {
  await handler(
    event({ path: "/api/auth", body: { email: MEMBER }, ip: "10.0.1.1" }),
  );
  const { poll_id } = parse(
    await handler(
      event({ path: "/api/auth", body: { email: MEMBER }, ip: "10.0.1.1" }),
    ),
  );
  const { token } = sentEmails.at(-1);
  const redeem = await handler(
    event({
      path: "/api/auth/redeem",
      body: { token },
      ip: "10.0.1.2",
      viewer: "203.0.113.99:1",
      country: "DE",
    }),
  );
  const body = parse(redeem);
  assert.equal(body.handoff.state, "confirm");
  assert.match(body.handoff.confirm, /^[A-Za-z0-9_-]{32,}$/);
  assert.equal(body.handoff.started.country, "US");
  assert.equal(body.handoff.started.client, "Chrome on Mac");
  assert.ok(body.handoff.started.at);

  const waiting = await handler(
    event({ path: "/api/auth/poll", body: { poll_id }, ip: "10.0.1.1" }),
  );
  assert.deepEqual(parse(waiting), { ready: false });

  // A confirm from somebody else's session is a no-op.
  await handler(
    event({ path: "/api/auth", body: { email: OTHER }, ip: "10.0.1.3" }),
  );
  const otherRedeem = await handler(
    event({
      path: "/api/auth/redeem",
      body: { token: sentEmails.at(-1).token },
      ip: "10.0.1.3",
    }),
  );
  const foreign = await handler(
    event({
      path: "/api/auth/handoff",
      body: { confirm: body.handoff.confirm },
      cookie: cookieOf(otherRedeem),
      ip: "10.0.1.3",
    }),
  );
  assert.equal(foreign.statusCode, 400);
  const still = await handler(
    event({ path: "/api/auth/poll", body: { poll_id }, ip: "10.0.1.1" }),
  );
  assert.deepEqual(parse(still), { ready: false });

  // The screen that opened the link says yes.
  const yes = await handler(
    event({
      path: "/api/auth/handoff",
      body: { confirm: body.handoff.confirm },
      cookie: cookieOf(redeem),
      ip: "10.0.1.2",
    }),
  );
  assert.equal(yes.statusCode, 200, yes.body);
  const got = await handler(
    event({ path: "/api/auth/poll", body: { poll_id }, ip: "10.0.1.1" }),
  );
  assert.deepEqual(parse(got), { authenticated: true, ready: true });
  assert.match(got.headers["set-cookie"], /^__Host-elixir_session=/);
});

test("the answer's shape is the same for an unknown address, and a foreign poll id collects nothing", async () => {
  const ask = await handler(
    event({ path: "/api/auth", body: { email: NOBODY }, ip: "10.0.2.1" }),
  );
  const body = parse(ask);
  assert.equal(body.ok, true);
  assert.match(body.poll_id, /^[A-Za-z0-9_-]{32,}$/);
  assert.match(body.message, /If your account is approved/);
  const poll = await handler(
    event({
      path: "/api/auth/poll",
      body: { poll_id: body.poll_id },
      ip: "10.0.2.1",
    }),
  );
  assert.deepEqual(parse(poll), { ready: false });
});

test("the sixth sign-in mail in an hour is answered plainly, approved or not", async () => {
  const email = "limited-handoff@example.com";
  for (let i = 0; i < 5; i += 1) {
    const res = parse(
      await handler(
        event({ path: "/api/auth", body: { email }, ip: "10.0.3.1" }),
      ),
    );
    assert.equal(res.limited, undefined);
  }
  const sixth = parse(
    await handler(
      event({ path: "/api/auth", body: { email }, ip: "10.0.3.1" }),
    ),
  );
  assert.equal(sixth.ok, true);
  assert.equal(sixth.limited, true);
  assert.match(sixth.message, /limit on sign-in emails/);
  assert.ok(sixth.poll_id, "still a poll id, still the same shape");
});

test("the device list shows every live session, this one marked, and revokes the others", async () => {
  // Two screens for OTHER: a Mac (the code) and an iPhone (the link).
  await handler(
    event({ path: "/api/auth", body: { email: OTHER }, ip: "10.0.4.1" }),
  );
  const { code, token } = sentEmails.at(-1);
  // The code and the link burn ONE row; use the code here and a second
  // request's link for the phone.
  const mac = await handler(
    event({
      path: "/api/auth/code",
      body: { email: OTHER, code },
      ip: "10.0.4.1",
    }),
  );
  assert.equal(mac.statusCode, 200, mac.body);
  assert.equal(
    (await handler(event({ path: "/api/auth/redeem", body: { token } })))
      .statusCode,
    400,
    "the link the code burned is spent",
  );
  await handler(
    event({ path: "/api/auth", body: { email: OTHER }, ip: "10.0.4.2" }),
  );
  const phone = await handler(
    event({
      path: "/api/auth/redeem",
      body: { token: sentEmails.at(-1).token },
      ip: "10.0.4.2",
      viewer: "198.51.100.77:2",
      country: "CA",
      ua: IPHONE,
    }),
  );
  assert.equal(phone.statusCode, 200);

  const list = parse(
    await handler(
      event({
        method: "GET",
        path: "/api/me/sessions",
        cookie: cookieOf(mac),
        ip: "10.0.4.1",
      }),
    ),
  );
  const mine = list.sessions.find((s) => s.current);
  assert.ok(mine, "this session is marked");
  assert.equal(mine.client, "Chrome on Mac");
  assert.equal(mine.from, "198.51.100.10");
  const theirs = list.sessions.filter((s) => !s.current);
  const iphone = theirs.find((s) => s.client === "Safari on iPhone");
  assert.ok(iphone);
  assert.equal(iphone.country, "CA");
  assert.ok(iphone.expires_at);
  for (const s of list.sessions)
    assert.ok(s.id && s.created_at && s.last_seen_at);

  // Revoking this one from the list is refused; the button does that.
  const self = await handler(
    event({
      path: "/api/me/sessions/revoke",
      body: { session_id: mine.id },
      cookie: cookieOf(mac),
    }),
  );
  assert.equal(self.statusCode, 400);

  // One device.
  const one = await handler(
    event({
      path: "/api/me/sessions/revoke",
      body: { session_id: iphone.id },
      cookie: cookieOf(mac),
    }),
  );
  assert.deepEqual(parse(one), { ok: true, revoked: 1 });
  const phoneMe = await handler(
    event({ method: "GET", path: "/api/me", cookie: cookieOf(phone) }),
  );
  assert.equal(parse(phoneMe).authenticated, false, "the phone is out");

  // Everywhere else: the rest go, this one stays.
  const all = await handler(
    event({
      path: "/api/me/sessions/revoke",
      body: { everywhere: true },
      cookie: cookieOf(mac),
    }),
  );
  assert.equal(parse(all).ok, true);
  const after = parse(
    await handler(
      event({ method: "GET", path: "/api/me/sessions", cookie: cookieOf(mac) }),
    ),
  );
  assert.equal(after.sessions.length, 1);
  assert.equal(after.sessions[0].current, true);

  // Without the contract header the revoke is refused (a cross-site form
  // could not carry it).
  const noHeader = await handler(
    event({
      path: "/api/me/sessions/revoke",
      body: { everywhere: true },
      cookie: cookieOf(mac),
      contractHeader: false,
    }),
  );
  assert.equal(noHeader.statusCode, 401);
});
