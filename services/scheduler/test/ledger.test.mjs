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
