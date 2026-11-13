import pg from "pg";
import { retentionDryRun } from "@elixir-mcp/record/retention";

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
