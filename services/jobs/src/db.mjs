/** The jobs Lambda's one way to a database connection (#814).
 *
 *  A scheduled run used to open a bare `pg.Client` with no timeouts and
 *  no `error` handler. On 2026-11-12 RDS restarted under a run, the run
 *  never learned its connection was gone, and it sat to the 900 s Lambda
 *  timeout holding the function's one reserved slot: every other job
 *  and the deploy's own invoke were throttled for 15 minutes.
 *
 *  Now every run goes through `runJob`, and every connection through
 *  `openJobsClient`:
 *
 *  - connecting gives up after CONNECT_MS;
 *  - each statement has the server's `statement_timeout` for its op, and
 *    the client's `query_timeout` a little past it: the server cancels a
 *    slow statement first (57014, an ordinary error), so the client
 *    timer fires only when the server has stopped answering at all;
 *  - TCP keepalive is on;
 *  - a client `error` (the socket died), a query the server never
 *    answered, or the run's deadline aborts the run: every connection it
 *    opened is destroyed and the run fails with a `jobs_db_aborted`
 *    error naming the op and the cause;
 *  - the run's deadline sits well under the Lambda timeout, so a stuck
 *    run frees the reserved slot. Mail runs read it as their clock
 *    (`runRemainingMs`) and stop taking recipients before it.
 *
 *  Limits are per op (JOB_LIMITS). The statement limit is the op's
 *  longest legitimate statement with room: the minute and five-minute
 *  ticks read a handful of rows; the nightly analytics keep the 300 s
 *  ceiling the function's PGOPTIONS has always given them.
 *  docs/notes/2026-11-14-jobs-fail-fast.md says how each was chosen. */
import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";

/** A new connection that has not finished TLS and auth by now is not
 *  coming: the micro answers in well under a second when it is up. */
export const CONNECT_MS = 10_000;
/** How long past the server's statement_timeout the client waits for
 *  an answer before calling the connection dead. */
export const ANSWER_GRACE_MS = 5_000;
/** How long a goodbye may take before the socket is simply destroyed:
 *  `end()` waits for the server's close, which a dead peer never sends. */
const END_MS = 2_000;
/** The run's deadline stays this far inside the Lambda's own clock, so
 *  the run fails with its own error rather than a bare timeout. */
const LAMBDA_MARGIN_MS = 30_000;

const S = 1000;
const TICK = { statementMs: 30 * S, runMs: 240 * S };
const LIGHT = { statementMs: 60 * S, runMs: 300 * S };
const MAIL = { statementMs: 60 * S, runMs: 600 * S };
const HEAVY = { statementMs: 300 * S, runMs: 600 * S };

/** Per op: the server's statement_timeout and the run's deadline. */
export const JOB_LIMITS = Object.freeze({
  // Every minute or five: a few rows each.
  collector_upgrades: TICK,
  feedback_answers: TICK,
  discord_sittings: TICK,
  home_feeds: TICK,
  // Hourly and by hand: indexed deletes and small reads. The record
  // reader in the Clan run budgets its own reads at 15 s.
  sweep_operational: LIGHT,
  sweep_fleet: LIGHT,
  newsletter_sync: LIGHT,
  clan_evaluate: LIGHT,
  // Retention batches set their own 20 s and 60 s locally, and the run
  // stops itself at 120 s; the session limit sits above both.
  retention_trim: { statementMs: 90 * S, runMs: 300 * S },
  // A mail run is many short statements; it stops taking recipients
  // 90 s before its deadline and the async retry carries on.
  email: MAIL,
  // Whole-table analytics and the payload sweep's anti-join: unchanged
  // from the function's 300 s ceiling until the jobs log shows them
  // shorter.
  sweep_payloads: HEAVY,
  public_stats: HEAVY,
  capture_efficiency: HEAVY,
  shape_census: HEAVY,
  archetype_stamp: HEAVY,
});

/** Limits for a run's ops: the widest of each, so a combined event
 *  (the hourly sweeps, the upgrade drain with feedback answers) never
 *  cuts the heavier op short. Unknown ops take the light limits. */
export function limitsFor(ops) {
  const list = (Array.isArray(ops) ? ops : [ops]).map(
    (op) => JOB_LIMITS[op] ?? LIGHT,
  );
  return {
    statementMs: Math.max(...list.map((l) => l.statementMs)),
    runMs: Math.max(...list.map((l) => l.runMs)),
  };
}

/** The error a run fails with when it is cut off. */
export class JobAbortedError extends Error {
  constructor(op, reason, cause) {
    super(`jobs_db_aborted: ${op}: ${reason}`, cause ? { cause } : undefined);
    this.name = "JobAbortedError";
    this.code = "jobs_db_aborted";
    this.op = op;
  }
}

const current = new AsyncLocalStorage();

