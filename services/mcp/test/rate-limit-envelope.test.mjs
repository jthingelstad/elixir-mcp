/**
 * A rate-limited caller is refused in the contract envelope.
 *
 * The 429 used to be {"error":"rate_limited"} — `error` as a bare string,
 * no meta, no request_id, no Retry-After — where every other refusal in
 * the service uses {code, message, hint}. A client written against the
 * tool contract could not parse its own rate limit (playtest round,
 * 2026-09-09).
 *
 * The token carries hourly_rate_limit 1 so the ceiling is reached on the
 * second call rather than the 301st; that is the same account.hourlyRateLimit
 * branch production uses, just reached sooner.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";
import { emailHash } from "../../../packages/auth/src/index.mjs";
import {
  makeHandler,
  hourlyBucketFor,
  HOURLY_RATE_LIMIT,
} from "../src/handler.mjs";
import { countsAgainstHour } from "../src/protocol.mjs";
import {
  createScratch,
  dropScratch,
} from "../../../packages/ingest/test/helpers.mjs";

const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_ratelimit_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = "svt_rate_limited_key";

let db;
let handler;

// A message that counts against the hour. The handshake does not
// (DECISIONS, "Only calls count against the MCP hour"), so these tests
// spend the hour with a read of the manual, which does.
const COUNTED = {
  jsonrpc: "2.0",
  id: 1,
  method: "resources/read",
  params: { uri: "elixir://updates" },
};

const call = (body = COUNTED, key = KEY) =>
  handler({
    path: "/mcp",
    method: "POST",
    headers: { authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });

before(async () => {
  await createScratch(NAME);
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  const { rows } = await db.query(
    `insert into account (email_hash, status) values ($1, 'approved')
     returning account_id`,
    [emailHash("rate-limit@example.com")],
  );
  await db.query(
    `insert into service_token (account_id, name, token_hash, hourly_rate_limit)
     values ($1, 'busy-bot', $2, 1)`,
    [rows[0].account_id, crypto.createHash("sha256").update(KEY).digest("hex")],
  );
  handler = makeHandler({
    databaseUrl: DB_URL,
    issuer: "https://elixir.poapkings.com",
    sendLoginEmail: async () => {},
  });
});

after(async () => {
  await db.end();
  await dropScratch(NAME);
});

test("the rate limit refuses in the contract envelope, with a real Retry-After", async () => {
  assert.equal((await call()).statusCode, 200, "the first call is within it");

  const res = await call();
  assert.equal(res.statusCode, 429);

  const body = JSON.parse(res.body);
  assert.equal(typeof body.error, "object", "error is an object, not a string");
  assert.equal(body.error.code, "quota_exceeded");
  assert.ok(body.error.hint, "a refusal must say what to do next");
  // The ceiling that was actually applied is this token's, not the default.
  assert.match(body.error.message, /\b1 requests per hour\b/);

  assert.match(body.meta.request_id, UUID, "must be reportable");
  assert.ok(body.meta.contract_version, "must carry contract_version");
  assert.ok(body.meta.disclaimer, "must carry the disclaimer");

  // Hour-aligned windows, so the wait is the remainder of this one.
  const retryAfter = Number(res.headers["retry-after"]);
  assert.ok(
    Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= 3600,
    `Retry-After must be the rest of the hour, got ${res.headers["retry-after"]}`,
  );
});

test("a key with its own ceiling spends from its own bucket, not its owner's (2026-09-21)", async () => {
  // busy-bot has spent its hour (ceiling 1) above. A second key on the
  // SAME account with no ceiling of its own still has the account's 300:
  // the busy key's calls did not count against the shared bucket.
  const plain = "svt_" + "b".repeat(43);
  await db.query(
    `insert into service_token (account_id, name, token_hash)
     select account_id, 'plain-bot', $1 from service_token where name = 'busy-bot'`,
    [crypto.createHash("sha256").update(plain).digest("hex")],
  );
  const res = await call(COUNTED, plain);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body).slice(0, 200));
  const { rows } = await db.query(
    `select bucket from rate_limit where bucket like 'mcp#%' order by bucket`,
  );
  const buckets = rows.map((r) => r.bucket);
  assert.ok(
    buckets.some((b) => b.startsWith("mcp#token#")),
    `own bucket: ${buckets}`,
  );
  assert.ok(
    buckets.some((b) => /^mcp#[0-9a-f-]{36}$/.test(b)),
    `owner bucket: ${buckets}`,
  );
});

test("hourlyBucketFor: a key's own ceiling, else the account", () => {
  assert.equal(
    hourlyBucketFor({ accountId: "person", tokenId: 7, hourlyRateLimit: 50 }),
    "mcp#token#7",
  );
  assert.equal(
    hourlyBucketFor({ accountId: "person", tokenId: 7, hourlyRateLimit: null }),
    "mcp#person",
  );
  assert.equal(hourlyBucketFor({ accountId: "person" }), "mcp#person");
});

test("the handshake is authenticated but never counted; a call is (review 2026-10-21 §2)", async () => {
  // About 900 handshake messages a week each took an upsert and a slot of
  // the hour. They read no record; the hour is for calls. Which bucket a
  // counted call spends from is unchanged ("The hour is the account's").
  const { rows: acct } = await db.query(
    `insert into account (email_hash, status) values ($1, 'approved')
     returning account_id`,
    [emailHash("handshake@example.com")],
  );
  const key = "svt_" + "h".repeat(43);
  await db.query(
    `insert into service_token (account_id, name, token_hash)
     values ($1, 'handshake-bot', $2)`,
    [acct[0].account_id, crypto.createHash("sha256").update(key).digest("hex")],
  );
  const bucket = `mcp#${acct[0].account_id}`;
  const spent = async () => {
    const { rows } = await db.query(
      `select coalesce(sum(count), 0)::int as n from rate_limit where bucket = $1`,
      [bucket],
    );
    return rows[0].n;
  };
  const handshake = [
    [{ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, 200],
    [{ jsonrpc: "2.0", method: "notifications/initialized" }, 202],
    [{ jsonrpc: "2.0", id: 2, method: "ping" }, 200],
    [{ jsonrpc: "2.0", id: 3, method: "tools/list" }, 200],
    [{ jsonrpc: "2.0", id: 4, method: "resources/list" }, 200],
    [{ jsonrpc: "2.0", id: 5, method: "resources/templates/list" }, 200],
    [{ jsonrpc: "2.0", id: 6, method: "prompts/list" }, 200],
  ];
  for (const [body, status] of handshake) {
    const res = await call(body, key);
    assert.equal(res.statusCode, status, `${body.method}: ${res.body}`);
  }
  assert.equal(await spent(), 0, "no handshake message spent the hour");

  assert.equal((await call(COUNTED, key)).statusCode, 200);
  assert.equal(await spent(), 1, "a read of the manual is a call");

  // A spent hour refuses the next call, and still lets a client connect:
  // reconnecting is how it learns the hour's reset from the 429.
  await db.query(`update rate_limit set count = $2 where bucket = $1`, [
    bucket,
    HOURLY_RATE_LIMIT,
  ]);
  assert.equal((await call(COUNTED, key)).statusCode, 429);
  for (const [body, status] of handshake) {
    assert.equal((await call(body, key)).statusCode, status, body.method);
  }

  // Not counted is never unauthenticated: a dead key's notification is a 401.
  const refused = await call(
    { jsonrpc: "2.0", method: "notifications/initialized" },
    "svt_" + "d".repeat(43),
  );
  assert.equal(refused.statusCode, 401);
  const anonymous = await handler({
    path: "/mcp",
    method: "POST",
    headers: {},
    body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/list" }),
  });
  assert.equal(anonymous.statusCode, 401);
});

test("countsAgainstHour: calls, reads and unknown methods count; the handshake does not", () => {
  const msg = (method, extra = { id: 1 }) => ({
    jsonrpc: "2.0",
    method,
    ...extra,
  });
  for (const method of [
    "initialize",
    "ping",
    "tools/list",
    "resources/list",
    "server/discover",
    "resources/templates/list",
    "prompts/list",
  ])
    assert.equal(countsAgainstHour(msg(method)), false, method);
  assert.equal(
    countsAgainstHour(msg("notifications/initialized", {})),
    false,
    "a notification",
  );
  for (const method of ["tools/call", "resources/read", "prompts/get"])
    assert.equal(countsAgainstHour(msg(method)), true, method);
  assert.equal(countsAgainstHour(msg("tools/list", { id: null })), false);
  // Refused before any work anyway; counted so a malformed stream is not free.
  assert.equal(countsAgainstHour([msg("ping")]), true, "a batch");
  assert.equal(
    countsAgainstHour({ id: 1, method: "ping" }),
    true,
    "no jsonrpc",
  );
  assert.equal(countsAgainstHour(null), true);
});
