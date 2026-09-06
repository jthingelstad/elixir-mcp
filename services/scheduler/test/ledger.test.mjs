import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import {
  enqueueJob,
  leaseJob,
  settleLeases,
  completeJob,
  ledgerStats,
} from "../src/ledger.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_ledger_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);

let db;
let gw;

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.query(`create database ${NAME}`);
  await admin.end();
  await migrate({
    databaseUrl: DB_URL,
    migrationsDir: path.join(repoRoot, "db/migrations"),
  });
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  const {
    rows: [acct],
  } = await db.query(
    `insert into account (email_hash, status) values ('ledger', 'approved') returning account_id`,
  );
  const {
    rows: [g],
  } = await db.query(
    `insert into gateway (owner_account_id, name, status) values ($1, 'ledger-gw', 'active')
     returning gateway_id`,
    [acct.account_id],
  );
  gw = g.gateway_id;
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

test("lease order: live first, then oldest bulk; lanes gate operators", async () => {
  await enqueueJob(db, {
    endpoint: "player",
    entity_key: "#20JJJ2CCRU",
    lane: "bulk",
  });
  await enqueueJob(db, {
    endpoint: "clan",
    entity_key: "#J2RGCRVG",
    lane: "bulk",
  });
  await enqueueJob(db, {
    endpoint: "player",
    entity_key: "#2YG98VVQ",
    lane: "live",
  });

  const bulkOnly = await leaseJob(db, { gatewayId: gw, lanes: ["bulk"] });
  assert.equal(bulkOnly.lane, "bulk");
  assert.equal(bulkOnly.entity_key, "#20JJJ2CCRU", "oldest bulk first");

  const liveFirst = await leaseJob(db, {
    gatewayId: gw,
    lanes: ["live", "bulk"],
  });
  assert.equal(liveFirst.lane, "live", "live beats older bulk");

  const rest = await leaseJob(db, { gatewayId: gw, lanes: ["live", "bulk"] });
  assert.equal(rest.entity_key, "#J2RGCRVG");
  assert.equal(
    await leaseJob(db, { gatewayId: gw, lanes: ["live", "bulk"] }),
    null,
  );

  for (const j of [bulkOnly, liveFirst, rest]) {
    assert.equal(
      await completeJob(db, { jobId: j.job_id, gatewayId: gw }),
      true,
    );
  }
});

test("expiry requeues with attempt cap; exhaustion goes dead; twins fold", async () => {
  await enqueueJob(db, {
    endpoint: "player",
    entity_key: "#PLCCYUQL",
    lane: "bulk",
  });
  const j = await leaseJob(db, { gatewayId: gw, lanes: ["bulk"] });
  await db.query(
    `update job set leased_at = now() - interval '5 minutes' where job_id = $1`,
    [j.job_id],
  );
  const s1 = await settleLeases(db);
  assert.equal(s1.requeued, 1);

  // Exhaust the attempts: it dies instead of looping forever.
  await db.query(`update job set attempts = 5 where job_id = $1`, [j.job_id]);
  const j2 = await leaseJob(db, { gatewayId: gw, lanes: ["bulk"] });
  assert.equal(j2.job_id, j.job_id);
  await db.query(
    `update job set leased_at = now() - interval '5 minutes', attempts = 5 where job_id = $1`,
    [j.job_id],
  );
  const s2 = await settleLeases(db);
  assert.equal(s2.died, 1);

  // A stale lease whose subject ALREADY has a fresh queued row folds
  // to done instead of violating one-queued-per-subject.
  await enqueueJob(db, {
    endpoint: "player",
    entity_key: "#U08P889Y0",
    lane: "bulk",
  });
  const j3 = await leaseJob(db, { gatewayId: gw, lanes: ["bulk"] });
  await db.query(
    `update job set leased_at = now() - interval '5 minutes' where job_id = $1`,
    [j3.job_id],
  );
  await enqueueJob(db, {
    endpoint: "player",
    entity_key: "#U08P889Y0",
    lane: "bulk",
  });
  const s3 = await settleLeases(db);
  assert.equal(s3.folded, 1, "redundant stale lease closes quietly");

  const stats = await ledgerStats(db);
  assert.equal(stats.dead, 1);
  assert.ok(stats.queued_bulk >= 1);
});

test("two expired leases for one subject settle to at most one queued row (issue #2)", async () => {
  const subject = { endpoint: "player", entity_key: "#DUPSUBJ1", lane: "bulk" };
  await db.query(`delete from job`);
  await enqueueJob(db, subject);
  const a = await leaseJob(db, { gatewayId: gw, lanes: ["bulk"] });
  // A is leased, not queued, so the partial index lets a second row in.
  await enqueueJob(db, subject);
  const b = await leaseJob(db, { gatewayId: gw, lanes: ["bulk"] });
  assert.notEqual(a.job_id, b.job_id, "two leases for one subject");
  await db.query(
    `update job set leased_at = now() - interval '5 minutes' where job_id = any($1::bigint[])`,
    [[a.job_id, b.job_id]],
  );
  // Pre-fix this threw a unique violation and blocked fleet-wide leasing.
  const s = await settleLeases(db);
  const { rows } = await db.query(
    `select count(*)::int n from job where status = 'queued' and entity_key = $1`,
    ["#DUPSUBJ1"],
  );
  assert.equal(rows[0].n, 1, "exactly one queued row for the subject");
  assert.equal(s.requeued, 1);
  assert.equal(s.folded, 1, "the redundant expired lease folds");
  // Leasing keeps working afterwards.
  const next = await leaseJob(db, { gatewayId: gw, lanes: ["bulk"] });
  assert.ok(next, "fleet leasing is not blocked");
  await completeJob(db, { jobId: next.job_id, gatewayId: gw });
});

test("settlement charges every abandoned lease to its gateway exactly once, whichever actor settles (issue #6)", async () => {
  await db.query(`delete from job`);
  const streak = async () =>
    (
      await db.query(
        `select missed_streak from gateway where gateway_id = $1`,
        [gw],
      )
    ).rows[0].missed_streak;
  const before = await streak();
  for (const t of ["#ABND1", "#ABND2", "#ABND3"]) {
    await enqueueJob(db, { endpoint: "player", entity_key: t, lane: "bulk" });
    await leaseJob(db, { gatewayId: gw, lanes: ["bulk"] });
  }
  await db.query(
    `update job set leased_at = now() - interval '5 minutes' where status = 'leased'`,
  );
  // Two actors settle concurrently on separate connections (scheduler +
  // another collector): the three expiries are attributed once in total.
  const db2 = new pg.Client({ connectionString: DB_URL });
  await db2.connect();
  const [s1, s2] = await Promise.all([settleLeases(db), settleLeases(db2)]);
  await db2.end();
  assert.equal(s1.missed + s2.missed, 3, "three abandonments, counted once");
  assert.equal((await streak()) - before, 3, "streak charged exactly once");
});
