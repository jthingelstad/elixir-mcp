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
import { emailHash } from "../../auth/src/index.mjs";
import { makeHandler } from "../src/handler.mjs";

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
