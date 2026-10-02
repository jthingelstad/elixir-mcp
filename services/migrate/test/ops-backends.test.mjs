/**
 * The ops that act on the database's own connections and on accounts,
 * after the 2026-09-27 review (§3.1, §3.3): {terminate_backends} names
 * what it ends, never `true`, with a five-minute floor; {backends} groups
 * by application_name, which every function and every migrate op now
 * sets; 0186's connection check; {oauth_grants} revokes in one
 * transaction; and {collection}, which had no test.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../src/migrate.mjs";
import { terminateBackends, listBackends } from "../src/deck-backfill.mjs";
import { oauthGrants } from "../src/ops-grants.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const SCRATCH = `elixir_mcp_test_backends_${process.pid}`;
const SCRATCH_URL = ADMIN_URL.replace(/\/postgres$/, `/${SCRATCH}`);
// A refusal returns before connecting; this URL proves it.
const NOWHERE = "postgres://nobody@127.0.0.1:1/none";

let db;
before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`create database ${SCRATCH}`);
  await admin.end();
  await migrate({
    databaseUrl: SCRATCH_URL,
    migrationsDir: path.join(repoRoot, "db/migrations"),
  });
  db = new pg.Client({ connectionString: SCRATCH_URL });
  await db.connect();
});

after(async () => {
  await db?.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${SCRATCH} with (force)`);
  await admin.end();
});

test("terminate_backends refuses true and a pattern that names no query, before connecting", async () => {
  // DECISIONS, incident authority: "past five minutes (named, never
  // `true`)". `true` used to mean %battle_participant% with a 120 s floor.
  for (const spec of [
    true,
    undefined,
    {},
    { like: "%" },
    { like: "%%__%" },
    { like: "% %" },
    { older_than_s: 600 },
  ]) {
    const out = await terminateBackends(NOWHERE, spec);
    assert.equal(out.error, "named_query_required", JSON.stringify(spec));
  }
  const saved = process.env.DATABASE_URL;
  process.env.DATABASE_URL = NOWHERE;
  try {
    const { handler } = await import("../src/lambda.mjs");
    const out = await handler({ terminate_backends: true });
    assert.equal(out.error, "named_query_required");
  } finally {
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
  }
});

test("terminate_backends keeps a five-minute floor and filters by application_name", async () => {
  const sleeper = new pg.Client({
    connectionString: SCRATCH_URL,
    application_name: "elixir-mcp-test-sleeper",
  });
  await sleeper.connect();
  const sleeping = sleeper.query("select pg_sleep(3)").catch(() => {});
  try {
    await new Promise((r) => setTimeout(r, 300));
    const young = await terminateBackends(SCRATCH_URL, {
      like: "%pg_sleep%",
      older_than_s: 1,
      application_name: "elixir-mcp-test-sleeper",
    });
    assert.equal(young.older_than_s, 300, "the floor is five minutes");
    assert.deepEqual(young.terminated, [], "a young query is left alone");
    const listed = await listBackends(SCRATCH_URL, {
      application_name: "elixir-mcp-test-sleeper",
    });
    assert.equal(listed.backends.length, 1);
    assert.equal(
      listed.backends[0].application_name,
      "elixir-mcp-test-sleeper",
    );
    assert.deepEqual(listed.by_application, {
      "elixir-mcp-test-sleeper": { backends: 1, active: 1 },
    });
  } finally {
    await sleeping;
    await sleeper.end();
  }
});

test("backends groups every connection by application_name, and a migrate op names its own", async () => {
  const named = new pg.Client({
    connectionString: SCRATCH_URL,
    application_name: "elixir-mcp-web-api",
  });
  await named.connect();
  const saved = [process.env.DATABASE_URL, process.env.PGAPPNAME];
  process.env.DATABASE_URL = SCRATCH_URL;
  process.env.PGAPPNAME = "elixir-mcp-migrate";
  try {
    const { handler } = await import("../src/lambda.mjs");
    const out = await handler({ backends: true });
    assert.equal(out.as, "elixir-mcp-migrate:backends");
    assert.equal(out.by_application["elixir-mcp-web-api"].backends, 1);
    assert.equal(
      process.env.PGAPPNAME,
      "elixir-mcp-migrate",
      "the op's name lasts the invocation",
    );
    const filtered = await handler({
      backends: { application_name: "elixir-mcp-migrate" },
    });
    assert.ok(
      filtered.backends.every((b) =>
        b.application_name.startsWith("elixir-mcp-migrate"),
      ),
    );
  } finally {
    await named.end();
    [process.env.DATABASE_URL, process.env.PGAPPNAME] = saved;
    if (saved[0] === undefined) delete process.env.DATABASE_URL;
    if (saved[1] === undefined) delete process.env.PGAPPNAME;
  }
});

test("0186: a new connection checks its client every ten seconds", async () => {
  const fresh = new pg.Client({ connectionString: SCRATCH_URL });
  await fresh.connect();
  try {
    const { rows } = await fresh.query("show client_connection_check_interval");
    assert.equal(rows[0].client_connection_check_interval, "10s");
  } finally {
    await fresh.end();
  }
});

async function seedGrant(tag) {
  const {
    rows: [acct],
  } = await db.query(
    `insert into account (email_hash, status) values ($1, 'approved') returning account_id`,
    [`grants-${tag}`],
  );
  await db.query(
    `insert into oauth_client (client_id, client_name, redirect_uris, expires_at)
     values ($1, 'Grant test', array['https://clan.poapkings.com/cb-${tag}'], now() + interval '1 day')`,
    [`client-${tag}`],
  );
  const {
    rows: [fam],
  } = await db.query(
    `insert into oauth_family (client_id, account_id, absolute_expires_at)
     values ($1, $2, now() + interval '90 days') returning family_id`,
    [`client-${tag}`, acct.account_id],
  );
  return { accountId: acct.account_id, familyId: fam.family_id };
}

test("oauth_grants revoke writes the revocation and its event together, or neither", async () => {
  const ok = await seedGrant("ok");
  const out = await oauthGrants(SCRATCH_URL, {
    revoke: [ok.familyId],
    reason: "test",
  });
  assert.deepEqual(out.revoked, [{ family_id: ok.familyId, revoked: true }]);
  const {
    rows: [event],
  } = await db.query(
    `select detail from account_event where account_id = $1 and kind = 'connection_revoked'`,
    [ok.accountId],
  );
  assert.equal(event.detail.family_id, ok.familyId);
  assert.equal(event.detail.reason, "test");

  // The event insert fails: the family must stay live, not revoked with
  // no record of why, so the op can be run again.
  const failing = await seedGrant("fail");
  await db.query(`create function refuse_event() returns trigger language plpgsql as $$
    begin raise exception 'event refused'; end $$`);
  await db.query(
    `create trigger refuse_event before insert on account_event for each row execute function refuse_event()`,
  );
  try {
    await assert.rejects(
      oauthGrants(SCRATCH_URL, { revoke: [failing.familyId], reason: "x" }),
      /event refused/,
    );
  } finally {
    await db.query(`drop trigger refuse_event on account_event`);
    await db.query(`drop function refuse_event()`);
  }
  const {
    rows: [fam],
  } = await db.query(
    `select revoked_at from oauth_family where family_id = $1`,
    [failing.familyId],
  );
  assert.equal(fam.revoked_at, null, "rolled back with the event");

  const listed = await oauthGrants(SCRATCH_URL, {
    redirect_host: "clan.poapkings.com/cb-fail",
  });
  assert.equal(listed.grants.length, 1);
  await assert.rejects(oauthGrants(SCRATCH_URL, {}), /redirect_host or revoke/);
});
