/**
 * {integration} after JSON API 5.0.0 took the integration door away: the
 * stored rows stay readable (`list`) and their keys revocable (`revoke`,
 * and `revoke_legacy` for the MCP key one ran on before it had its own),
 * and nothing creates, configures, rotates, suspends or resumes one.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../src/migrate.mjs";
import { integrationOp } from "../src/ops-accounts.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const SCRATCH = `elixir_mcp_test_ops_integration_${process.pid}`;
const SCRATCH_URL = ADMIN_URL.replace(/\/postgres$/, `/${SCRATCH}`);

let db, owner, integration;
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${SCRATCH} with (force)`);
  await admin.query(`create database ${SCRATCH}`);
  await admin.end();
  await migrate({
    databaseUrl: SCRATCH_URL,
    migrationsDir: path.join(repoRoot, "db/migrations"),
  });
  db = new pg.Client({ connectionString: SCRATCH_URL });
  await db.connect();
  owner = (
    await one(
      `insert into account (email_hash, status, is_owner, role)
       values ('owner', 'approved', true, 'owner') returning account_id`,
    )
  ).account_id;
  integration = await one(
    `insert into account (kind, owned_by_account_id, public_id, status, role)
     values ('integration', $1, 'abc123def456', 'approved', 'partner')
     returning account_id, public_id`,
    [owner],
  );
  await db.query(
    `insert into integration (account_id, name, scopes, daily_limit, hourly_limit, refresh_limit)
     values ($1, 'old-site', '{clans:read}', 10000, 2000, 1000)`,
    [integration.account_id],
  );
  await db.query(
    `insert into service_token (account_id, name, token_hash, scope, audience)
     values ($1, 'old-site', $2, '', 'integration_api')`,
    [integration.account_id, "a".repeat(64)],
  );
});

after(async () => {
  await db?.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${SCRATCH} with (force)`);
  await admin.end();
});

test("list names each stored integration with its keys", async () => {
  const r = await integrationOp(SCRATCH_URL, { action: "list" });
  assert.equal(r.status, 200);
  assert.equal(r.integrations.length, 1);
  const [row] = r.integrations;
  assert.equal(row.name, "old-site");
  assert.equal(row.public_id, integration.public_id);
  assert.equal(row.tokens.length, 1);
  assert.equal(row.tokens[0].revoked_at, null);
});

test("revoke revokes the integration's keys by public id and records who", async () => {
  const r = await integrationOp(SCRATCH_URL, {
    action: "revoke",
    id: integration.public_id,
  });
  assert.equal(r.status, 200);
  assert.equal(r.revoked, 1);
  const live = await one(
    "select count(*)::int n from service_token where account_id=$1 and revoked_at is null",
    [integration.account_id],
  );
  assert.equal(live.n, 0);
  const event = await one(
    "select detail from account_event where account_id=$1 and kind='integration_revoke'",
    [owner],
  );
  assert.equal(event.detail.integration, integration.public_id);
  const unknown = await integrationOp(SCRATCH_URL, {
    action: "revoke",
    id: "nope",
  });
  assert.equal(unknown.error, "not_found");
});

test("every other action is refused and writes nothing", async () => {
  for (const action of [
    undefined,
    "create",
    "configure",
    "rotate",
    "suspend",
    "resume",
    "retire_legacy",
  ]) {
    const r = await integrationOp(SCRATCH_URL, {
      action,
      name: "new-site",
      token_hash: "b".repeat(64),
      id: integration.public_id,
    });
    assert.equal(r.error, "invalid_action", String(action));
  }
  const counts = await one(
    `select (select count(*)::int from integration) integrations,
            (select count(*)::int from service_token where audience='integration_api') tokens,
            (select status from account where account_id=$1) status`,
    [integration.account_id],
  );
  assert.deepEqual(counts, { integrations: 1, tokens: 1, status: "approved" });
});

test("revoke_legacy revokes the owner's live MCP key named as the integration, and answers ids only", async () => {
  // Beside the legacy key, keys it must leave alone: another name on the
  // owner, and one of the same name already revoked. (A second live key
  // of the same name on the same account cannot exist: 0056.)
  const keys = (
    await db.query(
      `insert into service_token (account_id, name, token_hash, audience, revoked_at) values
         ($1, 'old-site', $2, 'mcp', null),
         ($1, 'old-site-other', $3, 'mcp', null),
         ($1, 'old-site', $4, 'mcp', now())
       returning token_id, name, revoked_at`,
      [owner, "c".repeat(64), "d".repeat(64), "e".repeat(64)],
    )
  ).rows;
  const target = keys.find((k) => k.name === "old-site" && !k.revoked_at);
  assert.equal(
    (await integrationOp(SCRATCH_URL, { action: "revoke_legacy" })).error,
    "id_required",
  );
  assert.equal(
    (
      await integrationOp(SCRATCH_URL, {
        action: "revoke_legacy",
        id: "nope",
      })
    ).error,
    "not_found",
  );
  const spec = { action: "revoke_legacy", id: integration.public_id };
  const r = await integrationOp(SCRATCH_URL, spec);
  assert.deepEqual(r, { revoked: 1, token_ids: [String(target.token_id)] });
  assert.ok(!JSON.stringify(r).includes("c".repeat(64)), "no hash");
  const after = (
    await db.query(
      `select token_id, revoked_at is not null as revoked from service_token
        where token_id = any($1::bigint[])`,
      [keys.map((k) => k.token_id)],
    )
  ).rows;
  for (const k of keys)
    assert.equal(
      after.find((x) => x.token_id === k.token_id).revoked,
      k === target || k.revoked_at !== null,
      `${k.name} ${k.token_id}`,
    );
  // A second run finds nothing live.
  assert.deepEqual(await integrationOp(SCRATCH_URL, spec), {
    revoked: 0,
    token_ids: [],
  });
});

test("revoke_legacy by name revokes that live MCP key on the owner and no other", async () => {
  const keys = (
    await db.query(
      `insert into service_token (account_id, name, token_hash, audience) values
         ($1, 'retired-bot', $2, 'mcp'),
         ($1, 'kept-bot', $3, 'mcp')
       returning token_id, name`,
      [owner, "f".repeat(64), "9".repeat(64)],
    )
  ).rows;
  const target = keys.find((k) => k.name === "retired-bot");
  const r = await integrationOp(SCRATCH_URL, {
    action: "revoke_legacy",
    name: "retired-bot",
  });
  assert.deepEqual(r, { revoked: 1, token_ids: [String(target.token_id)] });
  const live = (
    await db.query(
      "select name from service_token where account_id=$1 and name in ('retired-bot','kept-bot') and revoked_at is null",
      [owner],
    )
  ).rows.map((x) => x.name);
  assert.deepEqual(live, ["kept-bot"]);
  assert.deepEqual(
    await integrationOp(SCRATCH_URL, {
      action: "revoke_legacy",
      name: "retired-bot",
    }),
    { revoked: 0, token_ids: [] },
  );
});
