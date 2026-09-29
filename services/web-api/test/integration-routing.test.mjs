/**
 * /api/v1 against its own contract (review 2026-09-27 §8.5, issue #71).
 *
 * The OpenAPI document says, per operation, which callers it admits
 * (`x-principals`) and by which credential (`security`). The router is
 * hand-written. Nothing checked one against the other, and they had
 * drifted: the clan facts operations admitted integrations (2.6.0) while
 * their `security` still named only a person's grant. This walks every
 * (method, path) in the contract as each kind of caller, with a
 * credential that holds as little as it can: an integration with no
 * permission, and a person's grant with only `cr:read`, the scope every
 * grant carries. A declared caller must reach its operation, read back
 * from the call audit (the operation's name, or the tool it mirrors when
 * the tool ran), and an undeclared one must be refused as not_found. A
 * new operation fails here until it is routed and named.
 *
 * It also pins the error mapping: an unexpected exception is a 500
 * `internal` with no Retry-After, and only a database connection or
 * timeout failure is a 503 the caller should retry.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import contract from "@elixir-mcp/contracts/integration-api.openapi.json" with { type: "json" };
import { migrate } from "../../migrate/src/migrate.mjs";
import { createSession, mintTokens, registerClient } from "@elixir-mcp/auth";
import { makeHandler } from "../src/handler.mjs";
import { integrationApi } from "../src/integration-api.mjs";

const adminUrl =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const name = `elixir_mcp_test_integration_routing_${process.pid}`;
const databaseUrl = adminUrl.replace(/\/postgres$/, `/${name}`);

/** The name each operation is audited under (mcp_call_audit.tool for a
 *  REST call the router answered itself). */
const AUDITED = {
  gameClock: "game.clock",
  playerProfile: "players.read",
  requestProfileRefresh: "profiles.refresh",
  profileRefreshStatus: "profiles.status",
  addCollectionMember: "collections.members.add",
  addCollectionMembers: "collections.members.add",
  me: "me.read",
  clanParticipation: "clans.participation",
  clanRoster: "clans.roster",
  clanWarHistory: "clans.war_history",
  clanLive: "clans.live",
  playerNames: "players.names",
  playerRecordedProfile: "players.profile",
  playerBattles: "players.battles",
  meTrackPlayer: "me.players.add",
  clanFactWrite: "clans.facts.write",
  clanFactRemove: "clans.facts.remove",
  playerFactWrite: "players.facts.write",
  clanMailSend: "clans.mail.send",
};

/** The credential scheme each kind of caller presents. */
const SCHEME = { integration: "integrationKey", person: "personOAuth" };

const operations = Object.entries(contract.paths).flatMap(([p, methods]) =>
  Object.entries(methods).map(([method, op]) => ({
    method: method.toUpperCase(),
    template: p,
    op,
    principals: op["x-principals"] ?? ["integration"],
  })),
);

/** A concrete path for a template: a real-looking tag, id or ref. */
function concrete({ template, op }) {
  return (
    "/api/v1" +
    template
      .replace("{tag}", encodeURIComponent("#2PPQQ"))
      .replace(
        "{id}",
        op.operationId === "profileRefreshStatus"
          ? "00000000-0000-4000-8000-000000000000"
          : "1",
      )
      .replace("{ref}", "some-ref")
  );
}

/** A body that gets each operation past its own shape checks. */
function bodyFor({ op }) {
  if (op.operationId === "playerNames") return { player_tags: ["#2PP"] };
  if (op.operationId === "addCollectionMembers") return { tags: ["#2PP"] };
  return {};
}

