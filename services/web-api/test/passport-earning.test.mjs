/**
 * Earning Stamps through the web API (#1015). Pinned here: the hooks run
 * only after a successful write (a refused picture earns nothing; a
 * chosen one earns Looking Good; the favourite-card default is no
 * choice), a hook that throws never fails the action and logs no
 * account, the digest step takes an explicit weekly, daily or Off and
 * never the default, "Not now" completes the map step without On the
 * Map, and the owner's reconciliation is a person's own write that
 * repairs a missed place save from a boolean and answers no place.
 * Invented names and tags only.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { emailHash } from "../../../packages/auth/src/index.mjs";
import { makeHandler } from "../src/handler.mjs";
import { factAfter, settleAfter } from "../src/passport-hooks.mjs";
import { passportRoutes } from "../src/routes/passport.mjs";
import {
  createScratch,
  dropScratch,
} from "../../../packages/ingest/test/helpers.mjs";

const adminUrl =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const name = `elixir_mcp_test_passport_earning_${process.pid}`;
const databaseUrl = adminUrl.replace(/\/postgres$/, `/${name}`);

const OWNER = "earning-owner@example.com";
const PLAYER = "#0LUVR2";
const PLACE_WORDS = "Invented Town";

let db, handler;
const sent = [];
const cookies = {};
const ids = {};

const call = async (method, p, { who, body, header = true } = {}) => {
  const res = await handler({
    path: p,
    method,
    headers: {
      ...(who ? { cookie: cookies[who] } : {}),
      "cloudfront-viewer-address": "8.8.4.4:443",
      ...(header ? { "x-elixir-client": "web" } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.statusCode, body: JSON.parse(res.body || "null") };
};

async function signIn(email) {
  await handler({
    path: "/api/auth",
    method: "POST",
    headers: { "cloudfront-viewer-address": "8.8.4.4:443" },
    body: JSON.stringify({ age_13: true, email }),
  });
  const { code } = sent.at(-1);
  const res = await handler({
    path: "/api/auth/code",
    method: "POST",
    headers: { "cloudfront-viewer-address": "8.8.4.4:443" },
    body: JSON.stringify({ email, code }),
  });
  assert.equal(res.statusCode, 200, res.body);
  return res.headers["set-cookie"].split(";")[0];
}

const levels = async (stamp) =>
  (
    await db.query(
      `select level from account_stamp_earned
        where account_id = $1 and stamp_id = $2 order by level`,
      [ids.owner, stamp],
    )
  ).rows.map((r) => r.level);
const step = (body, id) =>
  body.owner.profile.steps.find((s) => s.id === id).state;

before(async () => {
  await createScratch(name);
  db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  await db.query(`insert into player (player_tag, name) values ($1, $2)`, [
    PLAYER,
    "Invented Earner",
  ]);
  const {
    rows: [a],
  } = await db.query(
    `insert into account (email_hash, status, role, timezone)
     values ($1, 'approved', 'member', 'UTC') returning account_id`,
    [emailHash(OWNER)],
  );
  ids.owner = a.account_id;
  await db.query(
    `insert into claim (account_id, player_tag, is_primary, relationship, status, verified_at)
     values ($1, $2, true, 'primary', 'verified', now())`,
    [ids.owner, PLAYER],
  );
  handler = makeHandler({
    databaseUrl,
    secret: "earning-secret",
    sendLoginEmail: async (m) => sent.push(m),
    notifyOwner: async () => {},
    sendWelcomeEmail: async () => {},
  });
  cookies.owner = await signIn(OWNER);
});

after(async () => {
  await db.end();
  await dropScratch(name);
});

test("the earning writes are a signed-in person's, with the contract header", async () => {
  for (const p of [
    "/api/me/passport/reconcile",
    "/api/me/passport/map",
    "/api/me/passport/dismiss",
  ]) {
    assert.equal((await call("POST", p, { body: {} })).status, 401, p);
    const bare = await call("POST", p, {
      who: "owner",
      header: false,
      body: { choice: "not_now" },
    });
    assert.notEqual(bare.status, 200, p);
  }
  const routes = passportRoutes({
    resolveAccount: async () => ({ accountId: ids.owner, kind: "agent" }),
  });
  for (const key of [
    "POST /api/me/passport/reconcile",
    "POST /api/me/passport/map",
    "POST /api/me/passport/dismiss",
  ]) {
    const res = await routes[key](db, {}, { choice: "not_now" });
    assert.equal(res.statusCode, 403, key);
  }
  assert.deepEqual(await levels("on_the_map"), []);
});

test("the passport's row is made at sign-up, and reading never grants", async () => {
  const made = await db.query(
    `select 1 from account_passport where account_id = $1`,
    [ids.owner],
  );
  assert.equal(made.rowCount, 1);
  const read = await call("GET", "/api/me/passport", { who: "owner" });
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.passport.earned, []);
});

test("a refused picture earns nothing; a chosen one earns Looking Good", async () => {
  const bad = await call("POST", "/api/me/avatar", {
    who: "owner",
    body: { card_id: -1 },
  });
  assert.equal(bad.status, 400);
  assert.deepEqual(await levels("looking_good"), []);
  // Back to the favourite-card default: not a choice.
  const none = await call("POST", "/api/me/avatar", {
    who: "owner",
    body: { card_id: null },
  });
  assert.ok(none.status < 500, JSON.stringify(none.body));
  assert.deepEqual(await levels("looking_good"), []);
  // A real choice (a card in the catalog with art): after the write.
  await db.query(
    `insert into card (card_id, name, kind, icon_medium, in_catalog)
     values (26000000, 'Invented Card', 'card', 'https://example.invalid/a.png', true)
     on conflict (card_id) do update set kind = 'card', in_catalog = true,
       icon_medium = excluded.icon_medium`,
  );
  const chosen = await call("POST", "/api/me/avatar", {
    who: "owner",
    body: { card_id: 26000000 },
  });
  assert.equal(chosen.status, 200, JSON.stringify(chosen.body));
  assert.deepEqual(await levels("looking_good"), [1]);
  // Back to initials later keeps the dated Stamp.
  await call("POST", "/api/me/avatar", {
    who: "owner",
    body: { card_id: null },
  });
  assert.deepEqual(await levels("looking_good"), [1]);
});

test("the digest step: the default weekly is no choice, an explicit Off is", async () => {
  let read = await call("GET", "/api/me/passport", { who: "owner" });
  assert.notEqual(step(read.body, "digest"), "done");
  const off = await call("PUT", "/api/me/email", {
    who: "owner",
    body: { kind: "tracking_report", enabled: false },
  });
  assert.equal(off.status, 200, JSON.stringify(off.body));
  read = await call("GET", "/api/me/passport", { who: "owner" });
  assert.equal(step(read.body, "digest"), "done");
  // Stamps never turn mail on: the digest stays off.
  const {
    rows: [pref],
  } = await db.query(
    `select enabled from account_email_pref
      where account_id = $1 and kind = 'tracking_report'`,
    [ids.owner],
  );
  assert.equal(pref.enabled, false);
});

test("Not now completes the map step and never grants On the Map", async () => {
  const bad = await call("POST", "/api/me/passport/map", {
    who: "owner",
    body: { choice: "place" },
  });
  assert.equal(bad.status, 400);
  const res = await call("POST", "/api/me/passport/map", {
    who: "owner",
    body: { choice: "not_now" },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(step(res.body, "map"), "done");
  assert.equal(res.body.more, false);
  assert.ok(Array.isArray(res.body.granted));
  assert.deepEqual(await levels("on_the_map"), []);
});

test("the profile list is dismissed only by an account that finished the older welcome", async () => {
  const refused = await call("POST", "/api/me/passport/dismiss", {
    who: "owner",
    body: {},
  });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, "not_offered");
  await db.query(
    `update account set welcome_finished_at = now() where account_id = $1`,
    [ids.owner],
  );
  const res = await call("POST", "/api/me/passport/dismiss", {
    who: "owner",
    body: {},
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.owner.profile.older_welcome_finished, true);
  assert.ok(res.body.owner.profile.dismissed_at);
  assert.equal(res.body.owner.profile.completed_at, null);
  assert.deepEqual(await levels("all_set"), []);
  const read = await call("GET", "/api/me/passport", { who: "owner" });
  assert.equal(
    read.body.owner.profile.dismissed_at,
    res.body.owner.profile.dismissed_at,
  );
  await db.query(
    `update account set welcome_finished_at = null where account_id = $1`,
    [ids.owner],
  );
});

test("reconciliation repairs a missed place save from a boolean and answers no place", async () => {
  await db.query(`insert into clan_state (pk, body) values ($1, $2::jsonb)`, [
    `place#${PLAYER}`,
    JSON.stringify({
      pk: `place#${PLAYER}`,
      player_tag: PLAYER,
      label: PLACE_WORDS,
      lat: 44.97,
      lng: -93.26,
    }),
  ]);
  const res = await call("POST", "/api/me/passport/reconcile", {
    who: "owner",
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(typeof res.body.more, "boolean");
  assert.ok(res.body.passport && res.body.owner);
  assert.ok(res.body.granted.some((g) => g.stamp_id === "on_the_map"));
  // Player verified came with the earlier settles (any hook settles every
  // setup Stamp), so this pass grants only what was missed.
  assert.ok(
    res.body.passport.earned.some((e) => e.stamp_id === "player_verified"),
  );
  const raw = JSON.stringify(res.body);
  for (const leak of [PLACE_WORDS, "44.97", "-93.26", ids.owner])
    assert.equal(raw.includes(leak), false, leak);
  // Removing the place keeps the dated Stamp.
  await db.query(`delete from clan_state where pk = $1`, [`place#${PLAYER}`]);
  const again = await call("POST", "/api/me/passport/reconcile", {
    who: "owner",
  });
  assert.deepEqual(again.body.granted, []);
  assert.deepEqual(await levels("on_the_map"), [1]);
});

test("a hook that throws never fails the action and logs no account", async () => {
  const broken = {
    query: async () => {
      throw Object.assign(new Error("boom"), { code: "57014" });
    },
  };
  const lines = [];
  const original = console.error;
  console.error = (line) => lines.push(String(line));
  try {
    assert.deepEqual(await settleAfter(broken, ids.owner, "linked"), []);
    assert.deepEqual(
      await factAfter(broken, ids.owner, "cheerleader", {
        stamp_id: "cheerleader",
        source: "cheer:invented",
        event_at: new Date(),
      }),
      [],
    );
  } finally {
    console.error = original;
  }
  assert.equal(lines.length, 2);
  for (const line of lines) {
    const parsed = JSON.parse(line);
    assert.equal(parsed.at, "passport_hook_failed");
    assert.equal(parsed.error, "57014");
    assert.equal(line.includes(ids.owner), false);
  }
});
