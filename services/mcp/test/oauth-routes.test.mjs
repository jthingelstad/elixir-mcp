import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import {
  emailHash,
  FIRST_PARTY_ORIGINS,
  mintTokens,
  signinMailAllowed,
  validateAccessToken,
} from "../../auth/src/index.mjs";
import { familyClientsOn } from "../../migrate/src/ops-family-clients.mjs";
import { makeHandler } from "../src/handler.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_oroutes_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);
const ISSUER = "https://elixir.poapkings.com";
const EMAIL = "oauth-routes@example.com";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const RESOURCE = `${ISSUER}/mcp`;

let db;
let handler;
let provisioned = 0;
const sentEmails = [];

function event({
  method = "POST",
  path: p = "/",
  query,
  body,
  form,
  ip = "9.9.9.9",
  headers = {},
}) {
  // As CloudFront delivers it: the caller in cloudfront-viewer-address,
  // one shared edge node in sourceIp.
  return {
    rawPath: p,
    requestContext: { http: { method, sourceIp: "130.176.0.9" } },
    queryStringParameters: query,
    headers: { "cloudfront-viewer-address": `${ip}:50412`, ...headers },
    body: form ? new URLSearchParams(form).toString() : body,
  };
}

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
  await db.query(
    `insert into account (email_hash, status) values ($1, 'approved')`,
    [emailHash(EMAIL)],
  );
  handler = makeHandler({
    databaseUrl: DB_URL,
    issuer: ISSUER,
    sendLoginEmail: async (mail) => sentEmails.push(mail),
  });
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

test("discovery documents are well-formed and cacheable", async () => {
  const as = await handler(
    event({ method: "GET", path: "/.well-known/oauth-authorization-server" }),
  );
  const meta = JSON.parse(as.body);
  assert.equal(meta.issuer, ISSUER);
  assert.deepEqual(meta.code_challenge_methods_supported, ["S256"]);
  // client_secret_post is the family's own provisioned clients (0185).
  assert.deepEqual(meta.token_endpoint_auth_methods_supported, [
    "none",
    "client_secret_post",
  ]);
  assert.equal(meta.revocation_endpoint, `${ISSUER}/oauth/revoke`);
  assert.deepEqual(meta.scopes_supported, [
    "cr:read",
    "recordings:write",
    "collections:write",
    "account:write",
    "feedback:write",
    "account:email",
    "clans:attest",
  ]);
  const pr = await handler(
    event({ method: "GET", path: "/.well-known/oauth-protected-resource" }),
  );
  const prMeta = JSON.parse(pr.body);
  assert.equal(prMeta.resource, `${ISSUER}/mcp`);
  assert.deepEqual(prMeta.authorization_servers, [ISSUER]);
  assert.deepEqual(prMeta.scopes_supported, [
    "cr:read",
    "recordings:write",
    "collections:write",
    "account:write",
    "feedback:write",
    "account:email",
    "clans:attest",
  ]);
});

