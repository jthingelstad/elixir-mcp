/**
 * {ops_recordings} (2026-10-12, #527): the maintainer's own `ops` reason
 * to record is retired; only people's tracking records. Recordings the
 * 0042 backfill labelled `ops` stay open until something reconciles their
 * subject; this op counts them and settles them through the claims
 * reconcile. A dry run writes nothing; a run stops only what nobody
 * tracks; a re-run stops nothing; nothing is deleted.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../src/migrate.mjs";
import { opsRecordingsOp } from "../src/ops-ops-recordings.mjs";
import { addPlayer } from "@elixir-mcp/claims";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const SCRATCH = `elixir_mcp_test_ops_recordings_${process.pid}`;
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

test("counts the ops origin and settles what only it kept open", async () => {
  const owner = (
    await one(
      `insert into account (email_hash, status, role)
       values ('h-ops-recordings', 'approved', 'member') returning account_id`,
    )
  ).account_id;
  // A player somebody tracks, labelled ops by the old backfill.
  await addPlayer(db, { accountId: owner }, { tag: "#PYLQGRJC", via: "test" });
  await db.query(
    `update recording set origin = 'ops' where subject_tag = '#PYLQGRJC'`,
  );
  // A player and a clan nobody tracks, recorded under ops alone, and a
  // stopped ops row that is history.
  await db.query(
    `insert into recording (subject_type, subject_tag, requested_by, origin, status)
     values ('player', '#2YG98VVQ', $1, 'ops', 'active'),
            ('clan', '#9VUP08YL', $1, 'ops', 'active'),
            ('player', '#8C8JJQLG', $1, 'ops', 'stopped')`,
    [owner],
  );

  const dry = await opsRecordingsOp(SCRATCH_URL, { dry_run: true });
  assert.deepEqual(dry.origin_ops, [
    { subject_type: "clan", status: "active", n: 1 },
    { subject_type: "player", status: "active", n: 2 },
    { subject_type: "player", status: "stopped", n: 1 },
  ]);
  assert.equal(dry.subjects, 3);
  assert.deepEqual(dry.would_stop_count, { player: 1, clan: 1 });
  assert.deepEqual(dry.would_stop, [
    { kind: "player", tag: "#2YG98VVQ" },
    { kind: "clan", tag: "#9VUP08YL" },
  ]);
  assert.equal(await active("#2YG98VVQ"), 1, "a dry run writes nothing");

  assert.equal((await opsRecordingsOp(SCRATCH_URL, {})).dry_run, true);

  const run = await opsRecordingsOp(SCRATCH_URL, { dry_run: false });
  assert.deepEqual(run.stopped_count, { player: 1, clan: 1 });
  assert.equal(await active("#2YG98VVQ"), 0);
  assert.equal(await active("#9VUP08YL"), 0);
  assert.equal(await active("#PYLQGRJC"), 1, "somebody still tracks it");
  const rows = await one(
    `select count(*)::int as n from recording where origin = 'ops'`,
  );
  assert.equal(rows.n, 4, "stopping deletes nothing");

  const again = await opsRecordingsOp(SCRATCH_URL, { dry_run: false });
  assert.deepEqual(again.stopped, []);
});
