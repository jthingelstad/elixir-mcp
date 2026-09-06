import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import { makeHandler } from "../src/handler.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_handler_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);

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
});

after(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

// The regression for issue #1: the ledger change added an awaited CloudWatch
// PutMetricData call that hung every tick to the 50s timeout because the
// NAT-free VPC has no route to CloudWatch. A hanging metric sink must never
// hold the tick open. Under the pre-fix handler this test would hang and fail
// on the race timeout; under the fix it returns immediately.
test("a hanging metric sink cannot hold the tick open (issue #1)", async () => {
  const handler = makeHandler({
    databaseUrl: DB_URL,
    emitMetrics: () => new Promise(() => {}), // never resolves, like the old PutMetricData hang
  });
  const HUNG = Symbol("hung");
  const result = await Promise.race([
    handler(),
    new Promise((r) => {
      const t = setTimeout(() => r(HUNG), 2000);
      t.unref();
    }),
  ]);
  assert.notEqual(
    result,
    HUNG,
    "handler must return without awaiting metric emission",
  );
  assert.ok(
    Number.isInteger(result.planned),
    "tick produced its normal result",
  );
  assert.ok(result.ledger, "ledger stats present in the tick result");
});

test("emitMetrics receives the committed ledger stats", async () => {
  let seen = null;
  const handler = makeHandler({
    databaseUrl: DB_URL,
    emitMetrics: (stats) => {
      seen = stats;
    },
  });
  const result = await handler();
  assert.ok(seen, "emitMetrics was called");
  for (const k of ["queued_bulk", "queued_live", "dead", "oldest_queued_s"]) {
    assert.ok(k in seen, `stats carries ${k}`);
  }
  assert.deepEqual(
    seen,
    result.ledger,
    "emitted stats are the tick's ledger stats",
  );
});

test("a throwing metric sink never fails a committed tick", async () => {
  const handler = makeHandler({
    databaseUrl: DB_URL,
    emitMetrics: () => {
      throw new Error("boom");
    },
  });
  const result = await handler(); // must resolve, not reject
  assert.ok(result.ledger, "the committed tick still returns cleanly");
});
