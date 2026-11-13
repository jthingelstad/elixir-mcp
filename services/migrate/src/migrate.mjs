/**
 * Migration runner — DESIGN §11.1.
 *
 * Ordered SQL files in db/migrations (NNNN_description.sql), tracked in
 * schema_migrations, applied under a Postgres advisory lock. Applied
 * migrations are immutable: a checksum mismatch on an already-applied file
 * is an error, never a re-run. Never invoked at handler start — deploy
 * order is code-upload -> migrate -> flip.
 */

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { declaredVacuum } from "./vacuum-after.mjs";
import { vacuumAnalyze, vacuumCommand } from "./vacuum.mjs";

/** The most one `-- vacuum after:` vacuum may take, and how long the
 *  ladder may spend on them all when the caller names no deadline (the
 *  CLI, tests). The Lambda passes its own end less a margin as the
 *  deadline (lambda.mjs). battle_participant's whole heap, 11,735 pages
 *  with an empty map, took 7 s on the db.t4g.micro on 2026-11-13. */
export const VACUUM_AFTER_BUDGET_MS = 120_000;

/** Below this much budget a vacuum is not started; it is reported with
 *  the op that runs it instead. */
const VACUUM_AFTER_MIN_MS = 5_000;

// Arbitrary but stable app-wide advisory lock key for migrations.
export const MIGRATION_LOCK_KEY = 0x314c589;

const MIGRATION_FILE_RE = /^(\d{4})_[a-z0-9_]+\.sql$/;

export async function loadMigrations(dir) {
  const entries = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const migrations = [];
  let expected = 1;
  for (const name of entries) {
    const m = MIGRATION_FILE_RE.exec(name);
    if (!m)
      throw new Error(`migration file name not NNNN_snake_case.sql: ${name}`);
    const id = Number(m[1]);
    if (id !== expected) {
      throw new Error(
        `migration ids must be dense and ordered; expected ${expected}, got ${name}`,
      );
    }
    expected += 1;
    const sql = await readFile(path.join(dir, name), "utf8");
    migrations.push({
      id,
      name,
      sql,
      sha256: createHash("sha256").update(sql).digest("hex"),
      vacuumAfter: declaredVacuum(sql),
    });
  }
  return migrations;
}

/**
 * Apply every pending migration, then vacuum the tables they declare.
 *
 * The vacuums run after the last commit, on the same connection (VACUUM
 * refuses a transaction), each table once, while `vacuumDeadline` (epoch
 * ms) allows. A vacuum that fails or does not fit is reported in
 * `vacuumed` with the op that finishes it, and never fails the ladder:
 * the migrations are already committed. A migration that fails stops the
 * ladder before any vacuum, and the deploy's visibility check names
 * whatever its earlier, committed files left behind.
 */
export async function migrate({
  databaseUrl,
  migrationsDir,
  log = () => {},
  vacuumDeadline = Date.now() + VACUUM_AFTER_BUDGET_MS,
}) {
  const migrations = await loadMigrations(migrationsDir);
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    await client.query(`
      create table if not exists schema_migrations (
        id integer primary key,
        name text not null,
        sha256 text not null,
        applied_at timestamptz not null default now()
      )`);
    const { rows: applied } = await client.query(
      "select id, name, sha256 from schema_migrations order by id",
    );
    for (const row of applied) {
      const file = migrations[row.id - 1];
      if (!file || file.name !== row.name || file.sha256 !== row.sha256) {
        throw new Error(
          `applied migration ${row.id} (${row.name}) does not match the file on disk — history is immutable`,
        );
      }
    }
    const pending = migrations.slice(applied.length);
    for (const m of pending) {
      log(`applying ${m.name}`);
      await client.query("begin");
      try {
        await client.query(m.sql);
        await client.query(
          "insert into schema_migrations (id, name, sha256) values ($1, $2, $3)",
          [m.id, m.name, m.sha256],
        );
        await client.query("commit");
      } catch (err) {
        await client.query("rollback");
        throw new Error(`migration ${m.name} failed: ${err.message}`, {
          cause: err,
        });
      }
    }
    const tables = [...new Set(pending.flatMap((m) => m.vacuumAfter))];
    const vacuumed = [];
    for (const table of tables) {
      const left = vacuumDeadline - Date.now();
      const result =
        left < VACUUM_AFTER_MIN_MS
          ? { table, skipped: "deadline", command: vacuumCommand(table) }
          : await vacuumAnalyze(client, table, {
              statementMs: Math.min(left, VACUUM_AFTER_BUDGET_MS),
            });
      log(`vacuum after: ${JSON.stringify(result)}`);
      vacuumed.push(result);
    }
    return {
      applied: applied.length,
      ran: pending.length,
      ...(vacuumed.length ? { vacuumed } : {}),
    };
  } finally {
    await client
      .query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY])
      .catch(() => {});
    await client.end();
  }
}
