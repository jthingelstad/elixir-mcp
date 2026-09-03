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

async function schemaDescription(databaseUrl) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows: columns } = await client.query(`
      select table_name, column_name, data_type, is_nullable, column_default
      from information_schema.columns
      where table_schema = 'public' and table_name <> 'schema_migrations'
      order by table_name, column_name`);
    const { rows: indexes } = await client.query(`
      select indexname, indexdef
      from pg_indexes
      where schemaname = 'public' and tablename <> 'schema_migrations'
      order by indexname`);
    const { rows: constraints } = await client.query(`
      select conrelid::regclass::text as table_name, conname, pg_get_constraintdef(oid) as def
      from pg_constraint
      where connamespace = 'public'::regnamespace
        and conrelid::regclass::text <> 'schema_migrations'
      order by table_name, conname`);
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
