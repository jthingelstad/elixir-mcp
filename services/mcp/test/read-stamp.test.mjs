/**
 * A resolved subject is a subject somebody asked about. The stamp that
 * tells the scheduler so must be best-effort: one indexed update, a no-op
 * for a tag nobody records, and never a failure a reader can see.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import { stampRead } from "../src/tools/shared.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_readstamp_${process.pid}`;
const URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);
let db;

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.query(`create database ${NAME}`);
  await admin.end();
  await migrate({
    databaseUrl: URL,
    migrationsDir: path.join(repoRoot, "db/migrations"),
  });
  db = new pg.Client({ connectionString: URL });
  await db.connect();
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

test("a read stamps the recorded subject's battlelog row, and only that row", async () => {
  await db.query(
    `insert into poll_state (subject_tag, endpoint) values ('#READ1', 'player_battlelog'), ('#READ1', 'player')`,
  );
  await stampRead(db, "#READ1");
  const { rows } = await db.query(
    `select endpoint, last_read_at from poll_state where subject_tag = '#READ1' order by endpoint`,
  );
  assert.equal(rows[0].endpoint, "player");
  assert.equal(rows[0].last_read_at, null, "profiles are not read-capped");
  assert.equal(rows[1].endpoint, "player_battlelog");
  assert.ok(
    Date.now() - rows[1].last_read_at.getTime() < 60_000,
    "battlelog row stamped now",
  );
});

test("a subject nobody records is a no-op, and a broken connection never throws", async () => {
  await stampRead(db, "#NOBODY");
  const { rows } = await db.query(
    `select count(*)::int n from poll_state where subject_tag = '#NOBODY'`,
  );
  assert.equal(rows[0].n, 0, "no row invented");
  const broken = {
    query: async () => {
      throw new Error("connection lost");
    },
  };
  await assert.doesNotReject(() => stampRead(broken, "#READ1"));
});
