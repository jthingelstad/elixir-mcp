/**
 * Table maintenance and backend diagnostics. ({deck_census}, the played
 * card projections' census, retired with their tables in 0256.)
 *
 *   {rewrite_table: "battle_participant"}
 *     VACUUM FULL one named table - the space a dropped column (0097) or
 *     a purge (2026-10-07) held comes back only with a rewrite, and a
 *     rewrite takes an exclusive lock for its duration, so it is a
 *     deliberate op, never a migration. Collector submits block and retry
 *     meanwhile. Statement and lock timeouts keep it inside one Lambda.
 *
 *   {backends: true}, {terminate_backends: {...}}
 *     What this user's connections are doing, and the lever to end one.
 *
 * The one-time backfill from the deck JSON (deck_backfill, deck_forms)
 * ran on 2026-09-15 (454,654 participants, 90 batches) and left with the
 * column in 0097; tests seed the rows directly (packages/tools/test/deck-rows.mjs).
 */

import pg from "pg";

/** The tables {rewrite_table} may name: a closed list, because the op
 *  takes the name into SQL. battle_participant held 0097's dropped
 *  column, and with deck, 0255's array fill; the rest carry the
 *  2026-10-07 purge's dead space. (0091's two card tables left the list
 *  when 0256 dropped them.) */
const REWRITABLE = new Set([
  "battle_participant",
  "battle",
  "battle_participant_round",
  "deck",
  "player",
  "player_snapshot_daily",
  "player_daily_battle_rollup",
  "player_badge",
  "api_receipt",
  "mcp_call_audit",
  "capture_audit",
  "job",
]);

/** The migrate Lambda times out at 300 s (MigrateFunction in
 *  infra/template.yaml). The statement stops at 240 s, so the Lambda
 *  outlives it and answers; a VACUUM FULL the Lambda outlived would keep
 *  its ACCESS EXCLUSIVE lock after the Lambda died (2026-09-15). A
 *  cancelled VACUUM FULL drops its new copy and leaves the table as it
 *  was. The lock timeout is short because a waiting ACCESS EXCLUSIVE
 *  request queues every later read and write of the table behind it:
 *  10 s waits out an ordinary submit or door read, and past that the op
 *  gives up rather than stall the table. */
export const REWRITE_TIMEOUTS = Object.freeze({
  statementMs: 240_000,
  lockMs: 10_000,
});

/**
 * @param {string} databaseUrl
 * @param {string | {table: string}} spec
 * @param {{statementMs: number, lockMs: number}} [timeouts] tests only
 */
export async function rewriteTable(
  databaseUrl,
  spec,
  timeouts = REWRITE_TIMEOUTS,
) {
  const table = String(spec?.table ?? spec ?? "");
  if (!REWRITABLE.has(table))
    throw new Error(`rewrite_table: not one of ${[...REWRITABLE].join(", ")}`);
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const size = async () =>
      (
        await db.query(
          `select pg_total_relation_size(c.oid)::bigint as bytes,
                  pg_relation_size(c.oid)::bigint as heap,
                  pg_indexes_size(c.oid)::bigint as indexes,
                  c.reltuples::bigint as rows
             from pg_class c where c.oid = $1::regclass`,
          [table],
        )
      ).rows[0];
    const before = await size();
    const timeoutsOut = {
      statement_timeout_ms: timeouts.statementMs,
      lock_timeout_ms: timeouts.lockMs,
    };
    await db.query(`set statement_timeout = ${Number(timeouts.statementMs)}`);
    await db.query(`set lock_timeout = ${Number(timeouts.lockMs)}`);
    const started = Date.now();
    try {
      await db.query(`vacuum (full, analyze) ${pg.escapeIdentifier(table)}`);
    } catch (error) {
      // 55P03: the lock was not granted in time; 57014: the statement
      // timeout cancelled the rewrite. Either way the table is unchanged.
      return {
        error: "rewrite_failed",
        table,
        code: error.code ?? null,
        message: error.message,
        ms: Date.now() - started,
        before,
        timeouts: timeoutsOut,
      };
    }
    const ms = Date.now() - started;
    await db.query("reset statement_timeout");
    const after = await size();
    return {
      table,
      ms,
      before,
      after,
      freed_bytes: before.bytes - after.bytes,
      timeouts: timeoutsOut,
    };
  } finally {
    await db.end();
  }
}

/** The least a backend's query must have run before {terminate_backends}
 *  may end it: five minutes, the incident authority's line (DECISIONS:
 *  "holding its query past five minutes (named, never `true`)"). */
const TERMINATE_FLOOR_S = 300;

