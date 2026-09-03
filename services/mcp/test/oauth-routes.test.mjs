import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import { emailHash, validateAccessToken } from "../../auth/src/index.mjs";
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

let db;
let handler;
const sentEmails = [];

function event({
  method = "POST",
  path: p = "/",
  query,
  body,
  form,
  ip = "9.9.9.9",
}) {
  return {
    rawPath: p,
    requestContext: { http: { method, sourceIp: ip } },
    queryStringParameters: query,
    headers: {},
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
  assert.deepEqual(meta.token_endpoint_auth_methods_supported, ["none"]);
  const pr = await handler(
    event({ method: "GET", path: "/.well-known/oauth-protected-resource" }),
  );
  const prMeta = JSON.parse(pr.body);
  assert.equal(prMeta.resource, `${ISSUER}/mcp`);
  assert.deepEqual(prMeta.authorization_servers, [ISSUER]);
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
  assert.equal(sentEmails.length, 1);
  const { code: loginCode } = sentEmails[0];

  const codeStep = await handler(
    event({
      path: "/oauth/authorize",
      form: { step: "code", email: EMAIL, code: loginCode, ...authQuery },
    }),
  );
  assert.equal(codeStep.statusCode, 303);
  const redirect = new URL(codeStep.headers.location);
  assert.equal(redirect.origin + redirect.pathname, REDIRECT);
  assert.equal(redirect.searchParams.get("state"), "st4te");
  assert.equal(redirect.searchParams.get("iss"), ISSUER, "RFC 9207");
  const authCode = redirect.searchParams.get("code");
  assert.match(authCode, /^eac_/);

  const token = await handler(
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
  assert.equal(token.statusCode, 200);
  const tokens = JSON.parse(token.body);
  assert.match(tokens.access_token, /^eat_/);
  assert.match(tokens.refresh_token, /^ert_/);

  const ctx = await validateAccessToken(db, tokens.access_token);
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
      },
    }),
  );
  assert.equal(
    JSON.parse(bad.body).error,
    "invalid_grant",
    "auth code is single-use",
  );

  const refreshed = await handler(
    event({
      path: "/oauth/token",
      form: {
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        client_id,
      },
    }),
  );
  assert.equal(refreshed.statusCode, 200);
  assert.match(JSON.parse(refreshed.body).access_token, /^eat_/);
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
  assert.ok(limited > 0, "per-IP DCR cap engages");
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
