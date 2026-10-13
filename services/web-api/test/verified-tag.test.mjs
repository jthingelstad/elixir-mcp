/**
 * A verified tag is its owner's (Jamie, 2026-10-12, #556), on the
 * console's doors: the Tracking add and the relationship change refuse a
 * self claim with the one answer, signup's tag is not claimed, and
 * `GET /api/me` says why an account has no primary. The claims package's
 * own tests pin the rule and the ending; verify.test.mjs pins Verify.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import { createSession } from "@elixir-mcp/auth";
import {
  addPlayer,
  removePlayer,
  markVerified,
  VERIFIED_ELSEWHERE,
} from "@elixir-mcp/claims";
import { onboardAccount } from "@elixir-mcp/tools/onboard";
import { itemText } from "@elixir-mcp/tools/activity/summary";
import { makeHandler } from "../src/handler.mjs";

const adminUrl =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const name = `elixir_mcp_test_verified_tag_${process.pid}`;
const databaseUrl = adminUrl.replace(/\/postgres$/, `/${name}`);
let db, handler;

const OWNED = "#2PP0V90Y";
const MINE = "#8QU2PJ8C";
const SIGNUP = "#9VUP08YL";

const make = async (hash, extra = {}) =>
  (
    await db.query(
      `insert into account (email_hash, status, role, requested_player_tag)
       values ($1, 'approved', 'member', $2) returning account_id`,
      [hash, extra.requested ?? null],
    )
  ).rows[0].account_id;

const cookieFor = async (accountId, hash) =>
  `__Host-elixir_session=${
    (await createSession(db, { secret: "test", accountId, emailHash: hash }))
      .token
  }`;

const call = (cookie, method, path, body) =>
  handler({
    rawPath: path,
    requestContext: { http: { method } },
    headers: { cookie, "x-elixir-client": "web" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const data = (r) => JSON.parse(r.body);

async function verify(accountId, tag) {
  await db.query("begin");
  const r = await markVerified(db, {
    accountId,
    tag,
    method: "deck_battle",
    via: "test",
  });
  await db.query("commit");
  return r;
}

before(async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.query(`create database ${name}`);
  await admin.end();
  await migrate({
    databaseUrl,
    migrationsDir: new URL("../../../db/migrations", import.meta.url).pathname,
  });
  db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  handler = makeHandler({ databaseUrl, secret: "test" });
});
after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.end();
});

test("the console refuses a self claim on another account's verified tag, with the one answer, and lets a follow through", async () => {
  const owner = await make("vt-owner");
  await addPlayer(db, { accountId: owner }, { tag: OWNED, via: "test" });
  await verify(owner, OWNED);

  const other = await make("vt-other");
  const cookie = await cookieFor(other, "vt-other");
  // A first player is a claim to be them: refused.
  const first = await call(cookie, "POST", "/api/me/players", {
    player_tag: OWNED,
  });
  assert.equal(first.statusCode, 409);
  assert.deepEqual(data(first), { ...VERIFIED_ELSEWHERE });
  const primary = await call(cookie, "POST", "/api/me/players", {
    player_tag: OWNED,
    make_primary: true,
  });
  assert.equal(primary.statusCode, 409);

  // With a primary of their own, the same add is a watched player.
  await addPlayer(db, { accountId: other }, { tag: MINE, via: "test" });
  const watched = await call(cookie, "POST", "/api/me/players", {
    player_tag: OWNED,
  });
  assert.equal(watched.statusCode, 200, watched.body);
  // ...which cannot become an alt, and can become a friend.
  const alt = await call(cookie, "POST", "/api/me/players", {
    action: "relationship",
    player_tag: OWNED,
    relationship: "alt",
  });
  assert.equal(alt.statusCode, 409);
  assert.equal(data(alt).message, VERIFIED_ELSEWHERE.message);
  const friend = await call(cookie, "POST", "/api/me/players", {
    action: "relationship",
    player_tag: OWNED,
    relationship: "friend",
  });
  assert.equal(friend.statusCode, 200);
  // A relationship change on a tag that is not theirs is still a 404.
  const none = await call(cookie, "POST", "/api/me/players", {
    action: "relationship",
    player_tag: "#GG8RLQ2C",
    relationship: "friend",
  });
  assert.equal(none.statusCode, 404);
  assert.equal(data(none).error, "not_found_or_primary");
});

test("an ended primary: GET /api/me says so until another is added, and the timeline sentence names the tag", async () => {
  const TAG = "#YQ2PG0LR";
  const SPARE = "#LQ8RJ2GY";
  const holder = await make("vt-holder");
  const cookie = await cookieFor(holder, "vt-holder");
  await addPlayer(db, { accountId: holder }, { tag: TAG, via: "test" });
  await addPlayer(db, { accountId: holder }, { tag: SPARE, via: "test" });
  let me = data(await call(cookie, "GET", "/api/me"));
  assert.equal(me.claim_notice, null, "a primary: nothing to say");

  const prover = await make("vt-prover");
  await addPlayer(db, { accountId: prover }, { tag: TAG, via: "test" });
  await verify(prover, TAG);

  me = data(await call(cookie, "GET", "/api/me"));
  assert.equal(me.claim_notice.kind, "primary_ended");
  assert.equal(me.claim_notice.player_tag, TAG);
  assert.ok(me.claim_notice.at);
  assert.deepEqual(
    me.claims.map((c) => [c.player_tag, c.is_primary]),
    [[SPARE, false]],
  );
  assert.ok(!JSON.stringify(me.claim_notice).includes(prover));

  // The timeline item's sentence: the tag and why, never the verifier.
  const { rows: ev } = await db.query(
    `select detail from account_event where account_id = $1 and kind = 'claim_ended'`,
    [holder],
  );
  const text = itemText({
    kind: "account_claim_ended",
    facts: { ...ev[0].detail, count: 1, apps: [] },
  });
  assert.match(text, new RegExp(`another account verified ${TAG}`));
  assert.match(text, /no longer your primary player/);

  // A friend or a watched player added since does not answer it.
  await addPlayer(
    db,
    { accountId: holder },
    { tag: "#P0LYJC8C", relationship: "watching", via: "test" },
  );
  me = data(await call(cookie, "GET", "/api/me"));
  assert.equal(me.claim_notice?.kind, "primary_ended");

  // Choosing a primary does.
  await addPlayer(
    db,
    { accountId: holder },
    { tag: SPARE, makePrimary: true, via: "test" },
  );
  me = data(await call(cookie, "GET", "/api/me"));
  assert.equal(me.claim_notice, null);

  // Removing every player afterwards is a new empty state, not the
  // collision again (Codex on #565).
  for (const t of ["#P0LYJC8C", SPARE])
    await removePlayer(db, { accountId: holder }, { tag: t, via: "test" });
  me = data(await call(cookie, "GET", "/api/me"));
  assert.deepEqual(me.claims, []);
  assert.equal(me.claim_notice, null);
});

test("a signup tag another account verified is not claimed: the account is onboarded with nothing and told why", async () => {
  const owner = await make("vt-signup-owner");
  await addPlayer(db, { accountId: owner }, { tag: SIGNUP, via: "test" });
  await verify(owner, SIGNUP);
  await db.query(
    `insert into clan (clan_tag) values ('#J2RGCRVG') on conflict do nothing`,
  );
  await db.query(
    `update player set last_known_clan_tag = '#J2RGCRVG' where player_tag = $1`,
    [SIGNUP],
  );

  const newcomer = await make("vt-newcomer", { requested: SIGNUP });
  const done = await onboardAccount(db, newcomer);
  assert.equal(done.player, false);
  assert.equal(done.refused, "verified_elsewhere");
  const { rows } = await db.query(
    `select (select count(*)::int from claim where account_id = $1) as claims,
            (select count(*)::int from account_clan where account_id = $1) as clans,
            (select onboarded_at is not null from account where account_id = $1) as onboarded`,
    [newcomer],
  );
  assert.deepEqual(rows[0], { claims: 0, clans: 0, onboarded: true });
  const again = await onboardAccount(db, newcomer);
  assert.equal(again.skipped, "already");

  const cookie = await cookieFor(newcomer, "vt-newcomer");
  const me = data(await call(cookie, "GET", "/api/me"));
  assert.deepEqual(
    { kind: me.claim_notice.kind, player_tag: me.claim_notice.player_tag },
    { kind: "signup_tag_refused", player_tag: SIGNUP },
  );
  const { rows: ev } = await db.query(
    `select detail from account_event where account_id = $1 and kind = 'claim_refused'`,
    [newcomer],
  );
  assert.match(
    itemText({ kind: "account_claim_refused", facts: ev[0].detail }),
    /the player tag you signed up with, is verified by another account/,
  );
});
