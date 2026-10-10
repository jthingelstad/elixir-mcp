/**
 * {agent_recordings} (2026-10-10): only active agents count against their
 * owner's slots, and a suspended agent's tracking is no reason to record.
 * Agents suspended before the rule shipped still hold their recordings
 * open; this op settles them through the claims reconcile. A dry run
 * writes nothing; a run stops only what no one else wants; a re-run stops
 * nothing.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../src/migrate.mjs";
import { agentRecordingsOp } from "../src/ops-agent-recordings.mjs";
import { addClan, addPlayer } from "@elixir-mcp/claims";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const SCRATCH = `elixir_mcp_test_agent_recordings_${process.pid}`;
const SCRATCH_URL = ADMIN_URL.replace(/\/postgres$/, `/${SCRATCH}`);

let db;
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const active = async (tag) =>
  (
    await one(
      `select count(*)::int as n from recording
        where subject_tag = $1 and status = 'active'`,
      [tag],
    )
  ).n;

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
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${SCRATCH} with (force)`);
  await admin.end();
});

test("settles what suspended agents held open, and only that", async () => {
  const owner = (
    await one(
      `insert into account (email_hash, status, role)
       values ('h-agent-recordings', 'approved', 'member') returning account_id`,
    )
  ).account_id;
  const agent = (
    await one(
      `insert into account (status, role, kind, owned_by_account_id, public_id)
       values ('approved', 'member', 'agent', $1, 'agrec0000001') returning account_id`,
      [owner],
    )
  ).account_id;
  // While active: a player only it tracks, a player its owner shares, and
  // a clan it tracks.
  await addPlayer(db, { accountId: agent }, { tag: "#2YG98VVQ", via: "test" });
  await addPlayer(db, { accountId: agent }, { tag: "#PYLQGRJC", via: "test" });
  await addPlayer(db, { accountId: owner }, { tag: "#PYLQGRJC", via: "test" });
  const clan = await addClan(
    db,
    { accountId: agent },
    { tag: "#9VUP08YL", scope: "activity", via: "test" },
  );
  assert.equal(clan.ok, true, JSON.stringify(clan));
  // Suspended the old way, before the rule: nothing settled.
  await db.query(
    `update account set status = 'disabled' where account_id = $1`,
    [agent],
  );

  const dry = await agentRecordingsOp(SCRATCH_URL, { dry_run: true });
  assert.equal(dry.subjects, 3);
  assert.deepEqual(dry.would_stop, [
    { kind: "player", tag: "#2YG98VVQ" },
    { kind: "clan", tag: "#9VUP08YL" },
  ]);
  assert.equal(await active("#2YG98VVQ"), 1, "a dry run writes nothing");

  assert.equal((await agentRecordingsOp(SCRATCH_URL, {})).dry_run, true);

  const run = await agentRecordingsOp(SCRATCH_URL, { dry_run: false });
  assert.equal(run.stopped.length, 2);
  assert.equal(await active("#2YG98VVQ"), 0);
  assert.equal(await active("#9VUP08YL"), 0);
  assert.equal(await active("#PYLQGRJC"), 1, "the owner still wants it");

  const again = await agentRecordingsOp(SCRATCH_URL, { dry_run: false });
  assert.deepEqual(again.stopped, []);
});