let db, handler, integrationToken, personToken;
before(async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();
  await migrate({
    databaseUrl,
    migrationsDir: new URL("../../../db/migrations", import.meta.url).pathname,
  });
  db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  const person = (
    await db.query(
      "insert into account(email_hash,status,role) values ('routing-admin','approved','admin') returning account_id",
    )
  ).rows[0].account_id;
  const session = await createSession(db, {
    secret: "test",
    accountId: person,
    emailHash: "routing-admin",
  });
  handler = makeHandler({ databaseUrl, secret: "test" });
  // An integration holding no permission at all.
  const provisioned = await handler({
    rawPath: "/api/admin/integrations",
    requestContext: { http: { method: "POST" } },
    headers: {
      cookie: `__Host-elixir_session=${session.token}`,
      "x-elixir-client": "web",
    },
    body: JSON.stringify({ name: "routing-none", scopes: [] }),
  });
  assert.equal(provisioned.statusCode, 201, provisioned.body);
  integrationToken = JSON.parse(provisioned.body).token;
  // A person's grant for this door holding only what every grant holds.
  const client = await registerClient(db, {
    clientName: "Routing test",
    redirectUris: ["https://example.org/callback"],
  });
  personToken = (
    await mintTokens(db, {
      clientId: client.clientId,
      accountId: person,
      scope: "cr:read",
      resource: "https://elixir.poapkings.com/api/v1",
    })
  ).accessToken;
});
after(async () => {
  await db?.end();
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database ${name} with (force)`);
  await admin.end();
});

test("every operation in the contract is named here", () => {
  const unnamed = operations
    .map(({ op }) => op.operationId)
    .filter((id) => !AUDITED[id]);
  assert.deepEqual(unnamed, []);
});

test("every operation's security admits exactly the callers it declares", () => {
  for (const { method, template, op, principals } of operations) {
    const schemes = (op.security ?? contract.security).flatMap((s) =>
      Object.keys(s),
    );
    assert.deepEqual(
      [...new Set(schemes)].sort(),
      principals.map((p) => SCHEME[p]).sort(),
      `${method} ${template} (${op.operationId}) declares ${principals.join(", ")}`,
    );
  }
});

for (const route of operations) {
  for (const kind of ["integration", "person"]) {
    const declared = route.principals.includes(kind);
    test(`${route.method} ${route.template} as ${kind}: ${declared ? `routes to ${route.op.operationId}` : "refused"}`, async () => {
      const { rows: mark } = await db.query(
        `select coalesce(max(audit_id), 0) as last from mcp_call_audit`,
      );
      const response = await handler({
        rawPath: concrete(route),
        requestContext: { http: { method: route.method } },
        headers: {
          authorization: `Bearer ${kind === "integration" ? integrationToken : personToken}`,
        },
        body: JSON.stringify(bodyFor(route)),
      });
      const body = JSON.parse(response.body);
      if (!declared) {
        assert.equal(response.statusCode, 404, response.body);
        assert.equal(body.code, "not_found");
        return;
      }
      assert.ok(
        !(response.statusCode === 404 && body.code === "not_found"),
        `routed nowhere: ${response.body}`,
      );
      // One audit row: the operation's own, or the invoker's for the
      // tool it ran (which carries the tool's name and its own id).
      const { rows } = await db.query(
        `select tool from mcp_call_audit where audit_id > $1`,
        [mark[0].last],
      );
      assert.equal(rows.length, 1, response.body);
      assert.ok(
        [AUDITED[route.op.operationId], route.op["x-tool"]].includes(
          rows[0].tool,
        ),
        `${rows[0].tool}: ${response.body}`,
      );
    });
  }
}

/** The real client, with one statement made to fail as `failure` does. */
function failing(failure) {
  return {
    query: (sql, params) =>
      /from integration where account_id/.test(String(sql))
        ? Promise.reject(failure())
        : db.query(sql, params),
  };
}
const clockEvent = () => ({
  rawPath: "/api/v1/game/clock",
  requestContext: { http: { method: "GET" } },
  headers: { authorization: `Bearer ${integrationToken}` },
});

test("an unexpected exception is a 500 internal with no Retry-After, not a 503 to retry", async () => {
  const response = await integrationApi(
    failing(() => new TypeError("cannot read properties of undefined")),
    clockEvent(),
    {},
  );
  assert.equal(response.statusCode, 500, response.body);
  assert.equal(JSON.parse(response.body).code, "internal");
  assert.equal(response.headers["retry-after"], undefined);
});

test("a database connection or timeout failure stays a 503 with Retry-After", async () => {
  for (const failure of [
    () => Object.assign(new Error("terminating connection"), { code: "57P01" }),
    () =>
      Object.assign(new Error("canceling statement due to statement timeout"), {
        code: "57014",
      }),
    () =>
      Object.assign(new Error("connect ECONNREFUSED"), {
        code: "ECONNREFUSED",
      }),
    () => new Error("Connection terminated unexpectedly"),
  ]) {
    const response = await integrationApi(failing(failure), clockEvent(), {});
    assert.equal(response.statusCode, 503, response.body);
    assert.equal(JSON.parse(response.body).code, "temporarily_unavailable");
    assert.equal(response.headers["retry-after"], "5");
  }
});
