import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import {
  emailHash,
  validateRedirectUris,
  validRedirectUri,
  normalizeScope,
  verifyPkce,
  registerClient,
  getClient,
  createAuthCode,
  redeemAuthCode,
  mintTokens,
  redeemRefreshToken,
  validateAccessToken,
} from "../src/index.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_oauth_${process.pid}`;
const URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);

let db;
let accountId;
const JAMIE = emailHash("owner-test@example.com");

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.query(`create database ${NAME}`);
  await admin.end();
  await migrate({
    databaseUrl: URL,
    migrationsDir: path.join(repoRoot, "db/migrations"),
  });
  db = new pg.Client({ connectionString: URL });
  await db.connect();
  const { rows } = await db.query(
    `insert into account (email_hash, status, is_owner, role) values ($1, 'approved', true, 'owner') returning account_id`,
    [JAMIE],
  );
  accountId = rows[0].account_id;
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

test("redirect URI validation: https or localhost http only, no fragments", () => {
  assert.ok(validRedirectUri("https://claude.ai/api/mcp/auth_callback"));
  assert.ok(validRedirectUri("http://localhost:33418/cb"));
  assert.equal(validRedirectUri("http://evil.example/cb"), "");
  assert.equal(validRedirectUri("https://ok.example/cb#frag"), "");
  assert.equal(validRedirectUri("https://user:pw@ok.example/cb"), "");
  assert.equal(validateRedirectUris([]), null);
  assert.deepEqual(
    validateRedirectUris(["https://a.example/cb", "https://a.example/cb"]),
    ["https://a.example/cb"],
  );
});

test("scope normalization is a closed set", () => {
  assert.equal(normalizeScope(""), "cr:read");
  assert.equal(normalizeScope("cr:read"), "cr:read");
  assert.equal(normalizeScope("cr:read cr:write"), "");
});

test("PKCE S256 verifies the RFC vector shape and rejects mismatches", () => {
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  assert.equal(verifyPkce(verifier, challenge), true);
  assert.equal(verifyPkce(verifier + "x", challenge), false);
  assert.equal(verifyPkce("short", challenge), false);
});

test("client registration round-trips; unknown and malformed ids resolve null", async () => {
  const created = await registerClient(db, {
    clientName: "Claude",
    redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
  });
  const loaded = await getClient(db, created.clientId);
  assert.deepEqual(loaded.redirectUris, [
    "https://claude.ai/api/mcp/auth_callback",
  ]);
  assert.equal(await getClient(db, "nope"), null);
  assert.equal(
    await getClient(db, crypto.randomBytes(18).toString("base64url")),
    null,
  );
});

test("auth codes are single-use; the raced second redemption loses", async () => {
  const { clientId } = await registerClient(db, {
    clientName: "c1",
    redirectUris: ["https://a.example/cb"],
  });
  const code = await createAuthCode(db, {
    clientId,
    accountId,
    redirectUri: "https://a.example/cb",
    scope: "cr:read",
    codeChallenge: crypto
      .createHash("sha256")
      .update("v".repeat(43))
      .digest("base64url"),
  });
  const first = await redeemAuthCode(db, code);
  assert.equal(first.accountId, accountId);
  assert.equal(await redeemAuthCode(db, code), null);
});

test("access tokens validate to account context; the gate applies here too", async () => {
  const { clientId } = await registerClient(db, {
    clientName: "c2",
    redirectUris: ["https://b.example/cb"],
  });
  const tokens = await mintTokens(db, {
    clientId,
    accountId,
    scope: "cr:read",
  });
  const ctx = await validateAccessToken(db, tokens.accessToken);
  assert.equal(ctx.accountId, accountId);
  assert.equal(ctx.isOwner, true);
  assert.equal(await validateAccessToken(db, "eat_bogus"), null);

  await db.query(
    `update account set status = 'disabled' where account_id = $1`,
    [accountId],
  );
  assert.equal(
    await validateAccessToken(db, tokens.accessToken),
    null,
    "gate on every request",
  );
  await db.query(
    `update account set status = 'approved' where account_id = $1`,
    [accountId],
  );
});

test("refresh rotation works and replaying the old token revokes the family", async () => {
  const { clientId } = await registerClient(db, {
    clientName: "c3",
    redirectUris: ["https://c.example/cb"],
  });
  const first = await mintTokens(db, { clientId, accountId, scope: "cr:read" });
  const rotated = await redeemRefreshToken(db, {
    refreshToken: first.refreshToken,
    clientId,
  });
  assert.equal(rotated.status, "ok");
  assert.ok(await validateAccessToken(db, rotated.tokens.accessToken));

  const replay = await redeemRefreshToken(db, {
    refreshToken: first.refreshToken,
    clientId,
  });
  assert.equal(replay.status, "reuse_revoked");
  assert.equal(
    await validateAccessToken(db, rotated.tokens.accessToken),
    null,
    "family revocation kills every descendant, including the newest access token",
  );
  const again = await redeemRefreshToken(db, {
    refreshToken: rotated.tokens.refreshToken,
    clientId,
  });
  assert.equal(
    again.status,
    "invalid",
    "revoked family refuses its newest refresh too",
  );
});

test("client mismatch is invalid, not a revocation", async () => {
  const { clientId } = await registerClient(db, {
    clientName: "c4",
    redirectUris: ["https://d.example/cb"],
  });
  const { clientId: other } = await registerClient(db, {
    clientName: "c5",
    redirectUris: ["https://e.example/cb"],
  });
  const tokens = await mintTokens(db, {
    clientId,
    accountId,
    scope: "cr:read",
  });
  const result = await redeemRefreshToken(db, {
    refreshToken: tokens.refreshToken,
    clientId: other,
  });
  assert.equal(result.status, "invalid");
  assert.ok(
    await validateAccessToken(db, tokens.accessToken),
    "family untouched",
  );
});

test("absolute family lifetime forces re-consent", async () => {
  const { clientId } = await registerClient(db, {
    clientName: "c6",
    redirectUris: ["https://f.example/cb"],
  });
  const tokens = await mintTokens(db, {
    clientId,
    accountId,
    scope: "cr:read",
  });
  await db.query(
    `update oauth_family set absolute_expires_at = now() - interval '1 minute' where family_id = $1`,
    [tokens.familyId],
  );
  const result = await redeemRefreshToken(db, {
    refreshToken: tokens.refreshToken,
    clientId,
  });
  assert.equal(result.status, "invalid");
  assert.equal(
    await validateAccessToken(db, tokens.accessToken),
    null,
    "expired family invalidates access too",
  );
});
