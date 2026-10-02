import pg from "pg";
import { reconcileRecording } from "@elixir-mcp/claims";
import {
  retireJobs,
  hasRetiredJobs,
  RECORDING_CUTOVER_LOCK,
} from "@elixir-mcp/ledger";

/** Bounded reversible capture cutover. No game facts, membership provenance
 * or archived payloads are removed. Preview uses the same reason evaluator. */
export async function retireBoardRecordings(
  databaseUrl,
  spec = {},
  suppliedDb = null,
) {
  const limit = Math.min(
    200,
    Math.max(1, Math.trunc(Number(spec.limit) || 100)),
  );
  const apply = spec.apply === true;
  const jobLimit = Math.min(
    2000,
    Math.max(1, Math.trunc(Number(spec.job_limit) || 1000)),
  );
  const db = suppliedDb ?? new pg.Client({ connectionString: databaseUrl });
  if (!suppliedDb) await db.connect();
  try {
    const { rows } = await db.query(
      `select subject_type, subject_tag, subject_type || ':' || subject_tag as cursor
       from recording where status = 'active'
         and subject_type || ':' || subject_tag > $1
       order by subject_type, subject_tag limit $2`,
      [String(spec.after ?? ""), limit + 1],
    );
    const batch = rows.slice(0, limit);
    const result = {
      preview: !apply,
      checked: batch.length,
      stopped: 0,
      retained: 0,
      boards_disabled: 0,
      retired_jobs: 0,
      done: rows.length <= limit,
      next_after: rows.length > limit ? batch.at(-1).cursor : null,
    };
    if (apply) {
      await db.query("begin");
      // Drain in-flight fleet admission before changing recording authority.
      await db.query("select pg_advisory_xact_lock(hashtext($1))", [
        RECORDING_CUTOVER_LOCK,
      ]);
    }
    try {
      if (apply) {
        const disabled = await db.query(`update ranking_board
          set enabled = false, record_top = 0, reread_at = null
          where enabled or record_top <> 0 or reread_at is not null`);
        result.boards_disabled = disabled.rowCount;
      }
      for (const r of batch) {
        if (apply)
          await db.query("select pg_advisory_xact_lock(hashtext($1))", [
            r.subject_tag,
          ]);
        const disposition = await reconcileRecording(
          db,
          r.subject_type,
          r.subject_tag,
          null,
          { dryRun: !apply },
        );
        if (disposition.stopped) result.stopped++;
        else result.retained++;
      }
      if (apply) {
        result.retired_jobs = await retireJobs(db, { limit: jobLimit });
        result.retired_jobs_pending = await hasRetiredJobs(db);
        if (result.retired_jobs_pending) {
          result.done = false;
          result.next_after = batch.at(-1)?.cursor ?? String(spec.after ?? "");
        }
        await db.query("commit");
      }
      return result;
    } catch (error) {
      if (apply) await db.query("rollback");
      throw error;
    }
  } finally {
    if (!suppliedDb) await db.end();
  }
}