test("full flow: register -> authorize (email, code) -> 303 with iss -> token -> live bearer", async () => {
  const reg = await handler(
    event({
      path: "/oauth/register",
      body: JSON.stringify({
        client_name: "Claude",
        redirect_uris: [REDIRECT],
      }),
    }),
  );
  assert.equal(reg.statusCode, 201);
  const { client_id } = JSON.parse(reg.body);

  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  const authQuery = {
    client_id,
    redirect_uri: REDIRECT,
    state: "st4te",
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "cr:read",
    resource: RESOURCE,
  };

  const start = await handler(
    event({ method: "GET", path: "/oauth/authorize", query: authQuery }),
  );
  assert.equal(start.statusCode, 200);
  assert.match(start.headers["content-security-policy"], /form-action https:/);
  assert.match(start.body, /Connect Claude/);

  const emailStep = await handler(
    event({
      path: "/oauth/authorize",
      form: { step: "email", email: EMAIL, ...authQuery },
    }),
  );
  assert.equal(emailStep.statusCode, 200);
  assert.match(emailStep.body, /authorizes Claude/);
  assert.match(emailStep.body, /Read recorded game data/);
  // Capabilities the client did NOT ask for are offered as checkboxes. On
  // a person's own connection they start UNticked, each saying what the
  // connection cannot do without it (Jamie 2026-09-24).
  assert.match(
    emailStep.body,
    /<input type="checkbox" name="grant" value="recordings:write">/,
    "on a person's connection a write starts unticked",
  );
  assert.match(emailStep.body, /Unticked, it will not be able to track/);
  assert.match(
    emailStep.body,
    /<form[^]*name="grant"[^]*<\/form>/,
    "the boxes are inside the form, so a tick is posted",
  );
  assert.doesNotMatch(
    emailStep.body,
    /<li><strong>Change what you track<\/strong>/,
    "and are not listed among the granted ones",
  );
  assert.equal(sentEmails.length, 1);
  const { code: loginCode } = sentEmails[0];

  const codeStep = await handler(
    event({
      path: "/oauth/authorize",
      form: {
        step: "code",
        confirm: "1",
        email: EMAIL,
        code: loginCode,
        ...authQuery,
      },
    }),
  );
  assert.equal(codeStep.statusCode, 303);
  const redirect = new URL(codeStep.headers.location);
  assert.equal(redirect.origin + redirect.pathname, REDIRECT);
  assert.equal(redirect.searchParams.get("state"), "st4te");
  assert.equal(redirect.searchParams.get("iss"), ISSUER, "RFC 9207");
  const authCode = redirect.searchParams.get("code");
  assert.match(authCode, /^eac_/);

  const missingTokenResource = await handler(
    event({
      path: "/oauth/token",
      form: {
        grant_type: "authorization_code",
        code: authCode,
        code_verifier: verifier,
        client_id,
        redirect_uri: REDIRECT,
      },
    }),
  );
  assert.equal(missingTokenResource.statusCode, 400);
  assert.equal(JSON.parse(missingTokenResource.body).error, "invalid_target");

  const token = await handler(
    event({
      path: "/oauth/token",
      form: {
        grant_type: "authorization_code",
        code: authCode,
        code_verifier: verifier,
        client_id,
        redirect_uri: REDIRECT,
        resource: RESOURCE,
      },
    }),
  );
  assert.equal(token.statusCode, 200);
  const tokens = JSON.parse(token.body);
  assert.match(tokens.access_token, /^eat_/);
  assert.match(tokens.refresh_token, /^ert_/);
  assert.equal(tokens.scope, "cr:read");

  const ctx = await validateAccessToken(db, tokens.access_token, {
    resource: RESOURCE,
  });
  assert.equal(
    ctx.emailHash,
    emailHash(EMAIL),
    "the minted bearer resolves to the account",
  );

  // Wrong verifier on a fresh grant fails (need a new code — the old one burned).
  const bad = await handler(
    event({
      path: "/oauth/token",
      form: {
        grant_type: "authorization_code",
        code: authCode,
        code_verifier: verifier,
        client_id,
        redirect_uri: REDIRECT,
        resource: RESOURCE,
      },
    }),
  );
  assert.equal(
    JSON.parse(bad.body).error,
    "invalid_grant",
    "auth code is single-use",
  );

  const missingRefreshResource = await handler(
    event({
      path: "/oauth/token",
      form: {
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        client_id,
      },
    }),
  );
  assert.equal(missingRefreshResource.statusCode, 400);
  assert.equal(JSON.parse(missingRefreshResource.body).error, "invalid_target");

  const refreshed = await handler(
    event({
      path: "/oauth/token",
      form: {
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        client_id,
        resource: RESOURCE,
      },
    }),
  );
  assert.equal(refreshed.statusCode, 200);
  const refreshedTokens = JSON.parse(refreshed.body);
  assert.match(refreshedTokens.access_token, /^eat_/);
  assert.equal(refreshedTokens.scope, "cr:read");

  const listedTools = await handler({
    ...event({
      path: "/mcp",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      }),
    }),
    headers: { authorization: `Bearer ${refreshedTokens.access_token}` },
  });
  assert.equal(listedTools.statusCode, 200, listedTools.body);
  const declarations = JSON.parse(listedTools.body).result.tools;
  // elixir_timeline is not read-only (it advances the caller's own cursor)
  // but needs only cr:read: the bookmark is the reader's, and the scheduled
  // read-only routine is the tool's whole purpose (feedback #16).
  const readTools = declarations.filter(
    ({ annotations, name }) =>
      annotations.readOnlyHint || name === "elixir_timeline",
  );
  const writeTools = declarations.filter(
    ({ annotations, name }) =>
      !annotations.readOnlyHint && name !== "elixir_timeline",
  );
  assert.ok(readTools.length > 0);
  assert.deepEqual(writeTools.map(({ name }) => name).sort(), [
    "collections_edit",
    "elixir_nickname",
    "elixir_send_feedback",
    "elixir_track_clan",
    "elixir_track_player",
  ]);

  for (const [index, tool] of readTools.entries()) {
    const response = await handler({
      ...event({
        path: "/mcp",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 100 + index,
          method: "tools/call",
          params: { name: tool.name, arguments: {} },
        }),
      }),
      headers: { authorization: `Bearer ${refreshedTokens.access_token}` },
    });
    assert.equal(
      response.statusCode,
      200,
      `${tool.name} is available under cr:read: ${response.body}`,
    );
  }

  const rateBeforeRefusal = await db.query(
    `select count from rate_limit where bucket like 'mcp#%' order by window_start desc limit 1`,
  );
  const requiredScopes = {
    collections_edit: "collections:write",
    elixir_track_clan: "recordings:write",
    elixir_track_player: "recordings:write",
    elixir_send_feedback: "feedback:write",
    elixir_identify: "account:write",
    elixir_nickname: "account:write",
  };
  for (const [index, tool] of writeTools.entries()) {
    const response = await handler({
      ...event({
        path: "/mcp",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 200 + index,
          method: "tools/call",
          params: { name: tool.name, arguments: {} },
        }),
      }),
      headers: { authorization: `Bearer ${refreshedTokens.access_token}` },
    });
    assert.equal(response.statusCode, 403, tool.name);
    assert.match(
      response.headers["www-authenticate"],
      /error="insufficient_scope"/,
    );
    assert.match(
      response.headers["www-authenticate"],
      new RegExp(`scope="cr:read ${requiredScopes[tool.name]}"`),
    );
    const refusal = JSON.parse(response.body).error;
    assert.equal(refusal.data.required_scope, requiredScopes[tool.name]);
    assert.equal(refusal.data.granted_scope, "cr:read");
    assert.match(
      refusal.data.hint,
      /Reconnect/,
      "a refusal says how to fix it",
    );
  }
  const rateAfterRefusal = await db.query(
    `select count from rate_limit where bucket like 'mcp#%' order by window_start desc limit 1`,
  );
  assert.equal(
    rateAfterRefusal.rows[0].count,
    rateBeforeRefusal.rows[0].count,
    "scope refusal spends no hourly allowance",
  );

  const elevated = await mintTokens(db, {
    clientId: client_id,
    accountId: ctx.accountId,
    scope: "cr:read feedback:write",
    resource: RESOURCE,
  });
  const allowedWrite = await handler({
    ...event({
      path: "/mcp",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "elixir_send_feedback",
          arguments: { message: "authorized scope regression" },
        },
      }),
    }),
    headers: { authorization: `Bearer ${elevated.accessToken}` },
  });
  assert.equal(allowedWrite.statusCode, 200, allowedWrite.body);
});

