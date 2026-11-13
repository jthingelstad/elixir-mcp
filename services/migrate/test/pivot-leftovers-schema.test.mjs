/**
 * 0257, read back from a migrated scratch database: the year graph's
 * table, the integration counters and integration's scopes and limits are
 * gone; integration keeps what the {integration} op and Clan's morning run
 * read; and both audience CHECKs refuse the integration door /i/<id>/mcp
 * while still taking the person's, the JSON API's and an agent's.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../src/migrate.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const SCRATCH = `elixir_mcp_test_pivot_leftovers_${process.pid}`;
const SCRATCH_URL = ADMIN_URL.replace(/\/postgres$/, `/${SCRATCH}`);
const HOST = "https://elixir.poapkings.com";

let db, accountId;

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
  accountId = (
    await db.query(
      `insert into account (email_hash, status) values ('pivot', 'approved')
       returning account_id`,
    )
  ).rows[0].account_id;
  await db.query(
    `insert into oauth_client (client_id, client_name, redirect_uris, expires_at)
     values ('pivot-client', 'Pivot test', array['https://example.com/cb'],
             now() + interval '1 day')`,
  );
});

after(async () => {
  await db?.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${SCRATCH} with (force)`);
  await admin.end();
});

test("the dropped tables are gone", async () => {
  const { rows } = await db.query(
    `select to_regclass(n) as t from unnest($1::text[]) n`,
    [["player_activity", "integration_usage", "integration_profile_refresh"]],
  );
  assert.deepEqual(
    rows.map((r) => r.t),
    [null, null, null],
  );
});

test("integration keeps its identity and nothing else of 0058's", async () => {
  const { rows } = await db.query(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'integration'
      order by column_name`,
  );
  const cols = rows.map((r) => r.column_name);
  for (const gone of ["scopes", "daily_limit", "hourly_limit", "refresh_limit"])
    assert.ok(!cols.includes(gone), gone);
  for (const kept of ["account_id", "name", "created_at"])
    assert.ok(cols.includes(kept), kept);
});

async function familyAt(resource) {
  await db.query("savepoint s");
  try {
    await db.query(
      `insert into oauth_family (client_id, account_id, absolute_expires_at, resource)
       values ('pivot-client', $1, now() + interval '90 days', $2)`,
      [accountId, resource],
    );
    await db.query("release savepoint s");
    return "ok";
  } catch (err) {
    await db.query("rollback to savepoint s");
    return err.constraint ?? err.message;
  }
}

test("oauth_family takes the three doors and refuses the integration door", async () => {
  await db.query("begin");
  try {
    for (const p of ["/mcp", "/api/v1", "/a/abcd1234/mcp"])
      assert.equal(await familyAt(`${HOST}${p}`), "ok", p);
    for (const p of ["/i/abcd12345678/mcp", "/i/abcd1234/mcp"])
      assert.equal(
        await familyAt(`${HOST}${p}`),
        "oauth_family_resource_shape",
        p,
      );
  } finally {
    await db.query("rollback");
  }
});

test("oauth_code's CHECK is the same pattern as oauth_family's", async () => {
  const { rows } = await db.query(
    `select conname, pg_get_constraintdef(oid) as def from pg_constraint
      where conname in ('oauth_code_resource_shape', 'oauth_family_resource_shape')
      order by conname`,
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].def, rows[1].def);
  assert.doesNotMatch(rows[0].def, /\[ai\]|\/i\//);
  assert.match(rows[0].def, /a\/\[a-z0-9\]\{8,16\}\/mcp/);
});
