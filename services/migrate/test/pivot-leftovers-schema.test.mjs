/**
 * 0257, read back from a migrated scratch database: the year graph's
 * table and the integration counters are gone, and both audience CHECKs
 * refuse the integration door /i/<id>/mcp while still taking the
 * person's two doors. 0317 later dropped the integration table and the
 * agent door too (accounts-are-people.test.mjs).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {
  createScratch,
  dropScratch,
} from "../../../packages/ingest/test/helpers.mjs";

const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const SCRATCH = `elixir_mcp_test_pivot_leftovers_${process.pid}`;
const SCRATCH_URL = ADMIN_URL.replace(/\/postgres$/, `/${SCRATCH}`);
const HOST = "https://elixir.poapkings.com";

let db, accountId;

before(async () => {
  await createScratch(SCRATCH);
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
  await dropScratch(SCRATCH);
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

test("oauth_family takes the two doors and refuses the integration and agent doors", async () => {
  await db.query("begin");
  try {
    for (const p of ["/mcp", "/api/v1"])
      assert.equal(await familyAt(`${HOST}${p}`), "ok", p);
    for (const p of [
      "/i/abcd12345678/mcp",
      "/i/abcd1234/mcp",
      "/a/abcd1234/mcp",
    ])
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
  assert.doesNotMatch(rows[0].def, /\[ai\]|\/i\/|a\/\[/);
  assert.match(rows[0].def, /\(mcp\|api\/v1\)\$/);
});
