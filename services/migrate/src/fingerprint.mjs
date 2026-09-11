/**
 * Schema fingerprint — DESIGN §11.1 (elixir-bot's pattern, kept).
 *
 * Dumps a normalized description of the public schema (tables, columns,
 * types, nullability, defaults, and index definitions) and hashes it.
 * A committed fingerprint file pins the semantic contract; the test
 * asserts the migration ladder reproduces it exactly, so drift between
 * "what the ladder builds" and "what we think the schema is" cannot land
 * silently.
 */

import { createHash } from "node:crypto";
import pg from "pg";

// Ordered in "C" collation, never the database's default: a Homebrew
// Postgres and the CI container sort battle_observation and
// battlelog_high_water in opposite orders under their own locales, and
// the pin disagreed with itself for half a day (2026-09-11).
async function schemaDescription(databaseUrl) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows: columns } = await client.query(`
      select table_name, column_name, data_type, is_nullable, column_default
      from information_schema.columns
      where table_schema = 'public' and table_name <> 'schema_migrations'
      order by table_name collate "C", column_name collate "C"`);
    const { rows: indexes } = await client.query(`
      select indexname, indexdef
      from pg_indexes
      where schemaname = 'public' and tablename <> 'schema_migrations'
      order by indexname collate "C"`);
    const { rows: constraints } = await client.query(`
      select conrelid::regclass::text as table_name, conname, pg_get_constraintdef(oid) as def
      from pg_constraint
      where connamespace = 'public'::regnamespace
        and conrelid::regclass::text <> 'schema_migrations'
      order by conrelid::regclass::text collate "C", conname collate "C"`);
    return { columns, indexes, constraints };
  } finally {
    await client.end();
  }
}

export async function schemaFingerprint(databaseUrl) {
  const description = await schemaDescription(databaseUrl);
  const canonical = JSON.stringify(description);
  return createHash("sha256").update(canonical).digest("hex");
}
