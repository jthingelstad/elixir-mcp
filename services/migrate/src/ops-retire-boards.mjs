import pg from "pg";
import { reconcileRecording } from "@elixir-mcp/claims";
import {
  retireJobs,
  hasRetiredJobs,
  RECORDING_CUTOVER_LOCK,
} from "@elixir-mcp/ledger";

/** Retire the former board sync key, never its owner or sibling credentials. */
async function retireBoardCredential(db, spec) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec))
    throw new Error("board credential retirement needs a specification");
  const apply = spec.apply === true;
  if (apply && !/^[1-9][0-9]*$/.test(String(spec.expected_token_id ?? "")))
    throw new Error("board credential retirement needs its exact token id");
  await db.query("begin");
  try {
    if (apply)
      await db.query("select pg_advisory_xact_lock(hashtext($1))", [
        RECORDING_CUTOVER_LOCK,
      ]);
    const rows = (
      await db.query(
        `select t.token_id,t.name,t.account_id,t.audience,t.created_at,t.last_used_at,t.revoked_at,
              a.public_id as account_ref,a.role as account_role
       from service_token t join account a using(account_id)
       where t.name='collection-updater' and ($1::bigint is null or t.token_id=$1)
       order by t.token_id desc for update of t`,
        [apply ? spec.expected_token_id : null],
      )
    ).rows;
    const publicMetadata = (token) =>
      Object.fromEntries(
        Object.entries(token).filter(([key]) => key !== "account_id"),
      );
    if (!apply) {
      await db.query("rollback");
      return { credentials: rows.map(publicMetadata), applied: false };
    }
    const token = rows[0];
    const metadata = token ? publicMetadata(token) : null;
    if (
      !token ||
      String(token.token_id) !== String(spec.expected_token_id) ||
      token.audience !== "mcp"
    )
      throw new Error("board credential changed; read it again");
    if (
      (
        await db.query(
          "select 1 from ranking_board where enabled or record_top <> 0 or reread_at is not null limit 1",
        )
      ).rowCount
    )
      throw new Error("global boards must retire before their sync credential");
    const changed = await db.query(
      "update service_token set revoked_at=now() where token_id=$1 and revoked_at is null returning revoked_at",
      [token.token_id],
    );
    if (changed.rowCount)
      await db.query(
        "insert into account_event(account_id,kind,detail) values($1,'service_token_revoked',$2::jsonb)",
        [
          token.account_id,
          JSON.stringify({
            token_id: String(token.token_id),
            name: token.name,
            by: "operator",
            reason: "global board capture retired",
          }),
        ],
      );
    await db.query("commit");
    return {
      credential: {
        ...metadata,
        revoked_at: changed.rows[0]?.revoked_at ?? token.revoked_at,
      },
      applied: true,
      revoked: changed.rowCount,
    };
  } catch (error) {
    await db.query("rollback").catch(() => {});
    throw error;
  }
}

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
    if (spec.credential !== undefined)
      return await retireBoardCredential(db, spec.credential);
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
