/**
 * {integration} after JSON API 5.0.0 took the integration door away: the
 * stored rows stay readable (`list`) and their keys revocable (`revoke`),
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
