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
import pg from "pg";
import { agentRecordingsOp } from "../src/ops-agent-recordings.mjs";
import { addClan, addPlayer } from "@elixir-mcp/claims";
import {
  createScratch,
  dropScratch,
} from "../../../packages/ingest/test/helpers.mjs";

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
  await createScratch(SCRATCH);
  db = new pg.Client({ connectionString: SCRATCH_URL });
  await db.connect();
});

after(async () => {
  await db.end();
  await dropScratch(SCRATCH);
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
  await addPlayer(db, { accountId: agent }, { tag: "#00C298UC", via: "test" });
  await addPlayer(db, { accountId: agent }, { tag: "#0J0RVYRR", via: "test" });
  await addPlayer(db, { accountId: owner }, { tag: "#0J0RVYRR", via: "test" });
  const clan = await addClan(
    db,
    { accountId: agent },
    { tag: "#0JVRYLGG", scope: "activity", via: "test" },
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
    { kind: "player", tag: "#00C298UC" },
    { kind: "clan", tag: "#0JVRYLGG" },
  ]);
  assert.equal(await active("#00C298UC"), 1, "a dry run writes nothing");

  assert.equal((await agentRecordingsOp(SCRATCH_URL, {})).dry_run, true);

  const run = await agentRecordingsOp(SCRATCH_URL, { dry_run: false });
  assert.equal(run.stopped.length, 2);
  assert.equal(await active("#00C298UC"), 0);
  assert.equal(await active("#0JVRYLGG"), 0);
  assert.equal(await active("#0J0RVYRR"), 1, "the owner still wants it");

  const again = await agentRecordingsOp(SCRATCH_URL, { dry_run: false });
  assert.deepEqual(again.stopped, []);
});
