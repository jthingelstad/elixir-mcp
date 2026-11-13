import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";
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
  issueServiceToken,
  validateServiceToken,
  serviceTokenAccountByName,
  describeRefusedCredential,
  OAUTH_SCOPES,
} from "../src/index.mjs";
import { STANDARD_OAUTH_SCOPES } from "@elixir-mcp/contracts";
import { createScratch, dropScratch } from "../../ingest/test/helpers.mjs";

const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_oauth_${process.pid}`;
const URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);
const RESOURCE = "https://elixir.poapkings.com/mcp";

let db;
let accountId;
const JAMIE = emailHash("owner-test@example.com");

before(async () => {
  await createScratch(NAME);
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
  await dropScratch(NAME);
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
  // A client that names no scope is offered every STANDARD capability
  // (1.0.0); account:email is granted only to a client that names it.
  assert.equal(normalizeScope(""), STANDARD_OAUTH_SCOPES.join(" "));
  assert.equal(
    normalizeScope(""),
    OAUTH_SCOPES.filter((s) => s !== "account:email").join(" "),
  );
  assert.equal(
    normalizeScope("account:email cr:read"),
    "cr:read account:email",
    "asked for by name, it is accepted and ordered last",
  );
  assert.equal(normalizeScope("cr:read"), "cr:read");
  assert.equal(
    normalizeScope("feedback:write cr:read feedback:write"),
    "cr:read feedback:write",
  );
  assert.equal(
    normalizeScope(OAUTH_SCOPES.toReversed().join(" ")),
    OAUTH_SCOPES.join(" "),
    "stored scopes have one canonical order",
  );
  assert.equal(normalizeScope("cr:read cr:admin"), "");
  assert.equal(
    normalizeScope("feedback:write"),
    "",
    "mutation capabilities never imply the baseline read grant",
  );
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
    resource: RESOURCE,
    codeChallenge: crypto
      .createHash("sha256")
      .update("v".repeat(43))
      .digest("base64url"),
  });
  const first = await redeemAuthCode(db, code);
  assert.equal(first.accountId, accountId);
  assert.equal(first.scope, "cr:read");
  assert.equal(first.resource, RESOURCE);
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
    scope: "cr:read feedback:write",
    resource: RESOURCE,
  });
  const ctx = await validateAccessToken(db, tokens.accessToken, {
    resource: RESOURCE,
  });
  assert.equal(ctx.accountId, accountId);
  assert.equal(ctx.isOwner, true);
  assert.equal(ctx.scope, "cr:read feedback:write");
  assert.deepEqual(ctx.scopes, ["cr:read", "feedback:write"]);
  assert.equal(ctx.resource, RESOURCE);
  assert.equal(ctx.credentialType, "oauth");
  assert.equal(
    await validateAccessToken(db, tokens.accessToken),
    null,
    "resource servers must name the audience they are validating",
  );
  assert.equal(
    await validateAccessToken(db, tokens.accessToken, {
      resource: "https://other.example/mcp",
    }),
    null,
    "an access token is valid only at its intended audience",
  );
  assert.equal(
    await validateAccessToken(db, "eat_bogus", { resource: RESOURCE }),
    null,
  );

  await db.query(
    `update account set status = 'disabled' where account_id = $1`,
    [accountId],
  );
  assert.equal(
    await validateAccessToken(db, tokens.accessToken, { resource: RESOURCE }),
    null,
    "gate on every request",
  );
  await db.query(
    `update account set status = 'approved' where account_id = $1`,
    [accountId],
  );
});

test("a withdrawn owner's agents are refused at both doors (#129)", async () => {
  // A person with one agent, the agent holding an OAuth grant and a
  // service token. Withdrawing the PERSON used to stop only the person's
  // own grants: both doors read the token's account alone.
  const {
    rows: [person],
  } = await db.query(
    `insert into account (email_hash, status, role) values ($1, 'approved', 'member')
     returning account_id`,
    [emailHash("withdrawn-owner@example.com")],
  );
  const {
    rows: [agent],
  } = await db.query(
    `insert into account (status, role, kind, owned_by_account_id, public_id)
     values ('approved', 'member', 'agent', $1, 'wdrawnagent1')
     returning account_id`,
    [person.account_id],
  );
  const { clientId } = await registerClient(db, {
    clientName: "agent-client",
    redirectUris: ["https://w.example/cb"],
  });
  const tokens = await mintTokens(db, {
    clientId,
    accountId: agent.account_id,
    scope: "cr:read",
    resource: RESOURCE,
  });
  const key = await issueServiceToken(db, {
    accountId: agent.account_id,
    name: "withdrawn-owner-agent",
  });
  const oauthOk = () =>
    validateAccessToken(db, tokens.accessToken, { resource: RESOURCE });
  const keyOk = () => validateServiceToken(db, key);
  const byName = () => serviceTokenAccountByName(db, "withdrawn-owner-agent");

  assert.equal((await oauthOk())?.accountId, agent.account_id);
  assert.equal((await keyOk())?.accountId, agent.account_id);
  assert.equal((await byName())?.accountId, agent.account_id);

  for (const status of ["disabled", "denied", "requested"]) {
    await db.query(`update account set status = $2 where account_id = $1`, [
      person.account_id,
      status,
    ]);
    assert.equal(await oauthOk(), null, `OAuth refused, owner ${status}`);
    assert.equal(await keyOk(), null, `service token refused, owner ${status}`);
    assert.equal(await byName(), null, `profile refused, owner ${status}`);
  }
  // The refusal is named for the agent's page, not read as a wrong door.
  assert.equal(
    (await describeRefusedCredential(db, key)).reason,
    "principal_suspended",
  );

  // Access restored: the same keys work again, as a suspended agent's do.
  await db.query(
    `update account set status = 'approved' where account_id = $1`,
    [person.account_id],
  );
  assert.equal((await oauthOk())?.accountId, agent.account_id);
  assert.equal((await keyOk())?.accountId, agent.account_id);
});

test("refresh rotation preserves scope/resource and replaying the old token revokes the family", async () => {
  const { clientId } = await registerClient(db, {
    clientName: "c3",
    redirectUris: ["https://c.example/cb"],
  });
  const first = await mintTokens(db, {
    clientId,
    accountId,
    scope: "cr:read follows:write",
    resource: RESOURCE,
  });
  const rotated = await redeemRefreshToken(db, {
    refreshToken: first.refreshToken,
    clientId,
    resource: RESOURCE,
  });
  assert.equal(rotated.status, "ok");
  assert.equal(rotated.tokens.scope, "cr:read follows:write");
  assert.equal(rotated.tokens.resource, RESOURCE);
  const rotatedContext = await validateAccessToken(
    db,
    rotated.tokens.accessToken,
    { resource: RESOURCE },
  );
  assert.deepEqual(rotatedContext.scopes, ["cr:read", "follows:write"]);

  const replay = await redeemRefreshToken(db, {
    refreshToken: first.refreshToken,
    clientId,
    resource: RESOURCE,
  });
  assert.equal(replay.status, "reuse_revoked");
  assert.equal(
    await validateAccessToken(db, rotated.tokens.accessToken, {
      resource: RESOURCE,
    }),
    null,
    "family revocation kills every descendant, including the newest access token",
  );
  const again = await redeemRefreshToken(db, {
    refreshToken: rotated.tokens.refreshToken,
    clientId,
    resource: RESOURCE,
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
    resource: RESOURCE,
  });
  const result = await redeemRefreshToken(db, {
    refreshToken: tokens.refreshToken,
    clientId: other,
    resource: RESOURCE,
  });
  assert.equal(result.status, "invalid");
  assert.ok(
    await validateAccessToken(db, tokens.accessToken, { resource: RESOURCE }),
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
    resource: RESOURCE,
  });
  await db.query(
    `update oauth_family set absolute_expires_at = now() - interval '1 minute' where family_id = $1`,
    [tokens.familyId],
  );
  const result = await redeemRefreshToken(db, {
    refreshToken: tokens.refreshToken,
    clientId,
    resource: RESOURCE,
  });
  assert.equal(result.status, "invalid");
  assert.equal(
    await validateAccessToken(db, tokens.accessToken, { resource: RESOURCE }),
    null,
    "expired family invalidates access too",
  );
});

test("old Collection scope is removed without losing retained OAuth permissions", async () => {
  const retained = "cr:read follows:write account:write feedback:write";
  assert.equal(normalizeScope(retained + " collections:write"), retained);
  assert.equal(normalizeScope("cr:read collections:write unknown:write"), "");
  const client = await registerClient(db, {
    clientName: "retired-collections",
    redirectUris: ["https://example.com/callback"],
  });
  const tokens = await mintTokens(db, {
    clientId: client.clientId,
    accountId,
    scope: retained,
    resource: RESOURCE,
  });
  await db.query(
    "update oauth_family set scope='cr:read recordings:write collections:write account:write feedback:write' where family_id=$1",
    [tokens.familyId],
  );
  const access = await validateAccessToken(db, tokens.accessToken, {
    resource: RESOURCE,
  });
  assert.equal(access.scope, retained);
  const renewed = await redeemRefreshToken(db, {
    refreshToken: tokens.refreshToken,
    clientId: client.clientId,
    resource: RESOURCE,
  });
  assert.equal(renewed.status, "ok");
  assert.equal(renewed.tokens.scope, retained);
});

test("recordings:write, follows:write's old name, keeps every grant, code and key working and is never rewritten (2026-11-13)", async () => {
  // A client still asking for the old name gets the new one.
  assert.equal(
    normalizeScope("cr:read recordings:write account:email"),
    "cr:read follows:write account:email",
  );
  assert.equal(
    normalizeScope("cr:read recordings:write follows:write"),
    "cr:read follows:write",
  );
  const client = await registerClient(db, {
    clientName: "old-scope-name",
    redirectUris: ["https://example.com/callback"],
  });
  const tokens = await mintTokens(db, {
    clientId: client.clientId,
    accountId,
    scope: "cr:read follows:write",
    resource: RESOURCE,
  });
  // A grant stored before the rename, as production holds them.
  await db.query(
    "update oauth_family set scope='cr:read recordings:write account:email' where family_id=$1",
    [tokens.familyId],
  );
  const access = await validateAccessToken(db, tokens.accessToken, {
    resource: RESOURCE,
  });
  assert.equal(access.scope, "cr:read follows:write account:email");
  assert.ok(access.scopes.includes("follows:write"));
  const renewed = await redeemRefreshToken(db, {
    refreshToken: tokens.refreshToken,
    clientId: client.clientId,
    resource: RESOURCE,
  });
  assert.equal(renewed.status, "ok");
  assert.equal(renewed.tokens.scope, "cr:read follows:write account:email");
  const {
    rows: [stored],
  } = await db.query("select scope from oauth_family where family_id=$1", [
    tokens.familyId,
  ]);
  assert.equal(stored.scope, "cr:read recordings:write account:email");
  // A key stored with the old name holds the new one.
  const key = await issueServiceToken(db, {
    accountId,
    name: "old-scope-key",
    scope: "cr:read recordings:write",
  });
  const keyed = await validateServiceToken(db, key);
  assert.deepEqual(keyed.scopes, ["cr:read", "follows:write"]);
});

test("clans:attest, retired in 13.0.0, is dropped from a request and from every stored grant, which keeps working without it", async () => {
  // A request that names it is the request without it.
  assert.equal(
    normalizeScope("clans:attest cr:read account:email"),
    "cr:read account:email",
  );
  assert.equal(normalizeScope("cr:read clans:attest unknown:write"), "");
  assert.ok(!OAUTH_SCOPES.includes("clans:attest"));
  // A grant stored before the retirement holds it; its tokens keep
  // working with the rest of their scope, and storage is not rewritten.
  const client = await registerClient(db, {
    clientName: "retired-clans-attest",
    redirectUris: ["https://example.com/callback"],
  });
  const tokens = await mintTokens(db, {
    clientId: client.clientId,
    accountId,
    scope: "cr:read",
    resource: RESOURCE,
  });
  await db.query(
    "update oauth_family set scope='cr:read clans:attest' where family_id=$1",
    [tokens.familyId],
  );
  const access = await validateAccessToken(db, tokens.accessToken, {
    resource: RESOURCE,
  });
  assert.equal(access.scope, "cr:read");
  const renewed = await redeemRefreshToken(db, {
    refreshToken: tokens.refreshToken,
    clientId: client.clientId,
    resource: RESOURCE,
  });
  assert.equal(renewed.status, "ok");
  assert.equal(renewed.tokens.scope, "cr:read");
  const {
    rows: [stored],
  } = await db.query("select scope from oauth_family where family_id=$1", [
    tokens.familyId,
  ]);
  assert.equal(stored.scope, "cr:read clans:attest");
});

test("service keys retain write-only permissions while the retired scope is filtered", async () => {
  const key = await issueServiceToken(db, {
    accountId,
    name: "write-only-retirement",
    scope: "feedback:write collections:write",
  });
  const account = await validateServiceToken(db, key);
  assert.equal(account.scope, "feedback:write");
  assert.deepEqual(account.scopes, ["feedback:write"]);
});
