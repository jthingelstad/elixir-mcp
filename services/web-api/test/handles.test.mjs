/**
 * Account handles (Jamie, 2026-11-15), against a real PostgreSQL
 * database. A handle is optional, unique and public: set and removed in
 * Settings, checked while you type, suggested from your main player's
 * name, another address for your account page, found in search, shown
 * beside a verified follower, and cleared by Admin when someone reports
 * it. Never on MCP.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { createSession } from "@elixir-mcp/auth";
import { ensurePassport } from "@elixir-mcp/stamps";
import { makeHandler } from "../src/handler.mjs";
import { handleProblem, normalizeHandle } from "../src/handle.mjs";

// Made-up tags: this repository is public.
const V = "#0VRGQ2YC"; // MAIN's verified primary, named "Ruby Knight!"
const F = "#0J8RLG2V"; // FAN's verified primary; FAN follows V

let scratch, handler, MAIN, FAN, OTHER, STAFF;
const sessions = new Map();
const pageIds = new Map();
const data = (r) => JSON.parse(r.body);

async function person(hash, role = "member") {
  const id = (
    await scratch.db.query(
      "insert into account(email_hash,status,role) values ($1,'approved',$2) returning account_id",
      [hash, role],
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
const call = (id, method, path, { body, query = {} } = {}) =>
  handler({
    path,
    method,
    queryStringParameters: query,
    headers: {
      cookie: `__Host-elixir_session=${sessions.get(id)}`,
      "x-elixir-client": "web",
      "cloudfront-viewer-address": "8.8.4.4:443",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
const setHandle = (id, handle) =>
  call(id, "POST", "/api/me/handle", { body: { handle } });
const verified = (account, tag) =>
  scratch.db.query(
    `insert into claim(account_id,player_tag,status,is_primary,relationship,verified_at)
     values ($1,$2,'verified',true,'primary',now())`,
    [account, tag],
  );

before(async () => {
  scratch = await scratchDb("handles");
  const { db } = scratch;
  await db.query(
    "insert into player(player_tag,name) values ($1,'Ruby Knight!'), ($2,'Fan')",
    [V, F],
  );
  handler = makeHandler({ databaseUrl: scratch.url, secret: "test" });
  MAIN = await person("h-main");
  FAN = await person("h-fan");
  OTHER = await person("h-other");
  STAFF = await person("h-staff", "admin");
  await verified(MAIN, V);
  await verified(FAN, F);
  await db.query(
    "insert into account_follow(account_id,followed_account_id) values ($1,$2)",
    [FAN, MAIN],
  );
  await db.query(
    `insert into claim(account_id,player_tag,status,is_primary,relationship)
     values ($1,$2,'unverified',false,'friend')`,
    [FAN, V],
  );
});

after(async () => {
  await scratch?.drop();
});

test("a handle is keyed lowercase, without its @, and some words are refused", () => {
  assert.equal(normalizeHandle("  @Ruby_Knight "), "ruby_knight");
  assert.equal(handleProblem("ab"), "invalid");
  assert.equal(handleProblem("has space"), "invalid");
  assert.equal(handleProblem("a".repeat(21)), "invalid");
  assert.equal(handleProblem("admin"), "reserved");
  assert.equal(handleProblem("elixir_2"), "reserved");
  assert.equal(handleProblem("x_s_h_i_t_x"), "blocked");
  assert.equal(handleProblem("ruby_knight"), null);
});

test("with no handle, Elixir suggests one from the main player's name", async () => {
  const r = await call(MAIN, "GET", "/api/me/handle-check");
  assert.equal(r.statusCode, 200);
  assert.equal(data(r).suggestion, "rubyknight");
});

test("a handle is set, read back on /api/me, and is then taken for anyone else", async () => {
  const set = await setHandle(MAIN, "@Ruby_Knight");
  assert.equal(set.statusCode, 200);
  assert.equal(data(set).handle, "ruby_knight");
  const me = data(await call(MAIN, "GET", "/api/me"));
  assert.equal(me.handle, "ruby_knight");

  const check = data(
    await call(OTHER, "GET", "/api/me/handle-check", {
      query: { handle: "RUBY_KNIGHT" },
    }),
  );
  assert.equal(check.available, false);
  assert.equal(check.error, "taken");
  assert.match(check.message, /already has/);
  // Your own handle is yours to keep.
  const own = data(
    await call(MAIN, "GET", "/api/me/handle-check", {
      query: { handle: "ruby_knight" },
    }),
  );
  assert.equal(own.available, true);

  const clash = await setHandle(OTHER, "ruby_knight");
  assert.equal(clash.statusCode, 409);
  assert.equal(data(clash).error, "taken");
  const reserved = await setHandle(OTHER, "support");
  assert.equal(reserved.statusCode, 400);
  assert.equal(data(reserved).error, "reserved");
  const bad = await setHandle(OTHER, 42);
  assert.equal(bad.statusCode, 400);
});

test("/home/@handle's read is the same account page", async () => {
  const byHandle = await call(FAN, "GET", "/api/accounts/@Ruby_Knight");
  assert.equal(byHandle.statusCode, 200);
  const page = data(byHandle);
  assert.equal(page.account.id, pageIds.get(MAIN));
  assert.equal(page.account.handle, "ruby_knight");
  const byId = data(
    await call(FAN, "GET", `/api/accounts/${pageIds.get(MAIN)}`),
  );
  assert.equal(byId.account.handle, "ruby_knight");
  const none = await call(FAN, "GET", "/api/accounts/@nobody_here");
  assert.equal(none.statusCode, 404);
});

test("search finds an account by its handle's start, exact first", async () => {
  await setHandle(OTHER, "ruby");
  const r = await call(FAN, "GET", "/api/accounts", { query: { q: "@ru" } });
  assert.equal(r.statusCode, 200);
  const found = data(r).accounts;
  assert.deepEqual(
    found.map((a) => a.handle),
    ["ruby", "ruby_knight"],
  );
  const knight = found.find((a) => a.handle === "ruby_knight");
  assert.equal(knight.id, pageIds.get(MAIN));
  assert.deepEqual(knight.player, { tag: V, name: "Ruby Knight!" });
  // `_` is a letter here, never a LIKE wildcard.
  const under = data(
    await call(FAN, "GET", "/api/accounts", { query: { q: "rub_" } }),
  ).accounts;
  assert.deepEqual(under, []);
  assert.deepEqual(
    data(await call(FAN, "GET", "/api/accounts", { query: { q: "r" } }))
      .accounts,
    [],
  );
});

test("a verified follower shows its account's handle on the player page", async () => {
  await setHandle(FAN, "the_fan");
  const r = await call(OTHER, "GET", "/api/player", { query: { tag: V } });
  assert.equal(r.statusCode, 200);
  const followers = data(r).followers.players;
  const fan = followers.find((f) => f.tag === F);
  assert.ok(fan, "FAN's player is listed as a follower");
  assert.equal(fan.handle, "the_fan");
});

test("removing a handle frees it", async () => {
  const off = await setHandle(OTHER, null);
  assert.equal(off.statusCode, 200);
  assert.equal(data(off).handle, null);
  const check = data(
    await call(FAN, "GET", "/api/me/handle-check", {
      query: { handle: "ruby" },
    }),
  );
  assert.equal(check.available, true);
});

test("Admin clears a reported handle, and the account's bell says so", async () => {
  const refused = await call(FAN, "POST", "/api/admin/accounts/handle-clear", {
    body: { account_id: MAIN },
  });
  assert.equal(refused.statusCode, 403);
  const cleared = await call(
    STAFF,
    "POST",
    "/api/admin/accounts/handle-clear",
    { body: { account_id: MAIN } },
  );
  assert.equal(cleared.statusCode, 200);
  const again = await call(STAFF, "POST", "/api/admin/accounts/handle-clear", {
    body: { account_id: MAIN },
  });
  assert.equal(again.statusCode, 404);
  assert.equal(data(await call(MAIN, "GET", "/api/me")).handle, null);
  const { rows } = await scratch.db.query(
    "select kind from account_event where account_id = $1 and kind = 'handle_cleared'",
    [MAIN],
  );
  assert.equal(rows.length, 1);
  assert.equal(
    (await call(FAN, "GET", "/api/accounts/@ruby_knight")).statusCode,
    404,
  );
});