test("authorize rejects missing or wrong resource indicators", async () => {
  const reg = await handler(
    event({
      path: "/oauth/register",
      body: JSON.stringify({
        client_name: "Audience test",
        redirect_uris: [REDIRECT],
      }),
    }),
  );
  const { client_id } = JSON.parse(reg.body);
  const base = {
    client_id,
    redirect_uri: REDIRECT,
    code_challenge: crypto
      .createHash("sha256")
      .update("r".repeat(43))
      .digest("base64url"),
    code_challenge_method: "S256",
    scope: "cr:read",
  };
  for (const resource of [undefined, "https://other.example/mcp"]) {
    const response = await handler(
      event({
        method: "GET",
        path: "/oauth/authorize",
        query: { ...base, ...(resource ? { resource } : {}) },
      }),
    );
    assert.equal(response.statusCode, 400);
    assert.match(response.body, /invalid_target/);
  }
});

test("consent enumerates every requested mutation capability", async () => {
  const reg = await handler(
    event({
      path: "/oauth/register",
      body: JSON.stringify({
        client_name: "Full client",
        redirect_uris: [REDIRECT],
      }),
    }),
  );
  const { client_id } = JSON.parse(reg.body);
  const response = await handler(
    event({
      path: "/oauth/authorize",
      form: {
        step: "email",
        email: EMAIL,
        client_id,
        redirect_uri: REDIRECT,
        code_challenge: crypto
          .createHash("sha256")
          .update("s".repeat(43))
          .digest("base64url"),
        code_challenge_method: "S256",
        scope:
          "feedback:write account:write cr:read collections:write recordings:write",
        resource: RESOURCE,
      },
    }),
  );
  assert.equal(response.statusCode, 200);
  for (const title of [
    "Read recorded game data",
    "Change what you track",
    "Edit collections",
    "Update account preferences",
    "Send feedback",
  ]) {
    assert.match(response.body, new RegExp(title));
  }
});

test("unapproved emails get the identical page and no email — never an oracle", async () => {
  const reg = await handler(
    event({
      path: "/oauth/register",
      body: JSON.stringify({ client_name: "X", redirect_uris: [REDIRECT] }),
    }),
  );
  const { client_id } = JSON.parse(reg.body);
  const challenge = crypto
    .createHash("sha256")
    .update("v".repeat(43))
    .digest("base64url");
  const q = {
    client_id,
    redirect_uri: REDIRECT,
    state: "",
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "",
    resource: RESOURCE,
  };
  const before = sentEmails.length;
  const res = await handler(
    event({
      path: "/oauth/authorize",
      form: { step: "email", email: "stranger@example.com", ...q },
    }),
  );
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /If your account is approved/);
  assert.equal(sentEmails.length, before, "nothing sent");
});

test("authorize rejects unregistered redirect_uri and bad challenge", async () => {
  const reg = await handler(
    event({
      path: "/oauth/register",
      body: JSON.stringify({ client_name: "Y", redirect_uris: [REDIRECT] }),
    }),
  );
  const { client_id } = JSON.parse(reg.body);
  const bad = await handler(
    event({
      method: "GET",
      path: "/oauth/authorize",
      query: {
        client_id,
        redirect_uri: "https://evil.example/cb",
        code_challenge: "x",
        code_challenge_method: "S256",
      },
    }),
  );
  assert.equal(bad.statusCode, 400);
  assert.match(bad.body, /not registered/);
});

test("DCR validates redirect uris and rate-limits per IP", async () => {
  const bad = await handler(
    event({
      path: "/oauth/register",
      body: JSON.stringify({
        client_name: "Z",
        redirect_uris: ["http://evil.example/cb"],
      }),
    }),
  );
  assert.equal(bad.statusCode, 400);
  let limited = 0;
  for (let i = 0; i < 25; i += 1) {
    const r = await handler(
      event({
        path: "/oauth/register",
        ip: "4.4.4.4",
        body: JSON.stringify({ client_name: "Q", redirect_uris: [REDIRECT] }),
      }),
    );
    if (r.statusCode === 429) limited += 1;
  }
  assert.equal(limited, 5, "20 an hour per caller");
  // Keyed on the viewer, not the edge node every caller shares.
  const other = await handler(
    event({
      path: "/oauth/register",
      ip: "5.5.5.5",
      body: JSON.stringify({ client_name: "R", redirect_uris: [REDIRECT] }),
    }),
  );
  assert.equal(other.statusCode, 201);
});

