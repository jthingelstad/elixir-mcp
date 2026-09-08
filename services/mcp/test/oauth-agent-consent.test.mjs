/**
 * Consenting to act AS an agent (0054 + consent flow).
 *
 * Signing in as yourself and connecting a client as your agent are different
 * acts with different consequences, and the second one is only yours to perform
 * for a principal you own. The failures here are the kind that do not announce
 * themselves: consenting for somebody else's agent, or a grant that
 * authenticates the person but carries the agent's authority (or the reverse).
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import { emailHash } from "../../auth/src/index.mjs";
import { createPrincipal } from "@elixir-mcp/claims";
import { makeHandler } from "../src/handler.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_consent_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);
const ISSUER = "https://elixir.poapkings.com";
const OWNER = "owner@example.com";
const STRANGER = "stranger@example.com";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

let db;
let handler;
let clientId;
let agentPublicId;
const sentEmails = [];

const event = ({
  method = "POST",
  path: p = "/",
  query,
  body,
  form,
  ip = "9.9.9.9",
}) => ({
  rawPath: p,
  requestContext: { http: { method, sourceIp: ip } },
  queryStringParameters: query,
  headers: {},
  body: form ? new URLSearchParams(form).toString() : body,
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

  const mk = async (email, clans = []) => {
    const { rows } = await db.query(
      `insert into account (email_hash, status, role) values ($1, 'approved', 'leader')
       returning account_id, role, kind`,
      [emailHash(email)],
    );
    for (const tag of clans)
      await db.query(
        `insert into account_clan (account_id, clan_tag, scope) values ($1, $2, 'comprehensive')`,
        [rows[0].account_id, tag],
      );
    return {
      accountId: rows[0].account_id,
      role: rows[0].role,
      kind: rows[0].kind,
    };
  };
  const owner = await mk(OWNER, ["#J2RGCRVG"]);
  await mk(STRANGER);

  const made = await createPrincipal(db, owner, {
    kind: "agent",
    name: "poap-kings",
    clanTag: "#J2RGCRVG",
    tokenHash: crypto.createHash("sha256").update("k").digest("hex"),
  });
  agentPublicId = made.principal.public_id;

  handler = makeHandler({
    databaseUrl: DB_URL,
    issuer: ISSUER,
    sendLoginEmail: async (mail) => sentEmails.push(mail),
  });

  const reg = await handler(
    event({
      path: "/oauth/register",
      body: JSON.stringify({
        client_name: "Claude",
        redirect_uris: [REDIRECT],
      }),
    }),
  );
  clientId = JSON.parse(reg.body).client_id;
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

/** Drive the consent flow to the point of redirect (or refusal). */
async function consent(email, resource, ip) {
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  const q = {
    client_id: clientId,
    redirect_uri: REDIRECT,
    scope: "cr:read",
    resource,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "xyz",
  };
  const start = await handler(
    event({
      path: "/oauth/authorize",
      form: { ...q, step: "email", email },
      ip,
    }),
  );
  if (start.statusCode !== 200) return { stage: "start", res: start };
  const mail = sentEmails.at(-1);
  const done = await handler(
    event({
      path: "/oauth/authorize",
      form: { ...q, step: "code", email, code: mail?.code ?? "000000" },
      ip,
    }),
  );
  return { stage: "code", res: done, verifier };
}

test("an owner may connect a client AS their agent", async () => {
  const { res } = await consent(
    OWNER,
    `${ISSUER}/a/${agentPublicId}/mcp`,
    "9.9.9.1",
  );
  assert.equal(res.statusCode, 303, res.body);

  // The grant belongs to the AGENT, not the person who authorised it: that is
  // the whole point, and it is what makes the resulting token carry the agent's
  // tool surface and budget rather than its owner's.
  const { rows } = await db.query(
    `select a.kind, a.public_id from oauth_code c
     join account a on a.account_id = c.account_id
     order by c.created_at desc limit 1`,
  );
  assert.equal(rows[0].kind, "agent");
  assert.equal(rows[0].public_id, agentPublicId);
});

test("a stranger may not connect somebody else's agent", async () => {
  const { res } = await consent(
    STRANGER,
    `${ISSUER}/a/${agentPublicId}/mcp`,
    "9.9.9.2",
  );
  assert.equal(res.statusCode, 403);
  assert.match(res.body, /Not yours to connect/);
});

test("an agent that does not exist refuses identically", async () => {
  // Same refusal as "not yours", so the consent screen cannot be used to
  // discover which agents exist.
  const { res } = await consent(
    OWNER,
    `${ISSUER}/a/deadbeef1234/mcp`,
    "9.9.9.3",
  );
  assert.equal(res.statusCode, 403);
  assert.match(res.body, /Not yours to connect/);
});

test("the personal flow is unchanged", async () => {
  const { res } = await consent(OWNER, `${ISSUER}/mcp`, "9.9.9.4");
  assert.equal(res.statusCode, 303, res.body);
  const { rows } = await db.query(
    `select a.kind from oauth_code c join account a on a.account_id = c.account_id
     order by c.created_at desc limit 1`,
  );
  assert.equal(rows[0].kind, "person");
});

test("an audience off this origin is refused before anything else happens", async () => {
  for (const bad of [
    "https://evil.example.com/mcp",
    `${ISSUER}/a/SHOUTY/mcp`,
    `${ISSUER}/a/${agentPublicId}/mcp/extra`,
  ]) {
    const start = await handler(
      event({
        path: "/oauth/authorize",
        form: {
          client_id: clientId,
          redirect_uri: REDIRECT,
          scope: "cr:read",
          resource: bad,
          code_challenge: "x".repeat(43),
          code_challenge_method: "S256",
          step: "email",
          email: OWNER,
        },
        ip: "9.9.9.5",
      }),
    );
    assert.equal(start.statusCode, 400, bad);
    assert.match(start.body, /invalid_target/);
  }
});

test("the consent screen says which act is being authorised", async () => {
  const screen = async (resource, ip) =>
    (
      await handler(
        event({
          path: "/oauth/authorize",
          form: {
            client_id: clientId,
            redirect_uri: REDIRECT,
            scope: "cr:read",
            resource,
            code_challenge: crypto.randomBytes(32).toString("base64url"),
            code_challenge_method: "S256",
            step: "email",
            email: OWNER,
          },
          ip,
        }),
      )
    ).body;

  const asAgent = await screen(`${ISSUER}/a/${agentPublicId}/mcp`, "9.9.9.6");
  const asSelf = await screen(`${ISSUER}/mcp`, "9.9.9.7");

  // The distinguishing claim, asserted as a difference rather than a phrase:
  // connecting as an agent must not read like connecting as yourself.
  assert.match(asAgent, /as one of your agents, not as you/);
  assert.doesNotMatch(asSelf, /not as you/);
  assert.match(asSelf, /authorizes Claude to/);
  assert.doesNotMatch(asAgent, /authorizes Claude to/);
});