/** A LIKE pattern names a query when something other than wildcards is
 *  left: `%`, `%%` or `_` would match every backend. */
function namesAQuery(like) {
  return typeof like === "string" && like.replace(/[%_\s]/g, "").length >= 4;
}

/** {terminate_backends: {like: "%<query text>%", older_than_s?: 300,
 *  application_name?: "elixir-mcp-jobs"}}
 *  Terminate THIS user's own backends whose current query matches, has
 *  run longer than the threshold, and (when given) whose application_name
 *  is the one named, or starts with it and a colon (the migrate ops name
 *  themselves `elixir-mcp-migrate:<op>`): the orphan a killed Lambda
 *  leaves behind, still holding its locks (2026-09-15 07:00 CDT: 0099's
 *  unbatched backfill outlived the 300 s ceiling and every connection
 *  queued behind its ACCESS EXCLUSIVE lock until the pool was gone).
 *  `true`, or no `like` that names a query, is refused before connecting:
 *  every service connects as the same user, so a loose pattern ends live
 *  door queries too. The threshold's floor is 300 s.
 *  pg_terminate_backend on one's own backends needs no superuser. */
export async function terminateBackends(databaseUrl, spec) {
  if (!spec || typeof spec !== "object" || !namesAQuery(spec.like))
    return {
      error: "named_query_required",
      message:
        'Name the query: {"terminate_backends": {"like": "%<query text>%", "application_name": "<from {backends}>"}}. `true` and a pattern of wildcards are refused; read {backends} first.',
    };
  const like = spec.like;
  const olderThan = Math.max(
    TERMINATE_FLOOR_S,
    Number(spec.older_than_s ?? TERMINATE_FLOOR_S) || TERMINATE_FLOOR_S,
  );
  const app =
    spec.application_name === undefined || spec.application_name === null
      ? null
      : String(spec.application_name);
  let lastErr = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const db = new pg.Client({ connectionString: databaseUrl });
    try {
      await db.connect();
      const { rows } = await db.query(
        `select pid, application_name, state, now() - query_start as running,
                left(query, 80) as query, pg_terminate_backend(pid) as terminated
         from pg_stat_activity
         where usename = current_user and pid <> pg_backend_pid()
           and query ilike $1
           and query_start < now() - make_interval(secs => $2)
           and ($3::text is null or application_name = $3
                or starts_with(application_name, $3 || ':'))`,
        [like, olderThan, app],
      );
      return {
        attempt,
        like,
        older_than_s: olderThan,
        application_name: app,
        terminated: rows,
      };
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 5000));
    } finally {
      await db.end().catch(() => {});
    }
  }
  throw lastErr;
}

/** {backends: true} or {backends: {application_name: "elixir-mcp-jobs"}}
 *  - read-only: what every connection is doing, grouped by
 *  application_name (each function names its connections: PGAPPNAME in
 *  infra/template.yaml, and `elixir-mcp-migrate:<op>` per op), then each
 *  backend, optionally only those whose application_name is the one named
 *  or starts with it and a colon. `as` is the name this op's own
 *  connection carried. */
export async function listBackends(databaseUrl, spec = {}) {
  const app =
    spec?.application_name === undefined || spec?.application_name === null
      ? null
      : String(spec.application_name);
  let lastErr = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const db = new pg.Client({ connectionString: databaseUrl });
    try {
      await db.connect();
      const { rows } = await db.query(
        `select pid, usename, application_name, state, wait_event_type, wait_event,
                to_char(now() - coalesce(query_start, backend_start), 'HH24:MI:SS') as age,
                left(regexp_replace(query, '\\s+', ' ', 'g'), 100) as query
         from pg_stat_activity
         where datname = current_database() and pid <> pg_backend_pid()
           and ($1::text is null or application_name = $1
                or starts_with(application_name, $1 || ':'))
         order by application_name, query_start nulls last`,
        [app],
      );
      const byApplication = {};
      for (const r of rows) {
        const key = r.application_name || "(unnamed)";
        const g = (byApplication[key] ??= { backends: 0, active: 0 });
        g.backends += 1;
        if (r.state === "active") g.active += 1;
        if (r.state === "idle in transaction")
          g.idle_in_transaction = (g.idle_in_transaction ?? 0) + 1;
      }
      const {
        rows: [limits],
      } = await db.query(
        `select current_setting('max_connections')::int as max_connections,
                (select count(*)::int from pg_stat_activity) as connections,
                current_setting('application_name') as as`,
      );
      return {
        attempt,
        ...limits,
        application_name: app,
        by_application: byApplication,
        backends: rows,
      };
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 5000));
    } finally {
      await db.end().catch(() => {});
    }
  }
  throw lastErr;
}
