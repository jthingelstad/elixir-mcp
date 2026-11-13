import pg from "pg";
import { retentionDryRun } from "@elixir-mcp/record/retention";
import {
  backfillReadFacts,
  checkReadFacts,
} from "@elixir-mcp/record/read-facts";

/** {retention_dry_run}: what the daily retention trim would delete
 *  today, per declared table, without deleting (a read-only
 *  transaction). The trim itself is the jobs Lambda's
 *  ({retention_trim}, 04:40Z). */
export async function retentionDryRunOp(databaseUrl) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    return await retentionDryRun(db);
  } finally {
    await db.end();
  }
}

/**
 * {read_facts_backfill}: fill 0259's read facts (admitted_read_day,
 * battlelog_read_gap) from the receipts still held, one subject per
 * statement, for `budget_ms` (45 s by default, 60 s at most). Pass the
 * returned `after` back until `done`. Idempotent; must reach done before
 * the receipt trim runs. Writes only the two fact tables.
 */
export async function readFactsBackfillOp(databaseUrl, spec = {}) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query("set statement_timeout = '30s'");
    return await backfillReadFacts(db, spec);
  } finally {
    await db.end();
  }
}

/** {read_facts_check}: what of the held receipts 0259's read facts do
 *  not cover yet; every missing_* is 0 when the backfill is done. A
 *  read-only transaction, 120 s per statement. */
export async function readFactsCheckOp(databaseUrl) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query("begin read only");
    await db.query("set local statement_timeout = '120s'");
    return await checkReadFacts(db);
  } finally {
    await db.query("rollback").catch(() => {});
    await db.end();
  }
}