test("base64-encoded form bodies (API Gateway v2 reality) parse correctly", async () => {
  const reg = await handler(
    event({
      path: "/oauth/register",
      body: JSON.stringify({ client_name: "B64", redirect_uris: [REDIRECT] }),
    }),
  );
  const { client_id } = JSON.parse(reg.body);
  const challenge = crypto
    .createHash("sha256")
    .update("w".repeat(43))
    .digest("base64url");
  const form = new URLSearchParams({
    step: "email",
    email: "nobody@example.com",
    client_id,
    redirect_uri: REDIRECT,
    state: "",
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "",
    resource: RESOURCE,
  }).toString();
  const res = await handler({
    rawPath: "/oauth/authorize",
    requestContext: { http: { method: "POST", sourceIp: "7.7.7.7" } },
    headers: {},
    body: Buffer.from(form).toString("base64"),
    isBase64Encoded: true,
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.match(
    res.body,
    /If your account is approved/,
    "client_id resolved from decoded body",
  );
});

/**
 * Refusals have to leave a record, and the record has to NAME the credential
 * when it can.
 *
 * A rejected key never reaches mcp_call_audit — the invoker writes after
 * authentication — so a runtime presenting a revoked key produced silence, and
 * its owner saw an agent that merely looked idle. With five agents and three
 * AI tools on one account, "something went quiet" is not a diagnosis.
 */
test("a revoked key being presented is recorded, named, and counted", async () => {
  const { rows: acct } = await db.query(
    `insert into account (email_hash, status, role, kind)
     values ('refusal-owner', 'approved', 'leader', 'person') returning account_id`,
  );
  const accountId = acct[0].account_id;
  const raw = "svt_a_key_that_was_revoked";
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  const { rows: tok } = await db.query(
    `insert into service_token (account_id, name, token_hash, revoked_at)
     values ($1, 'retired-bot', $2, now()) returning token_id`,
    [accountId, hash],
  );

  const call = () =>
    handler({
      rawPath: "/mcp",
      requestContext: { http: { method: "POST", sourceIp: "1.1.1.1" } },
      headers: {
        authorization: `Bearer ${raw}`,
        "cloudfront-viewer-address": "203.0.113.7:51899",
        "cloudfront-viewer-country": "US",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });

  assert.equal(
    (await call()).statusCode,
    401,
    "a revoked key is still refused",
  );
  await call();

  const { rows } = await db.query(
    `select token_id, account_id, kind, reason, attempts, viewer_ip, viewer_country
     from credential_refusal where credential_hash = $1`,
    [hash],
  );
  assert.equal(rows.length, 1, "coalesced per credential per source per day");
  const row = rows[0];
  assert.equal(row.attempts, 2, "counted, not logged twice");
  assert.equal(String(row.token_id), String(tok[0].token_id), "named");
  assert.equal(row.account_id, accountId, "and attributed to its owner");
  assert.equal(row.kind, "service_token");
  assert.equal(row.reason, "revoked_key", "which is the actionable part");
  assert.equal(row.viewer_ip, "203.0.113.7", "the viewer, not the edge node");
  assert.equal(row.viewer_country, "US");
});

test("a key that names nobody is refused and not written down (review §6.5)", async () => {
  const raw = "svt_never_issued_by_anyone";
  const response = await handler({
    rawPath: "/mcp",
    requestContext: { http: { method: "POST", sourceIp: "1.1.1.1" } },
    headers: { authorization: `Bearer ${raw}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
  });
  assert.equal(response.statusCode, 401);
  const { rows } = await db.query(
    `select 1 from credential_refusal where credential_hash = $1`,
    [crypto.createHash("sha256").update(raw).digest("hex")],
  );
  assert.equal(rows.length, 0, "no owner to tell, so no row");
});

// A refused OAuth token used to come back 500: the describer selected
// account_id and client_id from oauth_token, which has neither column.
// Live repro 2026-09-09 - eat_ garbage -> 500, svt_ garbage -> 401.
test("an unknown OAuth access token is refused with 401 and a challenge, never 500", async () => {
  const raw = "eat_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const response = await handler({
    rawPath: "/mcp",
    requestContext: { http: { method: "POST", sourceIp: "1.1.1.1" } },
    headers: { authorization: `Bearer ${raw}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
  });
  assert.equal(response.statusCode, 401, response.body);
  assert.match(
    response.headers["www-authenticate"],
    /^Bearer resource_metadata=/,
  );
  assert.match(
    response.headers["www-authenticate"],
    /scope="cr:read recordings:write collections:write account:write feedback:write"/,
  );
  const { rows } = await db.query(
    `select 1 from credential_refusal where credential_hash = $1`,
    [crypto.createHash("sha256").update(raw).digest("hex")],
  );
  assert.equal(rows.length, 0, "names nobody, so not written down");
});

test("an expired OAuth access token is refused with 401 and attributed to its family's account", async () => {
  const { rows: acct } = await db.query(
    `insert into account (email_hash, status, role, kind)
     values ('expired-oauth-owner', 'approved', 'member', 'person') returning account_id`,
  );
  const accountId = acct[0].account_id;
  await db.query(
    `insert into oauth_client (client_id, client_name, redirect_uris, expires_at)
     values ('expired-client', 'Stale Client', '{}', now() + interval '1 day')`,
  );
  const minted = await mintTokens(db, {
    clientId: "expired-client",
    accountId,
    scope: "cr:read",
    resource: RESOURCE,
  });
  const hash = crypto
    .createHash("sha256")
    .update(minted.accessToken)
    .digest("hex");
  await db.query(
    `update oauth_token set expires_at = now() - interval '1 hour' where token_hash = $1`,
    [hash],
  );
  const response = await handler({
    rawPath: "/mcp",
    requestContext: { http: { method: "POST", sourceIp: "1.1.1.1" } },
    headers: { authorization: `Bearer ${minted.accessToken}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
  });
  assert.equal(response.statusCode, 401, response.body);
  assert.match(
    response.headers["www-authenticate"],
    /^Bearer resource_metadata=/,
  );
  const { rows } = await db.query(
    `select account_id, kind, reason from credential_refusal where credential_hash = $1`,
    [hash],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "access_token");
  assert.equal(rows[0].reason, "expired", "the actionable part");
  assert.equal(rows[0].account_id, accountId, "attributed through the family");
});

// A direct execute-api hit could forge cloudfront-viewer-address and poison
// viewer_ip in mcp_call_audit / credential_refusal. With a secret set, the
// door answers only requests CloudFront stamped.
test("with an origin secret set, the MCP door refuses requests that did not come through CloudFront", async () => {
  const gated = makeHandler({
    databaseUrl: DB_URL,
    issuer: ISSUER,
    sendLoginEmail: async () => {},
    originSecret: "s3cret-origin",
  });
  const req = (headers) => ({
    rawPath: "/mcp",
    requestContext: { http: { method: "POST", sourceIp: "1.1.1.1" } },
    headers: { authorization: "Bearer svt_nope", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
  });
  assert.equal((await gated(req({}))).statusCode, 403, "no header");
  assert.equal(
    (await gated(req({ "x-elixir-origin": "wrong" }))).statusCode,
    403,
    "wrong header",
  );
  assert.equal(
    (await gated(req({ "x-elixir-origin": "s3cret-origin" }))).statusCode,
    401,
    "through CloudFront: the door itself answers (here, refusing the bearer)",
  );
  // The metadata documents are gated too: nothing at this origin is public.
  const meta = await gated({
    rawPath: "/.well-known/oauth-authorization-server",
    requestContext: { http: { method: "GET" } },
    headers: {},
  });
  assert.equal(meta.statusCode, 403);
  // Unset (local development, every other test here): the check is off.
  assert.equal((await handler(req({}))).statusCode, 401);
});

/**
 * The consent page is where a human widens a grant.
 *
 * Scope arrives in the client's ?scope= parameter and the
 * protected-resource challenge advertises cr:read only, so a client that
 * never asks for feedback:write can never obtain it - while the
 * insufficient_scope refusal told people to grant exactly that "on the
 * consent page", which had no such control. Reported by the account owner,
 * 2026-09-09: "I don't see any part where I can select scopes."
 */
async function consentFlow({
  grants = [],
  scope = "cr:read",
  redirect = REDIRECT,
  resource = RESOURCE,
  clientSecret,
  secretHash,
} = {}) {
  // A family redirect cannot be registered at /oauth/register: family
  // apps are provisioned by the migrate op (0185).
  const family = FIRST_PARTY_ORIGINS.includes(new URL(redirect).origin);
  const client_id = family
    ? (
        await familyClientsOn(db, {
          provision: {
            app: `app-${++provisioned}`,
            client_name: "Scope Tester",
            redirect_uris: [redirect],
          },
        })
      ).provisioned.client_id
    : JSON.parse(
        (
          await handler(
            event({
              path: "/oauth/register",
              body: JSON.stringify({
                client_name: "Scope Tester",
                redirect_uris: [redirect],
              }),
            }),
          )
        ).body,
      ).client_id;
  if (secretHash)
    await familyClientsOn(db, {
      set_secret: { app: `app-${provisioned}`, secret_hash: secretHash },
    });
  // Every flow here signs in the same address; its hourly mail allowance
  // belongs to the tests that measure it.
  await db.query(
    `delete from rate_limit where bucket like 'auth#%' or bucket like 'oauthmail#%'`,
  );
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  const q = {
    client_id,
    redirect_uri: redirect,
    state: "sc0pe",
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope,
    resource,
  };
  sentEmails.length = 0;
  const emailStep = await handler(
    event({
      path: "/oauth/authorize",
      form: { step: "email", email: EMAIL, ...q },
    }),
  );
  const { code } = sentEmails[0];
  // Repeated fields need a raw body: URLSearchParams from an object cannot
  // carry the same key twice, which is exactly how checkboxes post.
  const body = new URLSearchParams({
    step: "code",
    confirm: "1",
    email: EMAIL,
    code,
    ...q,
  });
  for (const g of grants) body.append("grant", g);
  const codeStep = await handler(
    event({ path: "/oauth/authorize", body: body.toString() }),
  );
  assert.equal(codeStep.statusCode, 303, codeStep.body?.slice(0, 300));
  const authCode = new URL(codeStep.headers.location).searchParams.get("code");
  const tokenRes = await handler(
    event({
      path: "/oauth/token",
      form: {
        grant_type: "authorization_code",
        code: authCode,
        code_verifier: verifier,
        client_id,
        redirect_uri: redirect,
        resource,
        ...(clientSecret ? { client_secret: clientSecret } : {}),
      },
    }),
  );
  return {
    emailStep,
    tokenRes,
    tokens: JSON.parse(tokenRes.body),
    client_id,
  };
}

test("userinfo answers a family app's JSON API grant as it does an MCP one", async () => {
  const { tokens } = await consentFlow({
    scope: "cr:read account:email",
    redirect: "https://drop.poapkings.com/auth/elixir/callback",
    resource: `${ISSUER}/api/v1`,
  });
  assert.equal(tokens.scope, "cr:read account:email");
  const answer = await handler(
    event({
      method: "GET",
      path: "/oauth/userinfo",
      headers: { authorization: `Bearer ${tokens.access_token}` },
    }),
  );
  assert.equal(answer.statusCode, 200, answer.body);
  const info = JSON.parse(answer.body);
  assert.equal(info.email, EMAIL);
  assert.equal(info.kind, "person");
  const junk = await handler(
    event({
      method: "GET",
      path: "/oauth/userinfo",
      headers: { authorization: "Bearer not-a-token" },
    }),
  );
  assert.equal(junk.statusCode, 401);
});

test("ticking a capability the client never asked for grants it", async () => {
  const { emailStep, tokens } = await consentFlow({
    grants: ["feedback:write"],
  });
  assert.match(
    emailStep.body,
    /name="grant" value="feedback:write"/,
    "the control the refusal message points at must exist",
  );
  assert.equal(
    tokens.scope,
    "cr:read feedback:write",
    "the human added a capability the client could not request",
  );
  // RFC 6749 section 3.3: a scope different from the request must be
  // reported back, so the client learns what it actually holds.
  const ctx = await validateAccessToken(db, tokens.access_token, {
    resource: RESOURCE,
  });
  assert.ok(ctx.scopes.includes("feedback:write"));
});

test("ticking nothing leaves the grant exactly as the client asked", async () => {
  const { tokens } = await consentFlow();
  assert.equal(tokens.scope, "cr:read", "no silent widening");
});

test("a grant value this server does not define is ignored, not granted", async () => {
  const { tokens } = await consentFlow({
    grants: ["feedback:write", "admin:everything", "../../etc/passwd"],
  });
  assert.equal(
    tokens.scope,
    "cr:read feedback:write",
    "only capabilities in the server's own list survive the form",
  );
});

test("account:email is never offered unasked, and a token without it cannot read userinfo", async () => {
  const { emailStep, tokens } = await consentFlow({
    grants: ["account:email"],
  });
  assert.doesNotMatch(
    emailStep.body,
    /name="grant" value="account:email"/,
    "the email capability is not a checkbox a client can be handed",
  );
  assert.equal(tokens.scope, "cr:read", "posting it as a grant is ignored");
  const refused = await handler(
    event({
      method: "GET",
      path: "/oauth/userinfo",
      headers: { authorization: `Bearer ${tokens.access_token}` },
    }),
  );
  assert.equal(refused.statusCode, 403);
  assert.match(refused.headers["www-authenticate"], /insufficient_scope/);
  assert.match(refused.headers["www-authenticate"], /account:email/);
});

test("any other client asking for account:email is refused at authorize: the address goes to the family's own apps only (2026-09-25)", async () => {
  const reg = await handler(
    event({
      path: "/oauth/register",
      body: JSON.stringify({
        client_name: "Someone's app",
        redirect_uris: [REDIRECT],
      }),
    }),
  );
  const { client_id } = JSON.parse(reg.body);
  const refused = await handler(
    event({
      method: "GET",
      path: "/oauth/authorize",
      query: {
        response_type: "code",
        client_id,
        redirect_uri: REDIRECT,
        state: "x",
        code_challenge: "a".repeat(43),
        code_challenge_method: "S256",
        scope: "cr:read account:email",
        resource: RESOURCE,
      },
    }),
  );
  assert.equal(refused.statusCode, 400);
  assert.match(refused.body, /offered only to the Elixir family/);
});

test("clans:attest is the family's too: refused to any other app, shown to a family app that names it (JSON API 2.2.0)", async () => {
  const reg = await handler(
    event({
      path: "/oauth/register",
      body: JSON.stringify({
        client_name: "Another app",
        redirect_uris: [REDIRECT],
      }),
    }),
  );
  const { client_id } = JSON.parse(reg.body);
  const refused = await handler(
    event({
      method: "GET",
      path: "/oauth/authorize",
      query: {
        response_type: "code",
        client_id,
        redirect_uri: REDIRECT,
        state: "x",
        code_challenge: "a".repeat(43),
        code_challenge_method: "S256",
        scope: "cr:read clans:attest",
        resource: RESOURCE,
      },
    }),
  );
  assert.equal(refused.statusCode, 400);
  assert.match(
    refused.body,
    /clans:attest is offered only to the Elixir family/,
  );
  const { emailStep, tokens } = await consentFlow({
    scope: "cr:read clans:attest",
    redirect: "https://clan.poapkings.com/auth/callback",
  });
  assert.match(emailStep.body, /Record what you do in your clan/);
  assert.equal(tokens.scope, "cr:read clans:attest");
});

test("a family app that asks for account:email is shown it, and userinfo answers the address the code proved", async () => {
  const { emailStep, tokens } = await consentFlow({
    scope: "cr:read account:email",
    redirect: "https://drop.poapkings.com/auth/elixir/callback",
  });
  assert.match(emailStep.body, /Know your email address/);
  assert.equal(tokens.scope, "cr:read account:email");
  const answer = await handler(
    event({
      method: "GET",
      path: "/oauth/userinfo",
      headers: { authorization: `Bearer ${tokens.access_token}` },
    }),
  );
  assert.equal(answer.statusCode, 200);
  const info = JSON.parse(answer.body);
  assert.equal(info.email, EMAIL);
  assert.equal(info.email_verified, true);
  assert.equal(info.kind, "person");
  const {
    rows: [row],
  } = await db.query(
    `select account_id, email from account where email_hash = $1`,
    [emailHash(EMAIL)],
  );
  assert.equal(info.sub, row.account_id, "sub is the stable account id");
  assert.equal(row.email, EMAIL, "consent recorded the address");
  assert.equal(answer.headers["cache-control"], "no-store");

  const anon = await handler(event({ method: "GET", path: "/oauth/userinfo" }));
  assert.equal(anon.statusCode, 401);
  const discovery = JSON.parse(
    (
      await handler(
        event({
          method: "GET",
          path: "/.well-known/oauth-authorization-server",
        }),
      )
    ).body,
  );
  assert.equal(discovery.userinfo_endpoint, `${ISSUER}/oauth/userinfo`);
  assert.ok(discovery.scopes_supported.includes("account:email"));
});

/* ---- door hardening (review §6.5) ---- */

const sha = (v) => crypto.createHash("sha256").update(v).digest("hex");
const register = (body, ip) =>
  handler(event({ path: "/oauth/register", ip, body: JSON.stringify(body) }));
const authorizeGet = (client_id, redirect, scope = "cr:read") =>
  handler(
    event({
      method: "GET",
      path: "/oauth/authorize",
      query: {
        response_type: "code",
        client_id,
        redirect_uri: redirect,
        state: "x",
        code_challenge: "a".repeat(43),
        code_challenge_method: "S256",
        scope,
        resource: RESOURCE,
      },
    }),
  );

test("registration refuses a family redirect and a name that borrows the family's", async () => {
  for (const [i, uris] of [
    ["https://clan.poapkings.com/auth/callback"],
    [REDIRECT, "https://drop.poapkings.com/auth/elixir/callback"],
    ["https://elixir.poapkings.com/cb"],
  ].entries()) {
    const r = await register(
      { client_name: "Ordinary", redirect_uris: uris },
      `6.6.6.${i}`,
    );
    assert.equal(r.statusCode, 400, uris.join());
    assert.equal(JSON.parse(r.body).error, "invalid_redirect_uri");
  }
  for (const [i, name] of [
    "Elixir Clan",
    "elixir",
    "ＥＬＩＸＩＲ Drop",
    " Poap-Kings helper",
    "E.L.I.X.I.R",
  ].entries()) {
    const r = await register(
      { client_name: name, redirect_uris: [REDIRECT] },
      `6.6.7.${i}`,
    );
    assert.equal(r.statusCode, 400, name);
    assert.equal(JSON.parse(r.body).error, "invalid_client_metadata");
  }
  const fine = await register(
    { client_name: "Claude Code (elixir-mcp)", redirect_uris: [REDIRECT] },
    "6.6.8.1",
  );
  assert.equal(fine.statusCode, 201);
});

test("a client registered to family origins before provisioning is not first-party", async () => {
  await db.query(
    `insert into oauth_client (client_id, client_name, redirect_uris, expires_at)
     values ('legacy-family-redirect', 'Old Clan', $1, now() + interval '1 day')`,
    [["https://clan.poapkings.com/auth/callback"]],
  );
  const refused = await authorizeGet(
    "legacy-family-redirect",
    "https://clan.poapkings.com/auth/callback",
    "cr:read account:email",
  );
  assert.equal(refused.statusCode, 400);
  assert.match(refused.body, /offered only to the Elixir family/);
  const plain = await authorizeGet(
    "legacy-family-redirect",
    "https://clan.poapkings.com/auth/callback",
  );
  assert.equal(plain.statusCode, 200);
  assert.match(plain.body, /named itself; Elixir has not checked it/);
  assert.match(plain.body, /clan\.poapkings\.com/);
});

test("the consent page names where the code goes", async () => {
  const reg = JSON.parse(
    (
      await register(
        { client_name: "Friendly Name", redirect_uris: [REDIRECT] },
        "6.6.9.1",
      )
    ).body,
  );
  const shown = await authorizeGet(reg.client_id, REDIRECT);
  assert.equal(shown.statusCode, 200);
  assert.match(shown.body, /sends a code to <strong>claude\.ai<\/strong>/);
  const { emailStep } = await consentFlow({
    redirect: "https://clan.poapkings.com/auth/callback",
  });
  assert.match(emailStep.body, /one of Elixir&rsquo;s own apps/);
});

test("a family client's secret: checked when sent, stamped, then required", async () => {
  const redirect = "https://clan.poapkings.com/auth/callback";
  const wrong = await consentFlow({
    redirect,
    secretHash: sha("right-secret"),
    clientSecret: "wrong-secret",
  });
  assert.equal(wrong.tokenRes.statusCode, 401);
  assert.equal(wrong.tokens.error, "invalid_client");

  // Not yet required: an app that does not send it yet keeps working.
  const missing = await consentFlow({
    redirect,
    secretHash: sha("right-secret"),
  });
  assert.equal(missing.tokenRes.statusCode, 200);
  const app = `app-${provisioned}`;
  await assert.rejects(
    familyClientsOn(db, { require_secret: { app } }),
    /has not authenticated with its secret yet/,
  );

  const right = await consentFlow({
    redirect,
    secretHash: sha("right-secret"),
    clientSecret: "right-secret",
  });
  assert.equal(right.tokenRes.statusCode, 200, right.tokenRes.body);
  const rightApp = `app-${provisioned}`;
  const {
    rows: [stamped],
  } = await db.query(
    `select last_authenticated_at from family_oauth_client where app = $1`,
    [rightApp],
  );
  assert.ok(stamped.last_authenticated_at, "the app is sending it");
  await familyClientsOn(db, { require_secret: { app: rightApp } });

  const refresh = (secret) =>
    handler(
      event({
        path: "/oauth/token",
        form: {
          grant_type: "refresh_token",
          refresh_token: right.tokens.refresh_token,
          client_id: right.client_id,
          resource: RESOURCE,
          ...(secret ? { client_secret: secret } : {}),
        },
      }),
    );
  const without = await refresh();
  assert.equal(without.statusCode, 401, "required now");
  assert.equal(JSON.parse(without.body).error, "invalid_client");
  const withIt = await refresh("right-secret");
  assert.equal(withIt.statusCode, 200, withIt.body);

  // A public client's stray secret is ignored, as before.
  const pub = await consentFlow({ clientSecret: "anything" });
  assert.equal(pub.tokenRes.statusCode, 200);
});

test("RFC 7009 revocation ends the grant for the client that holds it, and only that client", async () => {
  const { tokens, client_id } = await consentFlow();
  const mcp = () =>
    handler(
      event({
        path: "/mcp",
        headers: { authorization: `Bearer ${tokens.access_token}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      }),
    );
  assert.equal((await mcp()).statusCode, 200);

  const other = JSON.parse(
    (
      await register(
        { client_name: "Someone Else", redirect_uris: [REDIRECT] },
        "6.6.10.1",
      )
    ).body,
  );
  const foreign = await handler(
    event({
      path: "/oauth/revoke",
      form: { client_id: other.client_id, token: tokens.refresh_token },
    }),
  );
  assert.equal(foreign.statusCode, 200, "RFC 7009: answered alike");
  assert.equal((await mcp()).statusCode, 200, "but nothing was revoked");

  const unknown = await handler(
    event({
      path: "/oauth/revoke",
      form: { client_id: "no-such-client", token: tokens.refresh_token },
    }),
  );
  assert.equal(unknown.statusCode, 401);

  const done = await handler(
    event({
      path: "/oauth/revoke",
      form: { client_id, token: tokens.refresh_token },
    }),
  );
  assert.equal(done.statusCode, 200);
  assert.equal((await mcp()).statusCode, 401, "the access token went too");
  const again = await handler(
    event({
      path: "/oauth/token",
      form: {
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        client_id,
        resource: RESOURCE,
      },
    }),
  );
  assert.notEqual(again.statusCode, 200);
  const { rows } = await db.query(
    `select detail from account_event
      where kind = 'connection_revoked' and detail->>'by' = 'client'`,
  );
  assert.equal(rows.length, 1);
});

test("codes to one address are capped across callers, shared with the site's sign-in", async () => {
  const reg = JSON.parse(
    (
      await register(
        { client_name: "Mail Tester", redirect_uris: [REDIRECT] },
        "6.6.11.1",
      )
    ).body,
  );
  await db.query(`delete from rate_limit where bucket like 'auth#%'`);
  sentEmails.length = 0;
  for (let i = 0; i < 7; i += 1)
    await handler(
      event({
        path: "/oauth/authorize",
        ip: `7.7.7.${i}`,
        form: {
          step: "email",
          email: EMAIL,
          client_id: reg.client_id,
          redirect_uri: REDIRECT,
          state: "m",
          code_challenge: "a".repeat(43),
          code_challenge_method: "S256",
          scope: "cr:read",
          resource: RESOURCE,
        },
      }),
    );
  assert.equal(sentEmails.length, 5, "five an hour to one inbox");
  assert.equal(
    await signinMailAllowed(db, emailHash(EMAIL)),
    false,
    "and the site's sign-in reads the same allowance",
  );
  await db.query(`delete from rate_limit where bucket like 'auth#%'`);
});

test("family_clients op: provisions only family redirects, lists the audit, retires registered clients", async () => {
  await assert.rejects(
    familyClientsOn(db, {
      provision: { app: "rogue", redirect_uris: [REDIRECT] },
    }),
    /all on family origins/,
  );
  const listed = await familyClientsOn(db, { list: true });
  assert.ok(listed.provisioned.length >= 1);
  const legacy = listed.registered_to_family_origins.find(
    (r) => r.client_id === "legacy-family-redirect",
  );
  assert.ok(legacy, "the pre-0185 family-redirect client is in the audit");
  assert.equal(legacy.all_family, true);
  assert.ok(
    !listed.registered_to_family_origins.some((r) =>
      listed.provisioned.some((p) => p.client_id === r.client_id),
    ),
    "a provisioned client is not in the audit",
  );

  const out = await familyClientsOn(db, {
    revoke_clients: ["legacy-family-redirect", listed.provisioned[0].client_id],
    reason: "test",
  });
  assert.equal(out.revoked[0].expired, true);
  assert.equal(out.revoked[1].refused, "provisioned");
  const gone = await authorizeGet(
    "legacy-family-redirect",
    "https://clan.poapkings.com/auth/callback",
  );
  assert.match(gone.body, /unknown client_id/);
});
