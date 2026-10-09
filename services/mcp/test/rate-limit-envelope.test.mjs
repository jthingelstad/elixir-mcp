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
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import { emailHash } from "../../../packages/auth/src/index.mjs";
import {
  makeHandler,
  hourlyBucketFor,
  HOURLY_RATE_LIMIT,
} from "../src/handler.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_ratelimit_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = "svt_rate_limited_key";

let db;
let handler;

const call = () =>
  handler({
    rawPath: "/mcp",
    requestContext: { http: { method: "POST", sourceIp: "1.1.1.1" } },
    headers: { authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
  });

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
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
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
  const res = await handler({
    rawPath: "/mcp",
    requestContext: { http: { method: "POST", sourceIp: "1.1.1.1" } },
    headers: { authorization: `Bearer ${plain}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "initialize" }),
  });
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

test("each agent has its own hour; the owner's and its siblings' are untouched (2026-10-08)", async () => {
  // Jamie, 2026-10-08: "yes, seperate limits". One replay emptied the
  // owner's 300 and the owner's three Discord agents were refused for 52
  // minutes. An agent still spends its owner's DAILY quota (makeQuota keys
  // on account.budget); only the hour moved to the principal.
  const { rows: owner } = await db.query(
    `insert into account (email_hash, status) values ($1, 'approved')
     returning account_id`,
    [emailHash("agent-owner@example.com")],
  );
  const ownerId = owner[0].account_id;
  const agents = [];
  for (const pub of ["ratebota0001", "ratebotb0002"]) {
    const { rows } = await db.query(
      `insert into account (kind, status, public_id, owned_by_account_id)
       values ('agent', 'approved', $1, $2) returning account_id`,
      [pub, ownerId],
    );
    const key = `svt_${pub.padEnd(43, "x")}`;
    await db.query(
      `insert into service_token (account_id, name, token_hash)
       values ($1, $2, $3)`,
      [
        rows[0].account_id,
        pub,
        crypto.createHash("sha256").update(key).digest("hex"),
      ],
    );
    agents.push({ id: rows[0].account_id, pub, key });
  }
  const agentCall = (a) =>
    handler({
      rawPath: `/a/${a.pub}/mcp`,
      requestContext: { http: { method: "POST", sourceIp: "1.1.1.1" } },
      headers: { authorization: `Bearer ${a.key}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "initialize" }),
    });
  for (const a of agents) {
    const res = await agentCall(a);
    assert.equal(res.statusCode, 200, String(res.body).slice(0, 200));
  }
  // Agent A has spent its hour; agent B and the owner have not been charged.
  await db.query(`update rate_limit set count = $2 where bucket = $1`, [
    `mcp#${agents[0].id}`,
    HOURLY_RATE_LIMIT,
  ]);
  const refused = await agentCall(agents[0]);
  assert.equal(refused.statusCode, 429, "agent A's own hour is spent");
  assert.match(
    JSON.parse(refused.body).error.message,
    new RegExp(`\\b${HOURLY_RATE_LIMIT} requests per hour\\b`),
    "at the tier rate",
  );
  assert.equal(
    (await agentCall(agents[1])).statusCode,
    200,
    "agent B still has its hour",
  );
  const { rows } = await db.query(
    `select bucket, count from rate_limit where bucket = any($1::text[])`,
    [[`mcp#${ownerId}`, `mcp#${agents[1].id}`]],
  );
  const counts = Object.fromEntries(
    rows.map((r) => [r.bucket, Number(r.count)]),
  );
  assert.equal(
    counts[`mcp#${ownerId}`],
    undefined,
    "the owner's hour was never charged",
  );
  assert.equal(
    counts[`mcp#${agents[1].id}`],
    2,
    "agent B spent from its own bucket",
  );
});

test("hourlyBucketFor: a key's own ceiling, else the principal, never the payer", () => {
  assert.equal(
    hourlyBucketFor({
      accountId: "agent",
      tokenId: 7,
      hourlyRateLimit: 50,
      budget: { accountId: "owner" },
    }),
    "mcp#token#7",
  );
  assert.equal(
    hourlyBucketFor({
      accountId: "agent",
      tokenId: 7,
      hourlyRateLimit: null,
      budget: { accountId: "owner" },
    }),
    "mcp#agent",
  );
  assert.equal(hourlyBucketFor({ accountId: "person" }), "mcp#person");
});
