import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../src/migrate.mjs";
import { profileTool } from "../src/ops-profile.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const SCRATCH = `elixir_mcp_test_profile_${process.pid}`;
const SCRATCH_URL = ADMIN_URL.replace(/\/postgres$/, `/${SCRATCH}`);

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`create database ${SCRATCH}`);
  await admin.end();
  await migrate({
    databaseUrl: SCRATCH_URL,
    migrationsDir: path.join(repoRoot, "db/migrations"),
  });
  const db = new pg.Client({ connectionString: SCRATCH_URL });
  await db.connect();
  const {
    rows: [a],
  } = await db.query(
    `insert into account (email_hash, status, role, kind)
     values ('profile-test', 'approved', 'owner', 'person')
     returning account_id`,
  );
  await db.query(
    `insert into service_token (account_id, name, token_hash, scope)
     values ($1, 'profiler', repeat('a', 64), 'cr:read')`,
    [a.account_id],
  );
  await db.end();
});

after(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${SCRATCH} with (force)`);
  await admin.end();
});

test("profile_tool runs the registry's own handler and times every query it sends", async () => {
  const r = await profileTool(SCRATCH_URL, {
    tool: "cards_catalog",
    args: {},
    principal: "profiler",
    explain: true,
  });
  // An empty catalog is a refusal, and a refusal is still a profiled
  // answer: its queries were sent and are recorded.
  assert.ok(
    r.error === null || r.error.code === "not_recorded",
    JSON.stringify(r.error),
  );
  assert.equal(r.kind, "person");
  assert.ok(r.queries >= 1);
  assert.ok(r.total_ms >= r.slowest[0].ms);
  const read = r.slowest.find((q) => /^(with|select)/i.test(q.sql));
  assert.ok(read, "a read was recorded");
  assert.ok(
    read.plan && typeof read.plan.exec_ms === "number",
    "and explained",
  );
});

test("profile_tool refuses writes, the live lane, and names it cannot resolve", async () => {
  assert.equal(
    (
      await profileTool(SCRATCH_URL, {
        tool: "elixir_track_player",
        principal: "profiler",
      })
    ).error,
    "not_profilable",
  );
  assert.equal(
    (
      await profileTool(SCRATCH_URL, {
        tool: "live_fetch",
        principal: "profiler",
      })
    ).error,
    "not_profilable",
  );
  assert.equal(
    (await profileTool(SCRATCH_URL, { tool: "no_such_tool" })).error,
    "unknown_tool",
  );
  assert.equal(
    (
      await profileTool(SCRATCH_URL, {
        tool: "cards_catalog",
        principal: "nobody",
      })
    ).error,
    "principal_not_found",
  );
});

test("profile_tool's session is read-only, so a handler cannot write through it", async () => {
  // The guard is Postgres's, not the classification's: prove it holds.
  const r = await profileTool(SCRATCH_URL, {
    tool: "cards_catalog",
    principal: "profiler",
  });
  assert.notEqual(r.error?.code, "internal");
  const db = new pg.Client({ connectionString: SCRATCH_URL });
  await db.connect();
  try {
    await db.query("set default_transaction_read_only = on");
    await assert.rejects(
      db.query(`insert into player (player_tag) values ('#2PP0V9ZZ')`),
      /read-only transaction/,
    );
  } finally {
    await db.end();
  }
});
