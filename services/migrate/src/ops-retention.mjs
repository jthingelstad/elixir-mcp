import pg from "pg";
import { retentionDryRun } from "@elixir-mcp/record/retention";
import {
  backfillReadFacts,
  checkReadFacts,
} from "@elixir-mcp/record/read-facts";
import { vacuumAnalyze } from "./vacuum.mjs";

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
 * the receipt trim runs. Writes only the two fact tables, and the batch
 * that reaches done vacuums them.
 */
export async function readFactsBackfillOp(databaseUrl, spec = {}) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query("set statement_timeout = '30s'");
    const result = await backfillReadFacts(db, spec);
    if (!result?.done) return result;
    // A backfill that does not vacuum is not finished (DECISIONS): both
    // tables were filled in bulk after 0259 made them, so until a vacuum
    // they have no visibility map and maybe no statistics. The batch
    // that reaches done runs it, inside the Lambda's 300 s (at most 60 s
    // of budget before this, 90 s per table here).
    const vacuumed = [];
    for (const table of ["admitted_read_day", "battlelog_read_gap"])
      vacuumed.push(await vacuumAnalyze(db, table, { statementMs: 90_000 }));
    return { ...result, vacuumed };
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
