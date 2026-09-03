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
    });
  }
  return migrations;
}

export async function migrate({ databaseUrl, migrationsDir, log = () => {} }) {
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
    return { applied: applied.length, ran: pending.length };
  } finally {
    await client
      .query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY])
      .catch(() => {});
    await client.end();
  }
}
