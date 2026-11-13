/**
 * The nightly archetype stamp (0148) has its own payload and its own
 * 05:30Z rule. It rode the battle-activity histogram's rule until the
 * histogram, its Settings year graph and its player_activity table
 * retired (2026-11-13); the retired payload is now an unknown op, so a
 * stale rule or hand-run cannot rebuild what is gone.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import { handler } from "../src/index.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_archetype_stamp_${process.pid}`;
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

test("{archetype_stamp: true} runs the nightly stamp and says so", async () => {
  process.env.DATABASE_URL = DB_URL;
  const result = await handler({ archetype_stamp: true });
  assert.ok(result.archetype_stamp, JSON.stringify(result));
  assert.equal(typeof result.archetype_stamp, "object");
});

test("the retired histogram payload is an unknown op", async () => {
  process.env.DATABASE_URL = DB_URL;
  await assert.rejects(
    handler({ activity_histogram: true }),
    /no recognized op/,
  );
});

test("the 05:30Z rule sends the stamp's payload, and no rule sends the retired one", () => {
  const template = readFileSync(
    path.join(repoRoot, "infra/template.yaml"),
    "utf8",
  );
  assert.match(
    template,
    /ScheduleExpression: cron\(30 5 \* \* \? \*\)\n\s+Targets:\n\s+- Arn: !GetAtt JobsFunction\.Arn\n\s+Id: archetype-stamp\n\s+Input: '\{"archetype_stamp": true\}'/,
  );
  assert.doesNotMatch(template, /activity_histogram|ActivityHistogram/);
});
