import { test, before, after } from "node:test";
import assert from "node:assert/strict";
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
import { makeHandler } from "../src/handler.mjs";
const adminUrl =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const name = `elixir_mcp_test_integrations_${process.pid}`;
const databaseUrl = adminUrl.replace(/\/postgres$/, `/${name}`);
let db, handler, cookie, person, collection;
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
  collection = (
    await db.query(
      "insert into collection(slug,title,kind,owner_account) values ('integration-test','Test','player',$1) returning collection_id",
      [person],
    )
  ).rows[0].collection_id;
});
after(async () => {
  await db?.end();
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database ${name} with (force)`);
  await admin.end();
});
test("admin provisions REST-only integration with a bound collection", async () => {
  const r = await request("POST", "/api/admin/integrations", {
    name: "test-integration",
    collection_id: collection,
    member_limit: 2,
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
  const path = `/api/v1/collections/${collection}/members/%2320JJJ2CCRU`;
  const added = await request("PUT", path, {}, token);
  assert.equal(added.statusCode, 200, added.body);
  assert.equal(data(added).data.added, 1);
  const again = await request("PUT", path, {}, token);
  assert.equal(data(again).data.added, 0);
  assert.equal(data(again).data.enrollment_established, true);
  assert.equal(
    (
      await request(
        "POST",
        `/api/v1/collections/${collection}/members`,
        { tags: ["#2GUCVLQR", "#J2RGCRVG"] },
        token,
      )
    ).statusCode,
    409,
  );
  const members = await db.query(
    "select * from collection_member where collection_id=$1",
    [collection],
  );
  assert.equal(members.rowCount, 1);
  assert.equal((await request("DELETE", path, {}, token)).statusCode, 404);
  const raced = await Promise.all([
    request(
      "PUT",
      `/api/v1/collections/${collection}/members/%232GUCVLQR`,
      {},
      token,
    ),
    request(
      "PUT",
      `/api/v1/collections/${collection}/members/%23J2RGCRVG`,
      {},
      token,
    ),
  ]);
  assert.deepEqual(raced.map((r) => r.statusCode).sort(), [200, 409]);
  assert.equal(
    (
      await db.query(
        "select count(*)::int as n from collection_member where collection_id=$1",
        [collection],
      )
    ).rows[0].n,
    2,
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
    "insert into player_snapshot_daily(player_tag,snapshot_date) values('#UL2V9QRG0',current_date)",
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
  assert.ok(
    listed.available_collections.some((c) => c.collection_id === collection),
  );

  await db.query("update account set role='admin' where account_id=$1", [
    person,
  ]);
});
