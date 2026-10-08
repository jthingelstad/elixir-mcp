import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import {
  createSession,
  issueServiceToken,
  validateServiceToken,
  mintServiceTokenValue,
  mintTokens,
  registerClient,
  validateAccessToken,
} from "@elixir-mcp/auth";
import { ensureSeasonsAround } from "@elixir-mcp/record/season";
import { projectRiverRaceLog } from "../../../packages/ingest/src/war.mjs";
import { makeHandler } from "../src/handler.mjs";

// A family app's client is provisioned (0185), never merely registered to
// a family redirect: registration is open and proves nothing.
let familyApps = 0;
async function familyClient(db, spec) {
  const c = await registerClient(db, spec);
  await db.query(
    `insert into family_oauth_client (client_id, app) values ($1, $2)`,
    [c.clientId, `test-app-${++familyApps}`],
  );
  return c;
}
const adminUrl =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const name = `elixir_mcp_test_integrations_${process.pid}`;
const databaseUrl = adminUrl.replace(/\/postgres$/, `/${name}`);
let db, handler, cookie, person;
const collection = "00000000-0000-0000-0000-000000000001";
const request = (method, path, body, token, session = cookie) =>
  handler({
    rawPath: path,
    requestContext: { http: { method } },
    headers: token
      ? { authorization: `Bearer ${token}` }
      : { cookie: session, "x-elixir-client": "web" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const data = (r) => JSON.parse(r.body);
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
  person = (
    await db.query(
      "insert into account(email_hash,status,role) values ('admin-test','approved','admin') returning account_id",
    )
  ).rows[0].account_id;
  const session = await createSession(db, {
    secret: "test",
    accountId: person,
    emailHash: "admin-test",
  });
  cookie = `__Host-elixir_session=${session.token}`;
  handler = makeHandler({ databaseUrl, secret: "test" });
  // A new live refresh takes a token from the one global bucket (#64).
  await db.query("update budget_state set tokens = 100, settled_at = now()");
});
after(async () => {
  await db?.end();
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database ${name} with (force)`);
  await admin.end();
});
test("admin provisions REST-only integration; retired collection routes refuse", async () => {
  const r = await request("POST", "/api/admin/integrations", {
    name: "test-integration",
  });
  assert.equal(r.statusCode, 201, r.body);
  const { token, integration } = data(r);
  assert.equal(
    await validateServiceToken(db, token),
    null,
    "REST keys cannot enter MCP",
  );
  const wrongPurpose = await issueServiceToken(db, {
    accountId: integration.account_id,
    name: "wrong-purpose",
  });
  assert.equal(await validateServiceToken(db, wrongPurpose), null);
  const client = await registerClient(db, {
    clientName: "test-integration",
    redirectUris: ["https://example.invalid/callback"],
  });
  const resource = `https://elixir.poapkings.com/i/${integration.public_id}/mcp`;
  const oauth = await mintTokens(db, {
    clientId: client.clientId,
    accountId: integration.account_id,
    scope: "cr:read",
    resource,
  });
  assert.equal(
    await validateAccessToken(db, oauth.accessToken, { resource }),
    null,
  );
  const clock = await request("GET", "/api/v1/game/clock", undefined, token);
  assert.equal(clock.statusCode, 200, clock.body);
  assert.equal(data(clock).data.source, "policy");
  const human = await issueServiceToken(db, {
    accountId: person,
    name: "human",
  });
  assert.equal(
    (await request("GET", "/api/v1/game/clock", undefined, human)).statusCode,
    401,
  );
  const beforePolicy = (
    await db.query(
      "select scopes,daily_limit,hourly_limit,refresh_limit from integration where account_id=$1",
      [integration.account_id],
    )
  ).rows[0];
  const obsolete = await request("POST", "/api/admin/integrations", {
    action: "configure",
    id: integration.public_id,
    collection_id: collection,
  });
  assert.equal(obsolete.statusCode, 400);
  assert.equal(data(obsolete).error, "collections_retired");
  assert.deepEqual(
    (
      await db.query(
        "select scopes,daily_limit,hourly_limit,refresh_limit from integration where account_id=$1",
        [integration.account_id],
      )
    ).rows[0],
    beforePolicy,
    "obsolete grant input does not alter policy",
  );
  const path = `/api/v1/collections/${collection}/members/%2320JJJ2CCRU`;
  assert.equal((await request("PUT", path, {}, token)).statusCode, 404);
  assert.equal(
    (
      await request(
        "POST",
        `/api/v1/collections/${collection}/members`,
        { tags: ["#2GUCVLQR"] },
        token,
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await request(
        "POST",
        "/api/admin/integrations",
        { name: "must-not-create" },
        token,
      )
    ).statusCode,
    403,
  );
  const rotated = await request("POST", "/api/admin/integrations", {
    action: "rotate",
    id: integration.public_id,
  });
  assert.equal(rotated.statusCode, 200, rotated.body);
  assert.equal(
    (await request("GET", "/api/v1/game/clock", undefined, token)).statusCode,
    401,
  );
});

test("refresh retries share the job, stay principal-bound, and require an admitted profile", async () => {
  const provision = await request("POST", "/api/admin/integrations", {
    name: "refresh-test",
    refresh_limit: 1,
  });
  const { token, integration } = data(provision);
  const post = (playerTag = "#UL2V9QRG0", key = "first") =>
    handler({
      rawPath: "/api/v1/profile-refreshes",
      requestContext: { http: { method: "POST" } },
      headers: { authorization: `Bearer ${token}`, "idempotency-key": key },
      body: JSON.stringify({ player_tag: playerTag }),
    });
  const first = await post();
  assert.equal(first.statusCode, 202, first.body);
  const id = data(first).data.id,
    path = `/api/v1/profile-refreshes/${id}`;
  assert.equal(data(await post()).data.id, id);
  assert.equal((await post("#J2RGCRVG")).statusCode, 409);
  assert.equal((await post("#J2RGCRVG", "second")).statusCode, 429);
  const row = (
    await db.query(
      "select * from integration_profile_refresh where refresh_id=$1",
      [id],
    )
  ).rows[0];
  await db.query("update job set status='done',done_at=now() where job_id=$1", [
    row.job_id,
  ]);
  assert.equal(
    data(await request("GET", path, undefined, token)).data.status,
    "pending",
    "done without an admitted receipt is not success",
  );
  const other = data(
    await request("POST", "/api/admin/integrations", { name: "other-refresh" }),
  ).token;
  assert.equal((await request("GET", path, undefined, other)).statusCode, 404);
  const gateway = (
    await db.query(
      "insert into gateway(name,owner_account_id,static_ip,channel,status) values('test-refresh',$1,'192.0.2.1','live','active') returning gateway_id",
      [person],
    )
  ).rows[0].gateway_id;
  await db.query(
    "insert into player(player_tag,name) values('#UL2V9QRG0','Example')",
  );
  await db.query(
    "insert into player_snapshot_daily(player_tag,snapshot_date,observed_at,profile_observed_at) values('#UL2V9QRG0',current_date,now(),now())",
  );
  await db.query(
    "insert into api_receipt(endpoint,entity_key,payload_hash,gateway_id,admission,job_id,fetched_at) values('player','#UL2V9QRG0','test',$1,'admitted',$2,'2026-09-08T10:00:00Z')",
    [gateway, row.job_id],
  );
  const complete = data(await request("GET", path, undefined, token)).data;
  assert.equal(complete.status, "complete");
  assert.equal(complete.profile.observed_at, "2026-09-08T10:00:00.000Z");
  const rotated = data(
    await request("POST", "/api/admin/integrations", {
      action: "rotate",
      id: integration.public_id,
    }),
  ).token;
  assert.equal(
    data(await request("GET", path, undefined, rotated)).data.id,
    id,
  );
  assert.equal(
    (
      await db.query(
        "select refreshes from integration_usage where account_id=$1",
        [integration.account_id],
      )
    ).rows[0].refreshes,
    1,
  );
  await request("POST", "/api/admin/integrations", {
    action: "configure",
    id: integration.public_id,
    scopes: ["game:read"],
  });
  assert.equal(
    (await request("GET", path, undefined, rotated)).statusCode,
    403,
  );
  await request("POST", "/api/admin/integrations", {
    action: "suspend",
    id: integration.public_id,
  });
  assert.equal(
    (await request("GET", "/api/v1/game/clock", undefined, rotated)).statusCode,
    401,
  );
});

test("a refresh with no token left in the one budget is refused whole: no job, no refresh, no quota spent (#64)", async () => {
  const { token, integration } = data(
    await request("POST", "/api/admin/integrations", {
      name: "refresh-budget-test",
      refresh_limit: 5,
    }),
  );
  const post = (key) =>
    handler({
      rawPath: "/api/v1/profile-refreshes",
      requestContext: { http: { method: "POST" } },
      headers: { authorization: `Bearer ${token}`, "idempotency-key": key },
      body: JSON.stringify({ player_tag: "#2PYQ0" }),
    });
  await db.query("delete from job where entity_key = '#2PYQ0'");
  await db.query(
    "update budget_state set tokens = 0.5, settled_at = now() - interval '1 minute'",
  );
  try {
    const refused = await post("budget-1");
    assert.equal(refused.statusCode, 429, refused.body);
    const problem = JSON.parse(refused.body);
    assert.equal(problem.code, "rate_limited");
    assert.match(problem.detail, /shared Clash Royale budget/);
    assert.ok(problem.retry_after_s >= 200, String(problem.retry_after_s));
    assert.equal(refused.headers["retry-after"], String(problem.retry_after_s));
    const count = async (sql) =>
      (await db.query(sql, [integration.account_id])).rows[0]?.n ?? 0;
    assert.equal(
      await count(
        "select count(*)::int n from job where entity_key = '#2PYQ0' and $1::uuid is not null",
      ),
      0,
    );
    assert.equal(
      await count(
        "select count(*)::int n from integration_profile_refresh where account_id = $1",
      ),
      0,
    );
    assert.equal(
      await count(
        "select coalesce(sum(refreshes), 0)::int n from integration_usage where account_id = $1",
      ),
      0,
      "the day's refresh quota is untouched",
    );
    // The token back: the same key now mints, and is charged one token.
    await db.query("update budget_state set tokens = 2");
    const accepted = await post("budget-1");
    assert.equal(accepted.statusCode, 202, accepted.body);
    const { rows } = await db.query(
      "select tokens::float as t from budget_state",
    );
    assert.equal(rows[0].t, 1);
  } finally {
    await db.query("update budget_state set tokens = 100, settled_at = now()");
  }
});

test("IAM provisioning accepts only a digest and returns no credential", async () => {
  const { integrationOp } = await import("../../migrate/src/ops-accounts.mjs");
  await db.query("update account set role='owner' where account_id=$1", [
    person,
  ]);
  const rejected = await integrationOp(databaseUrl, {
    name: "ops-platform",
    token_hash: "plaintext-is-not-a-digest",
  });
  assert.equal(rejected.error, "token_hash_required");
  const minted = mintServiceTokenValue();
  const result = await integrationOp(databaseUrl, {
    name: "ops-platform",
    token_hash: minted.hash,
  });
  assert.equal(result.status, 201);
  assert.equal(result.token, undefined);
  await db.query(
    "insert into service_token(account_id,name,token_hash) values($1,'ops-platform',$2)",
    [person, "b".repeat(64)],
  );
  const retire = {
    action: "retire_legacy",
    id: result.integration.public_id,
    token_hash: "b".repeat(64),
  };
  assert.equal(
    (await integrationOp(databaseUrl, retire)).retired,
    0,
    "must verify REST before retiring legacy",
  );
  assert.equal(
    (await request("GET", "/api/v1/game/clock", undefined, minted.raw))
      .statusCode,
    200,
  );
  assert.equal((await integrationOp(databaseUrl, retire)).retired, 1);
  const listed = await integrationOp(databaseUrl, { action: "list" });
  assert.ok(!("available_collections" in listed));

  await db.query("update account set role='admin' where account_id=$1", [
    person,
  ]);
});

test("a person reads /api/v1/me with a grant for this door; an MCP grant is refused here, and this grant is refused at MCP (2026-09-23)", async () => {
  const clan = await familyClient(db, {
    clientName: "Elixir Clan",
    redirectUris: ["https://elixir.poapkings.com/api/clan/auth/callback"],
  });
  const other = await registerClient(db, {
    clientName: "Someone's app",
    redirectUris: ["https://example.org/callback"],
  });
  const apiGrant = await mintTokens(db, {
    clientId: clan.clientId,
    accountId: person,
    scope: "cr:read",
    resource: "https://elixir.poapkings.com/api/v1",
  });
  const me = await request(
    "GET",
    "/api/v1/me",
    undefined,
    apiGrant.accessToken,
  );
  assert.equal(me.statusCode, 200, me.body);
  assert.equal(data(me).data.principal.kind, "person");
  assert.ok(Array.isArray(data(me).data.players));
  assert.ok(data(me).request_id);

  // The same person's MCP grant is not a JSON API credential.
  const mcpGrant = await mintTokens(db, {
    clientId: clan.clientId,
    accountId: person,
    scope: "cr:read",
    resource: "https://elixir.poapkings.com/mcp",
  });
  const refused = await request(
    "GET",
    "/api/v1/me",
    undefined,
    mcpGrant.accessToken,
  );
  assert.equal(refused.statusCode, 401);
  // And this door's grant is not an MCP credential.
  assert.equal(
    await validateAccessToken(db, apiGrant.accessToken, {
      resource: "https://elixir.poapkings.com/mcp",
    }),
    null,
  );

  // A person reaches person operations only.
  const clock = await request(
    "GET",
    "/api/v1/game/clock",
    undefined,
    apiGrant.accessToken,
  );
  assert.equal(clock.statusCode, 404);

  // First-party is derived from where the client's codes can go.
  const firstParty = await validateAccessToken(db, apiGrant.accessToken, {
    resource: "https://elixir.poapkings.com/api/v1",
  });
  assert.equal(firstParty.firstParty, true);
  const third = await mintTokens(db, {
    clientId: other.clientId,
    accountId: person,
    scope: "cr:read",
    resource: "https://elixir.poapkings.com/api/v1",
  });
  const thirdParty = await validateAccessToken(db, third.accessToken, {
    resource: "https://elixir.poapkings.com/api/v1",
  });
  assert.equal(thirdParty.firstParty, false);
});

test("a family app signs a person in through /api/v1: its address on /me with account:email, and a player tracked with recordings:write (2.1.0)", async () => {
  const drop = await familyClient(db, {
    clientName: "Elixir Drop",
    redirectUris: ["https://drop.poapkings.com/auth/elixir/callback"],
  });
  const other = await registerClient(db, {
    clientName: "Someone's app",
    redirectUris: ["https://example.org/callback"],
  });
  await db.query("update account set email = $2 where account_id = $1", [
    person,
    "person@example.org",
  ]);
  const grant = await mintTokens(db, {
    clientId: drop.clientId,
    accountId: person,
    scope: "cr:read recordings:write account:email",
    resource: "https://elixir.poapkings.com/api/v1",
  });
  const me = await request("GET", "/api/v1/me", undefined, grant.accessToken);
  assert.equal(me.statusCode, 200, me.body);
  assert.equal(data(me).data.email, "person@example.org");
  // Without the capability, or from any other app, the address is absent.
  const plain = await mintTokens(db, {
    clientId: drop.clientId,
    accountId: person,
    scope: "cr:read",
    resource: "https://elixir.poapkings.com/api/v1",
  });
  assert.equal(
    data(await request("GET", "/api/v1/me", undefined, plain.accessToken)).data
      .email,
    undefined,
  );
  const third = await mintTokens(db, {
    clientId: other.clientId,
    accountId: person,
    scope: "cr:read account:email",
    resource: "https://elixir.poapkings.com/api/v1",
  });
  assert.equal(
    data(await request("GET", "/api/v1/me", undefined, third.accessToken)).data
      .email,
    undefined,
  );
  // Track a player: the tool's result, and the relationship bounded.
  const refusedPrimary = await request(
    "POST",
    "/api/v1/me/players",
    { player_tag: "#2PPGY0Q8", relationship: "primary" },
    grant.accessToken,
  );
  assert.equal(refusedPrimary.statusCode, 400);
  const tracked = await request(
    "POST",
    "/api/v1/me/players",
    { player_tag: "#2PPGY0Q8", relationship: "alt" },
    grant.accessToken,
  );
  assert.equal(tracked.statusCode, 200, tracked.body);
  const {
    rows: [claim],
  } = await db.query(
    "select relationship from claim where account_id = $1 and player_tag = '#2PPGY0Q8'",
    [person],
  );
  assert.ok(claim, "the player is now tracked");
  // A read-only grant cannot write.
  const readOnly = await request(
    "POST",
    "/api/v1/me/players",
    { player_tag: "#8QQ8QQ8Q" },
    plain.accessToken,
  );
  assert.notEqual(readOnly.statusCode, 200);
});

test("the person operations answer with the tools' structured results, uncapped, and refusals become problems with the tool's code (plan clan-app-api phases 2-3)", async () => {
  const clan = await familyClient(db, {
    clientName: "Elixir Clan",
    redirectUris: ["https://elixir.poapkings.com/api/clan/auth/callback"],
  });
  const grant = await mintTokens(db, {
    clientId: clan.clientId,
    accountId: person,
    scope: "cr:read",
    resource: "https://elixir.poapkings.com/api/v1",
  });
  const call = (method, path, body, query) =>
    handler({
      rawPath: path,
      requestContext: { http: { method } },
      headers: { authorization: `Bearer ${grant.accessToken}` },
      queryStringParameters: query,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  await db.query(
    `insert into player (player_tag, name) values ('#2PP', 'Known') on conflict do nothing`,
  );
  const names = await call("POST", "/api/v1/players/names", {
    player_tags: ["#2PP", "#9YY9YY9Q"],
  });
  assert.equal(names.statusCode, 200, names.body);
  const known = data(names).data.names.find((n) => n.player_tag === "#2PP");
  assert.equal(known.name, "Known");

  // A clan the record does not hold: the tool's refusal, as a problem.
  const roster = await call(
    "GET",
    `/api/v1/clans/${encodeURIComponent("#2PPQQ")}/roster`,
  );
  assert.equal(roster.statusCode, 404, roster.body);
  assert.equal(data(roster).code, "not_recorded");
  assert.equal(roster.headers["content-type"], "application/problem+json");

  const bad = await call("POST", "/api/v1/players/names", { player_tags: "x" });
  assert.equal(bad.statusCode, 400);
  const unknown = await call("GET", "/api/v1/clans/%232PPQQ/everything");
  assert.equal(unknown.statusCode, 404);
});

test("an integration with clans:read reads a clan as a person's grant does, audited by the tool; without it, refused (2.3.0)", async () => {
  const provision = (scopes, nameOf) =>
    request("POST", "/api/admin/integrations", { name: nameOf, scopes });
  const clanApp = data(await provision(["clans:read"], "elixir-clan"));
  const other = data(await provision(["players:read"], "no-clans"));
  const read = (path, token) =>
    handler({
      rawPath: path,
      requestContext: { http: { method: "GET" } },
      headers: { authorization: `Bearer ${token}` },
    });
  // A clan the record does not hold: the tool's own refusal, as for a person.
  const roster = await read(
    `/api/v1/clans/${encodeURIComponent("#2PPQQ")}/roster`,
    clanApp.token,
  );
  assert.equal(roster.statusCode, 404, roster.body);
  assert.equal(data(roster).code, "not_recorded");
  const part = await read(
    `/api/v1/clans/${encodeURIComponent("#2PPQQ")}/participation`,
    clanApp.token,
  );
  assert.equal(data(part).code, "not_recorded");
  const refused = await read(
    `/api/v1/clans/${encodeURIComponent("#2PPQQ")}/roster`,
    other.token,
  );
  assert.equal(refused.statusCode, 403);
  assert.equal(data(refused).code, "insufficient_scope");
  // The tool's run is audited once, as a REST call of the tool.
  const { rows } = await db.query(
    `select tool from mcp_call_audit where surface = 'rest' and tool in ('clans_roster', 'clans.roster') order by audit_id desc limit 2`,
  );
  assert.ok(
    rows.some((r) => r.tool === "clans_roster"),
    JSON.stringify(rows),
  );
});

test("a clan's war history reads the same for an integration with clans:read and a person's grant; seasons passes through (2.8.0)", async () => {
  const CLAN = "#J2RGCRVG"; // fixtures/riverracelog/log.json
  await ensureSeasonsAround(db);
  await db.query(
    "insert into clan (clan_tag) values ($1) on conflict do nothing",
    [CLAN],
  );
  await db.query(
    "insert into recording (subject_type, subject_tag, requested_by) values ('clan', $1, $2)",
    [CLAN, person],
  );
  await projectRiverRaceLog(db, {
    clanTag: CLAN,
    payload: JSON.parse(
      await readFile(
        new URL("../../../fixtures/riverracelog/log.json", import.meta.url),
        "utf8",
      ),
    ),
  });
  const site = data(
    await request("POST", "/api/admin/integrations", {
      name: "clan-website",
      scopes: ["clans:read"],
    }),
  );
  const other = data(
    await request("POST", "/api/admin/integrations", {
      name: "no-clans-war",
      scopes: ["players:read"],
    }),
  );
  const grant = await mintTokens(db, {
    clientId: (
      await familyClient(db, {
        clientName: "Elixir Clan (war history)",
        redirectUris: ["https://elixir.poapkings.com/api/clan/auth/callback"],
      })
    ).clientId,
    accountId: person,
    scope: "cr:read",
    resource: "https://elixir.poapkings.com/api/v1",
  });
  const read = (token, query) =>
    handler({
      rawPath: `/api/v1/clans/${encodeURIComponent(CLAN)}/war-history`,
      requestContext: { http: { method: "GET" } },
      headers: { authorization: `Bearer ${token}` },
      queryStringParameters: query,
    });
  const r = await read(site.token);
  assert.equal(r.statusCode, 200, r.body);
  const history = data(r).data;
  assert.equal(history.clan_tag, CLAN);
  assert.ok(history.weeks.length > 0);
  assert.ok(
    history.weeks.every(
      (w) =>
        Number.isInteger(w.season_id) &&
        Number.isInteger(w.section_index) &&
        Object.hasOwn(w, "our_rank") &&
        Object.hasOwn(w, "trophy_change"),
    ),
  );
  assert.equal(history.applied.seasons, 3, "the tool's default");
  const one = data(await read(site.token, { seasons: "1" })).data;
  assert.equal(one.applied.seasons, 1);
  assert.ok(one.weeks.length <= history.weeks.length);
  // A person's grant reads the same weeks.
  const person_ = data(await read(grant.accessToken)).data;
  assert.deepEqual(person_.weeks, history.weeks);
  const refused = await read(other.token);
  assert.equal(refused.statusCode, 403);
  assert.equal(data(refused).code, "insufficient_scope");
  const { rows } = await db.query(
    "select 1 from mcp_call_audit where surface = 'rest' and tool = 'war_history' limit 1",
  );
  assert.equal(rows.length, 1, "audited as a REST call of the tool");
});

test("a tool behind a lock answers query_timeout on Explore and /api/v1 before the handler's 504", async () => {
  // The invoker's deadline used to reach neither door: Explore passed
  // none, and /api/v1 only the analytical budget, so a read waiting on a
  // lock ran on until the handler gave up with a bare 504 and no request
  // id, and the query ran on after it.
  const clan = await familyClient(db, {
    clientName: "Elixir Clan (deadline)",
    redirectUris: ["https://elixir.poapkings.com/api/clan/auth/callback"],
  });
  const grant = await mintTokens(db, {
    clientId: clan.clientId,
    accountId: person,
    scope: "cr:read",
    resource: "https://elixir.poapkings.com/api/v1",
  });
  // Soft deadline 2.5 s; the tool's is 1.5 s inside it.
  const lambda = { getRemainingTimeInMillis: () => 4000 };
  const holder = new pg.Client({ connectionString: databaseUrl });
  await holder.connect();
  try {
    await holder.query("begin");
    await holder.query("lock table player in access exclusive mode");
    const rest = await handler(
      {
        rawPath: "/api/v1/players/names",
        requestContext: { http: { method: "POST" } },
        headers: { authorization: `Bearer ${grant.accessToken}` },
        body: JSON.stringify({ player_tags: ["#2PP"] }),
      },
      lambda,
    );
    assert.equal(data(rest).code, "query_timeout", rest.body);
    const explore = await handler(
      {
        rawPath: "/api/explore",
        requestContext: { http: { method: "POST" } },
        headers: { cookie, "x-elixir-client": "web" },
        body: JSON.stringify({
          tool: "players_names",
          args: { player_tags: ["#2PP"] },
        }),
      },
      lambda,
    );
    assert.equal(explore.statusCode, 200, explore.body);
    assert.equal(data(explore).body.error.code, "query_timeout");
    assert.ok(data(explore).body.meta.request_id);
  } finally {
    await holder.query("rollback").catch(() => {});
    await holder.end();
  }
});