/** Ms left before this run's deadline, or null outside a run. */
export function runRemainingMs() {
  const run = current.getStore();
  return run ? Math.max(0, run.deadlineAt - Date.now()) : null;
}

/** Run `fn` as one job: its connections take the op's limits, and it
 *  settles by its deadline whatever it is waiting on. `context` is the
 *  Lambda context (its clock caps the deadline); `limits` overrides the
 *  table, for tests. */
export async function runJob(op, context, fn, { limits } = {}) {
  const ops = Array.isArray(op) ? op : [op];
  const name = ops.join("+");
  const chosen = { ...limitsFor(ops), ...limits };
  const lambdaLeft =
    typeof context?.getRemainingTimeInMillis === "function"
      ? context.getRemainingTimeInMillis() - LAMBDA_MARGIN_MS
      : Infinity;
  const runMs = Math.max(1, Math.min(chosen.runMs, lambdaLeft));
  let fail;
  const aborted = new Promise((_, reject) => (fail = reject));
  aborted.catch(() => {});
  const run = {
    op: name,
    statementMs: chosen.statementMs,
    connectMs: chosen.connectMs ?? CONNECT_MS,
    answerGraceMs: chosen.answerGraceMs ?? ANSWER_GRACE_MS,
    deadlineAt: Date.now() + runMs,
    clients: new Set(),
    error: null,
    abort(error) {
      if (run.error) return;
      run.error = error;
      console.error(
        JSON.stringify({
          event: "jobs_run_aborted",
          op: name,
          error: error.message,
        }),
      );
      for (const c of run.clients) destroy(c);
      fail(error);
    },
  };
  const timer = setTimeout(
    () =>
      run.abort(
        new JobAbortedError(
          name,
          `run passed its ${Math.round(runMs / S)} s deadline`,
        ),
      ),
    runMs,
  );
  try {
    return await Promise.race([current.run(run, fn), aborted]);
  } catch (error) {
    // A query that failed because the run was aborted says why.
    throw run.error ?? error;
  } finally {
    clearTimeout(timer);
    for (const c of run.clients) destroy(c);
  }
}

function destroy(client) {
  try {
    client.connection?.stream?.destroy();
  } catch {
    // already gone
  }
}

/** A connected client with the run's limits (or the named op's, outside
 *  a run). It is a `pg.Client`: `query` and `end` keep their shapes. */
export async function openJobsClient(databaseUrl, { op, limits } = {}) {
  let run = current.getStore();
  if (!run) {
    // Called outside runJob (a test, a migrate op): the same limits and
    // abort, with no deadline but the statement's.
    const chosen = { ...limitsFor(op ?? "unknown"), ...limits };
    run = {
      op: op ?? "unknown",
      statementMs: chosen.statementMs,
      connectMs: chosen.connectMs ?? CONNECT_MS,
      answerGraceMs: chosen.answerGraceMs ?? ANSWER_GRACE_MS,
      clients: new Set(),
      error: null,
      abort(error) {
        if (run.error) return;
        run.error = error;
        for (const c of run.clients) destroy(c);
      },
    };
  }
  if (run.error) throw run.error;
  const client = new pg.Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: run.connectMs,
    statement_timeout: run.statementMs,
    query_timeout: run.statementMs + run.answerGraceMs,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  });
  // Without a listener a dead socket's error would crash the process;
  // with one, it ends the run.
  client.on("error", (error) =>
    run.abort(
      new JobAbortedError(run.op, `connection lost (${error.message})`, error),
    ),
  );
  run.clients.add(client);
  try {
    await client.connect();
  } catch (error) {
    run.clients.delete(client);
    destroy(client);
    const reason = /timeout/i.test(error.message)
      ? `no connection within ${Math.round(run.connectMs / S)} s`
      : `connect failed (${error.message})`;
    throw run.error ?? new JobAbortedError(run.op, reason, error);
  }
  const query = client.query.bind(client);
  client.query = (...args) => {
    if (run.error) return Promise.reject(run.error);
    const pending = query(...args);
    if (typeof pending?.then !== "function") return pending;
    return pending.catch((error) => {
      if (error?.message === "Query read timeout")
        run.abort(
          new JobAbortedError(
            run.op,
            `no answer from the database within ${Math.round((run.statementMs + run.answerGraceMs) / S)} s`,
            error,
          ),
        );
      throw run.error ?? error;
    });
  };
  const end = client.end.bind(client);
  client.end = async () => {
    run.clients.delete(client);
    if (run.error) return destroy(client);
    let timer;
    await Promise.race([
      end().catch(() => {}),
      new Promise((resolve) => {
        timer = setTimeout(() => {
          destroy(client);
          resolve();
        }, END_MS);
      }),
    ]);
    clearTimeout(timer);
  };
  return client;
}
