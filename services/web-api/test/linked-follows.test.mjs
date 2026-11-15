/**
 * Linked follows (Jamie, 2026-11-15), against a real PostgreSQL database:
 * "if you follow a player you also follow the account. If you follow the
 * account you follow ALL players that account has." A Verified player's
 * follow is its account's follow; an account follow covers its Verified
 * players now and later; Claimed and Imported players stay player-only;
 * unfollowing either ends the whole link.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { createSession } from "@elixir-mcp/auth";
import { linkNewVerified } from "@elixir-mcp/claims";
import { ensurePassport } from "@elixir-mcp/stamps";
import { makeHandler } from "../src/handler.mjs";

// Made-up tags: this repository is public.
const V = "#0YRL2GQP"; // OWNER's primary, verified
const W = "#0UVC8J9R"; // OWNER's alt, verified
const U = "#0PJ8LQ2Y"; // OWNER's alt, claimed, never verified
const N = "#0RQYGC2L"; // OWNER verifies this one later
const C = "#0GUQ28PV"; // claimed by CLAIMER, never verified
const MINE = "#0LCVJ8YR"; // READER's own player
const LONE = "#0QYC9U2P"; // NOPLAYER's... nobody's: a player nobody claims

let scratch, handler, OWNER, CLAIMER, READER, NOPLAYER;
const sessions = new Map();
const pageIds = new Map();
const data = (r) => JSON.parse(r.body);

async function person(hash) {
  const id = (
    await scratch.db.query(
      "insert into account(email_hash,status) values ($1,'approved') returning account_id",
      [hash],
    )
  ).rows[0].account_id;
  const { token } = await createSession(scratch.db, {
    secret: "test",
    accountId: id,
    emailHash: hash,
  });
  sessions.set(id, token);
  pageIds.set(id, (await ensurePassport(scratch.db, id)).passport_id);
  return id;
}
const call = (id, method, path, body, query = {}) =>
  handler({
    path,
    method,
    queryStringParameters: query,
    headers: {
      cookie: `__Host-elixir_session=${sessions.get(id)}`,
      "x-elixir-client": "web",
      "cloudfront-viewer-address": "8.8.4.4:443",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const claim = (account, tag, relationship, verified = false) =>
  scratch.db.query(
    `insert into claim(account_id,player_tag,status,is_primary,relationship,verified_at)
     values ($1,$2,$3,$4,$5,$6)`,
    [
      account,
      tag,
      verified ? "verified" : "unverified",
      relationship === "primary",
      relationship,
      verified ? new Date() : null,
    ],
  );
const friendsOf = async (id) =>
  (
    await scratch.db.query(
      `select player_tag from claim where account_id = $1
          and relationship = 'friend' order by player_tag`,
      [id],
    )
  ).rows.map((r) => r.player_tag);
const followsAccount = async (reader, owner) =>
  (
    await scratch.db.query(
      "select 1 from account_follow where account_id = $1 and followed_account_id = $2",
      [reader, owner],
    )
  ).rows.length > 0;
const follow = (reader, tag) =>
  call(reader, "POST", "/api/claims", {
    player_tag: tag,
    relationship: "friend",
  });
const unfollow = (reader, tag) =>
  call(reader, "POST", "/api/claims", { player_tag: tag, action: "remove" });

before(async () => {
  scratch = await scratchDb("linked_follows");
  const { db } = scratch;
  for (const tag of [V, W, U, N, C, MINE, LONE])
    await db.query("insert into player(player_tag,name) values ($1,$2)", [
      tag,
      `Name ${tag}`,
    ]);
  handler = makeHandler({ databaseUrl: scratch.url, secret: "test" });
  OWNER = await person("lf-owner");
  CLAIMER = await person("lf-claimer");
  READER = await person("lf-reader");
  NOPLAYER = await person("lf-noplayer");
  await claim(OWNER, V, "primary", true);
  await claim(OWNER, W, "alt", true);
  await claim(OWNER, U, "alt");
  await claim(CLAIMER, C, "primary");
  await claim(READER, MINE, "primary", true);
});

after(async () => {
  await scratch?.drop();
});

test("Follow prices the link: the account's other Verified players", async () => {
  const r = await call(READER, "GET", "/api/me/follow-cost", null, {
    player_tag: V,
  });
  assert.equal(r.statusCode, 200, r.body);
  // W comes along; its owner records it already, so it takes no slot.
  assert.deepEqual(data(r).linked, { players: 1, slots: 0 });
  const claimed = await call(READER, "GET", "/api/me/follow-cost", null, {
    player_tag: C,
  });
  assert.equal(data(claimed).linked, null, "a Claimed player links nothing");
});

test("following a Verified player follows its account and its Verified players", async () => {
  const r = await follow(READER, V);
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(data(r).linked, { followed: [W], skipped: [] });
  assert.equal(await followsAccount(READER, OWNER), true);
  // The Claimed alt U stays out: only Verified players come along.
  assert.deepEqual(await friendsOf(READER), [W, V].sort());
});

test("unfollowing one of its players ends the whole link", async () => {
  const r = await unfollow(READER, W);
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(data(r).unfollowed.sort(), [V, W].sort());
  assert.equal(await followsAccount(READER, OWNER), false);
  assert.deepEqual(await friendsOf(READER), []);
  // The reader's own player is never touched.
  const own = await scratch.db.query(
    "select 1 from claim where account_id = $1 and player_tag = $2",
    [READER, MINE],
  );
  assert.equal(own.rows.length, 1);
});

test("following the account follows its Verified players; unfollowing it unfollows them", async () => {
  const r = await call(READER, "POST", "/api/me/account-follows", {
    id: pageIds.get(OWNER),
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(data(r).followed, [V, W]);
  assert.deepEqual(await friendsOf(READER), [V, W].sort());
  const page = data(
    await call(READER, "GET", `/api/accounts/${pageIds.get(OWNER)}`),
  );
  assert.equal(page.you.following, true);
  assert.equal(page.you.plan, null);
  const off = await call(
    READER,
    "DELETE",
    `/api/me/account-follows/${pageIds.get(OWNER)}`,
  );
  assert.equal(off.statusCode, 200, off.body);
  assert.deepEqual(data(off).unfollowed.sort(), [V, W].sort());
  assert.deepEqual(await friendsOf(READER), []);
  // Before following, the page prices the Follow.
  const before = data(
    await call(READER, "GET", `/api/accounts/${pageIds.get(OWNER)}`),
  );
  assert.deepEqual(before.you.to_follow, [V, W]);
  assert.equal(before.you.plan.to_follow, 2);
  assert.equal(before.you.plan.fits, true);
});

test("a player the link cannot take is skipped and told in the bell", async () => {
  // No player of their own: the account follow holds, its players wait.
  const r = await call(NOPLAYER, "POST", "/api/me/account-follows", {
    id: pageIds.get(OWNER),
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(data(r).followed, []);
  assert.deepEqual(
    data(r).skipped.map((s) => [s.player_tag, s.reason]),
    [
      [V, "no_own_player"],
      [W, "no_own_player"],
    ],
  );
  const skipped = await scratch.db.query(
    `select detail from account_event
      where account_id = $1 and kind = 'follow_skipped'
      order by detail->>'player_tag' = $2 desc`,
    [NOPLAYER, V],
  );
  assert.deepEqual(
    skipped.rows.map((e) => [e.detail.player_tag, e.detail.account_id]),
    [
      [V, pageIds.get(OWNER)],
      [W, pageIds.get(OWNER)],
    ],
  );
  const bell = data(await call(NOPLAYER, "GET", "/api/me/bell"));
  assert.ok(
    bell.account.items.some((a) => a.kind === "follow_skipped"),
    "the bell names it",
  );
});

test("a player the account verifies later joins every follow of it", async () => {
  await call(READER, "POST", "/api/me/account-follows", {
    id: pageIds.get(OWNER),
  });
  await claim(OWNER, N, "alt", true);
  const r = await linkNewVerified(scratch.db, OWNER, N);
  // READER takes it; NOPLAYER still has no player of their own.
  assert.deepEqual(r, { followed: 1, skipped: 1 });
  assert.ok((await friendsOf(READER)).includes(N));
});

test("Claimed and Imported players stay player-only", async () => {
  await follow(READER, C);
  assert.equal(await followsAccount(READER, CLAIMER), false);
  await follow(READER, LONE);
  const accounts = await scratch.db.query(
    "select followed_account_id from account_follow where account_id = $1",
    [READER],
  );
  assert.deepEqual(
    accounts.rows.map((r) => r.followed_account_id),
    [OWNER],
  );
  // Unfollowing a Claimed player is the one player.
  const r = await unfollow(READER, C);
  assert.equal(data(r).unfollowed, undefined);
  assert.equal(await followsAccount(READER, OWNER), true);
});
