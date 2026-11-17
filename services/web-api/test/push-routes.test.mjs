/**
 * Web push's routes (2026-11-16, migration 0283): Settings › Notifications.
 * Pinned here: a person's own only (an agent is refused, and no agent
 * console reaches them); the endpoint must be a known push service; the
 * device list never shows an endpoint; turning a kind off stores it;
 * nothing is offered with no key; writes need the contract header; a tap
 * is marked only on the account's own notice. Keys are made per run.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createECDH } from "node:crypto";
import pg from "pg";
import { emailHash } from "../../../packages/auth/src/index.mjs";
import { AGENT_SCOPED_ROUTES, makeHandler } from "../src/handler.mjs";
import { pushRoutes } from "../src/routes/push.mjs";
import {
  createScratch,
  dropScratch,
} from "../../../packages/ingest/test/helpers.mjs";

const adminUrl =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const name = `elixir_mcp_test_push_routes_${process.pid}`;
const databaseUrl = adminUrl.replace(/\/postgres$/, `/${name}`);
const PERSON = "push-person@example.com";
const OTHER = "push-other@example.com";

const vapid = (() => {
  const e = createECDH("prime256v1");
  e.generateKeys();
  return e.getPublicKey().toString("base64url");
})();

function subscription(endpoint) {
  const ua = createECDH("prime256v1");
  ua.generateKeys();
  return {
    endpoint,
    keys: {
      p256dh: ua.getPublicKey().toString("base64url"),
      auth: Buffer.alloc(16, 3).toString("base64url"),
    },
  };
}

let db, handler, off;
const sent = [];
const cookies = {};
const ids = {};

const request = (h, method, p, { body, who, contract = true } = {}) =>
  h({
    path: p,
    method,
    headers: {
      ...(who ? { cookie: cookies[who] } : {}),
      "cloudfront-viewer-address": "8.8.4.4:443",
      ...(contract ? { "x-elixir-client": "web" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const call = async (method, p, opts = {}) => {
  const res = await request(opts.h ?? handler, method, p, opts);
  return { status: res.statusCode, body: JSON.parse(res.body) };
};

async function signIn(email) {
  await request(handler, "POST", "/api/auth", {
    body: { age_13: true, email },
  });
  const { code } = sent.at(-1);
  const res = await request(handler, "POST", "/api/auth/code", {
    body: { email, code },
  });
  assert.equal(res.statusCode, 200, res.body);
  return res.headers["set-cookie"].split(";")[0];
}

before(async () => {
  await createScratch(name);
  db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  const deps = {
    databaseUrl,
    secret: "push-secret",
    sendLoginEmail: async (m) => sent.push(m),
    notifyOwner: async () => {},
    sendWelcomeEmail: async () => {},
  };
  handler = makeHandler({ ...deps, vapidPublicKey: vapid });
  off = makeHandler(deps);
  for (const [who, email] of [
    ["person", PERSON],
    ["other", OTHER],
  ]) {
    const {
      rows: [a],
    } = await db.query(
      `insert into account (email_hash, status, role, timezone)
       values ($1, 'approved', 'member', 'UTC') returning account_id`,
      [emailHash(email)],
    );
    ids[who] = a.account_id;
    cookies[who] = await signIn(email);
  }
});

after(async () => {
  await db?.end();
  await dropScratch(name);
});

test("push: offered with the key, a device on, listed without its endpoint, removed", async () => {
  const empty = await call("GET", "/api/me/push", { who: "person" });
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body.data ?? empty.body, {
    offered: true,
    public_key: vapid,
    devices: [],
    kinds: {
      cheers: true,
      followers: true,
      clan_actions: true,
      answers: true,
      close_friends: true,
    },
  });

  const endpoint = "https://fcm.googleapis.com/fcm/send/push-routes-1";
  const add = await call("POST", "/api/me/push/subscriptions", {
    who: "person",
    body: {
      subscription: subscription(endpoint),
      label: "Chrome <b>on</b> Mac",
    },
  });
  assert.equal(add.status, 200, JSON.stringify(add.body));
  const listed = await call("GET", "/api/me/push", { who: "person" });
  const devices = (listed.body.data ?? listed.body).devices;
  assert.equal(devices.length, 1);
  assert.equal(devices[0].label, "Chrome bon/b Mac");
  // The endpoint and keys are machinery: never in what the page reads.
  assert.doesNotMatch(JSON.stringify(listed.body), /googleapis|p256dh|auth/);

  // Another account cannot remove it; its owner can.
  const theirs = await call(
    "DELETE",
    `/api/me/push/subscriptions/${devices[0].id}`,
    { who: "other" },
  );
  assert.equal(theirs.status, 404);
  const mine = await call(
    "DELETE",
    `/api/me/push/subscriptions/${devices[0].id}`,
    { who: "person" },
  );
  assert.equal(mine.status, 200);
  assert.deepEqual((mine.body.data ?? mine.body).devices, []);
});

test("push: an endpoint that is not a push service, or no contract header, is refused", async () => {
  for (const endpoint of [
    "https://evil.example/push",
    "http://fcm.googleapis.com/fcm/send/x",
    "https://fcm.googleapis.com:8443/fcm/send/x",
    "https://user@fcm.googleapis.com/fcm/send/x",
  ]) {
    const r = await call("POST", "/api/me/push/subscriptions", {
      who: "person",
      body: { subscription: subscription(endpoint) },
    });
    assert.equal(r.status, 400, endpoint);
  }
  const noHeader = await call("POST", "/api/me/push/subscriptions", {
    who: "person",
    contract: false,
    body: {
      subscription: subscription("https://web.push.apple.com/QH/no-header"),
    },
  });
  assert.notEqual(noHeader.status, 200);
  const { rows } = await db.query(
    `select count(*)::int as n from push_subscription`,
  );
  assert.equal(rows[0].n, 0);
});

test("push: a kind's switch is stored; an unknown kind is refused", async () => {
  const offKind = await call("PUT", "/api/me/push/kinds", {
    who: "person",
    body: { kind: "followers", enabled: false },
  });
  assert.equal(offKind.status, 200);
  assert.equal((offKind.body.data ?? offKind.body).kinds.followers, false);
  const bad = await call("PUT", "/api/me/push/kinds", {
    who: "person",
    body: { kind: "who_cheered", enabled: true },
  });
  assert.equal(bad.status, 400);
});

test("push: a tap marks only the account's own notice", async () => {
  const {
    rows: [n],
  } = await db.query(
    `insert into push_notice (account_id, kind, title, url, through, status)
     values ($1, 'cheers', '2 cheers on your play', '/home', now(), 'sent')
     returning notice_id`,
    [ids.person],
  );
  const theirs = await call("POST", "/api/me/push/opened", {
    who: "other",
    body: { notice_id: n.notice_id },
  });
  assert.equal(theirs.status, 404);
  const mine = await call("POST", "/api/me/push/opened", {
    who: "person",
    body: { notice_id: n.notice_id },
  });
  assert.equal(mine.status, 200);
  const { rows } = await db.query(
    `select opened_at from push_notice where notice_id = $1`,
    [n.notice_id],
  );
  assert.ok(rows[0].opened_at);
});

test("push: with no key nothing is offered and no device can be added", async () => {
  const read = await call("GET", "/api/me/push", { who: "person", h: off });
  assert.equal((read.body.data ?? read.body).offered, false);
  assert.equal((read.body.data ?? read.body).public_key, null);
  const add = await call("POST", "/api/me/push/subscriptions", {
    who: "person",
    h: off,
    body: {
      subscription: subscription("https://fcm.googleapis.com/fcm/send/off"),
    },
  });
  assert.equal(add.status, 404);
});

test("push: an agent is refused, and no agent console reaches the routes", async () => {
  for (const key of AGENT_SCOPED_ROUTES)
    assert.equal(/\/push/.test(key), false, key);
  const routes = pushRoutes({
    resolveAccount: async () => ({ accountId: ids.person, kind: "agent" }),
    publicKey: vapid,
  });
  const r = await routes["GET /api/me/push"](db, { headers: {} });
  assert.equal(r.statusCode, 403);
  const w = await routes["POST /api/me/push/subscriptions"](
    db,
    { headers: {} },
    { subscription: subscription("https://fcm.googleapis.com/fcm/send/agent") },
  );
  assert.equal(w.statusCode, 403);
});

test("push: this device is a yes or no for the account signed in now; another account's row goes", async () => {
  const endpoint = "https://fcm.googleapis.com/fcm/send/push-routes-shared";
  const ask = (who, e = endpoint, opts = {}) =>
    call("POST", "/api/me/push/this-device", {
      who,
      body: { endpoint: e },
      ...opts,
    });
  // Nothing held yet: no.
  assert.deepEqual((await ask("person")).body, { registered: false });
  await call("POST", "/api/me/push/subscriptions", {
    who: "person",
    body: { subscription: subscription(endpoint), label: "Chrome on Mac" },
  });
  const mine = await ask("person");
  assert.equal(mine.status, 200);
  assert.equal(mine.body.registered, true);
  // A yes or no and the device's id, never an endpoint or keys.
  assert.doesNotMatch(JSON.stringify(mine.body), /googleapis|p256dh|auth/);

  // The same browser, now signed in as another account: not theirs, and
  // the first account's device is dropped, so its notices stop here.
  assert.deepEqual((await ask("other")).body, { registered: false });
  const { rows } = await db.query(
    `select account_id from push_subscription where endpoint = $1`,
    [endpoint],
  );
  assert.deepEqual(rows, []);
  assert.deepEqual((await ask("person")).body, { registered: false });

  // Not a push service: no, and nothing touched. Signed out, or with no
  // contract header, refused.
  assert.deepEqual((await ask("person", "https://example.com/x")).body, {
    registered: false,
  });
  assert.equal((await ask(null)).status, 401);
  assert.notEqual(
    (await ask("person", endpoint, { contract: false })).status,
    200,
  );
  // With no key, nothing is offered: no, and no row is touched.
  const r = await call("POST", "/api/me/push/this-device", {
    h: off,
    who: "person",
    body: { endpoint },
  });
  assert.deepEqual(r.body, { registered: false });
});
