/**
 * The Postgres job ledger (0040) — work distribution without SQS.
 * The scheduler enqueues in the same transaction it plans; the
 * collector door leases with SKIP LOCKED; expiry is a timestamp;
 * dead-lettering is a status. One queued row per subject by
 * construction (partial unique index), so re-planning is idempotent
 * and a live request UPGRADES a queued bulk row instead of racing it.
 */

const LEASE_TTL_S = 90;
const MAX_ATTEMPTS = 5;

/** A failed fetch is retried RETRY_BASE_MINUTES later, doubling for up to
 *  RETRY_MAX_TRIES tries (15, 30, 60 minutes), then the subject waits for
 *  its own cadence; the next cadence plan or an admission resets the count
 *  (0188; review 2026-09-27 §2.6). */
const RETRY_BASE_MINUTES = 15;
const RETRY_MAX_TRIES = 3;

/**
 * Owe a retry to each poll subject whose fetch failed: a non-404 fetch
 * error (ingest) or a job that died (the settler). Until 0188 the failed
 * plan's last_planned_at stood, so the retry waited a whole cadence: a
 * profile a day, and a daily board that errored at the 10:05Z tick the
 * next board day. The planner treats the row as due once retry_at has
 * passed and the next plan clears it; the retry is planned and charged
 * like any other plan, and freshness still moves only on admission, which
 * clears both columns. A key with no poll_state row (a live-only fetch)
 * changes nothing.
 * @param {{ endpoint: string, subject_tag: string }[]} keys
 * @param {Date|string|null} at when the failure happened; null for now()
 */
export async function stampRetry(db, keys, at = null) {
  if (!keys.length) return 0;
  const { rowCount } = await db.query(
    `update poll_state ps set
       retry_at = case when ps.retry_tries < $4
         then coalesce($3::timestamptz, now())
              + make_interval(mins => $5 * power(2, ps.retry_tries)::int)
         end,
       retry_tries = least(ps.retry_tries + 1, $4)
     from unnest($1::text[], $2::text[]) as k(subject_tag, endpoint)
     where ps.subject_tag = k.subject_tag and ps.endpoint = k.endpoint`,
    [
      keys.map((k) => k.subject_tag),
      keys.map((k) => k.endpoint),
      at,
      RETRY_MAX_TRIES,
      RETRY_BASE_MINUTES,
    ],
  );
  return rowCount ?? 0;
}

/** Insert or upgrade a job. Live beats bulk; nothing downgrades. */
export async function enqueueJob(db, { endpoint, entity_key, lane }) {
  const { rows } = await db.query(
    `insert into job (endpoint, entity_key, lane)
     values ($1, $2, $3)
     on conflict (endpoint, entity_key) where status = 'queued'
       do update set lane = case
         when excluded.lane = 'live' or job.lane = 'live' then 'live'
         else 'bulk' end
     returning job_id, lane, (xmax = 0) as inserted`,
    [endpoint, entity_key, lane],
  );
  return rows[0];
}

/** Add `n` to the hour's charge row for a lane (budget_charge, 0187):
 *  what the one budget spent, which the status page reads. */
export async function recordCharge(db, lane, n, at = null) {
  await db.query(
    `insert into budget_charge (hour, lane, charged)
     values (date_trunc('hour', coalesce($3::timestamptz, now())), $1, $2)
     on conflict (hour, lane) do update set charged = budget_charge.charged + excluded.charged`,
    [lane, n, at],
  );
}

/** The scheduler's tick, in minutes (SchedulerTickMinutes). */
function tickMinutes() {
  const m = Number(process.env.SCHEDULER_TICK_MINUTES ?? 5);
  return m > 0 ? m : 5;
}

/**
 * Charge one token from the one global bucket for a live job about to be
 * minted (review 2026-09-27 §4.1). Until then live mints never touched the
 * bucket, so the live reserve was only the planner abstaining and the
 * per-account daily caps were the only bound on the live lane. Atomic: the
 * row is decremented only while a whole token is left, so concurrent
 * mints cannot overdraw it. The bucket refills at the scheduler tick, so
 * with no token left the answer is when the next tick should have run
 * (`retry_after_s`, at least 15 s), and nothing is charged.
 */
export async function takeLiveToken(db) {
  const { rows } = await db.query(
    `update budget_state set tokens = tokens - 1 where tokens >= 1
     returning tokens`,
  );
  if (rows.length) {
    await recordCharge(db, "live", 1);
    return { ok: true };
  }
  const {
    rows: [b],
  } = await db.query(
    `select ceil(extract(epoch from
               settled_at + make_interval(mins => $1) - now()))::int as s
     from budget_state`,
    [tickMinutes()],
  );
  // Ten seconds for the tick itself to run once it fires.
  return { ok: false, retry_after_s: Math.max(15, (b?.s ?? 0) + 10) };
}

/** Give back a token taken for a mint that did not happen (the per-account
 *  quota refused it, or another caller's job got there first). */
export async function refundLiveToken(db) {
  await db.query("update budget_state set tokens = tokens + 1");
  await recordCharge(db, "live", -1);
}

/**
 * Settle expired leases in ONE transaction: requeue (bounded retries),
 * dead the exhausted, fold the redundant — and charge every abandoned
 * lease to its gateway's missed_streak exactly once, regardless of
 * which actor settles (scheduler or any collector; issue #6). Requeue
 * picks at most ONE lease per subject, deterministically, so two leases
 * for one subject expiring together can never race the
 * one-queued-per-subject index (issue #2); the other folds.
 *
 * Requeue is an in-place UPDATE so job_id is stable across retries —
 * the live waiter binds to it (issue #3). The residual physical race
 * (an enqueue committing a queued twin between our snapshot and the
 * index insert) surfaces as 23505; we retry once, and the twin makes
 * the lease fold instead. Callers run this on an autocommit
 * connection: it opens its own transaction.
 */
export async function settleLeases(db) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await settleOnce(db);
    } catch (err) {
      if (err?.code === "23505" && attempt === 0) continue;
      throw err;
    }
  }
}

async function settleOnce(db) {
  await db.query("begin");
  try {
    const expired = `status = 'leased' and leased_at < now() - make_interval(secs => $1)`;
    const { rows: requeuedRows } = await db.query(
      `with picked as (
         select distinct on (endpoint, entity_key) job_id, leased_by
         from job
         where ${expired} and attempts < $2
           and not exists (select 1 from job q
                           where q.endpoint = job.endpoint
                             and q.entity_key = job.entity_key
                             and q.status = 'queued')
         order by endpoint, entity_key, attempts, job_id)
       update job set status = 'queued', leased_at = null, leased_by = null
       from picked
       where job.job_id = picked.job_id and job.status = 'leased'
       returning picked.leased_by`,
      [LEASE_TTL_S, MAX_ATTEMPTS],
    );
    const { rows: diedRows } = await db.query(
      `update job set status = 'dead', done_at = now()
       where ${expired} and attempts >= $2
         and not exists (select 1 from job q
                         where q.endpoint = job.endpoint
                           and q.entity_key = job.entity_key
                           and q.status = 'queued')
       returning leased_by, endpoint, entity_key`,
      [LEASE_TTL_S, MAX_ATTEMPTS],
    );
    // A dead job is a failed fetch: owe its subject a retry (0188). The
    // planner's jobs carry the poll_state key as their entity_key.
    await stampRetry(
      db,
      diedRows.map((r) => ({
        endpoint: r.endpoint,
        subject_tag: r.entity_key,
      })),
    );
    // Whatever is still expired-and-leased is redundant (a queued twin
    // exists, or it lost the one-per-subject pick): it just closes.
    const { rows: foldedRows } = await db.query(
      `update job set status = 'done', done_at = now()
       where ${expired}
       returning leased_by`,
      [LEASE_TTL_S],
    );
    // Exactly-once attribution: each expired lease transitioned in
    // exactly one statement above, and each carried its abandoning
    // gateway out with it.
    const abandoned = [...requeuedRows, ...diedRows, ...foldedRows]
      .map((r) => r.leased_by)
      .filter(Boolean);
    if (abandoned.length) {
      await db.query(
        `update gateway g set missed_streak = g.missed_streak + c.n
         from (select gid, count(*)::int as n
               from unnest($1::uuid[]) as gid group by gid) c
         where g.gateway_id = c.gid`,
        [abandoned],
      );
    }
    await db.query("commit");
    return {
      requeued: requeuedRows.length,
      died: diedRows.length,
      folded: foldedRows.length,
      missed: abandoned.length,
    };
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  }
}

/** Lease the next job for a collector. lanes ordered live-first for
 *  live-channel collectors; bulk-only for operators. */
export async function leaseJob(db, { gatewayId, lanes }) {
  const { rows } = await db.query(
    `update job set status = 'leased', leased_at = now(),
            leased_by = $1, attempts = attempts + 1
     where job_id = (
       select job_id from job
       where status = 'queued' and lane = any($2)
       order by (lane = 'live') desc, job_id
       limit 1
       for update skip locked)
     returning job_id, endpoint, entity_key, lane`,
    [gatewayId, lanes],
  );
  return rows[0] ?? null;
}

/** Close a lease. Only the leasing gateway may complete its job. */
export async function completeJob(db, { jobId, gatewayId }) {
  const { rowCount } = await db.query(
    `update job set status = 'done', done_at = now()
     where job_id = $1 and leased_by = $2 and status = 'leased'`,
    [jobId, gatewayId],
  );
  return rowCount === 1;
}

/** Ledger health for the status page and metrics. */
export async function ledgerStats(db) {
  const { rows } = await db.query(
    `select
       count(*) filter (where status = 'queued' and lane = 'bulk')::int as queued_bulk,
       count(*) filter (where status = 'queued' and lane = 'live')::int as queued_live,
       count(*) filter (where status = 'leased')::int as leased,
       count(*) filter (where status = 'dead')::int as dead,
       coalesce(extract(epoch from now() - min(created_at)
         filter (where status = 'queued'))::int, 0) as oldest_queued_s
     from job`,
  );
  // The recorder's pace and the fleet, for the dashboard (2026-09-17):
  // fetches admitted in the last hour against the budget's hourly
  // ceiling, the bucket's tokens now, collectors heard in the last five
  // minutes, collectors draining, fetch errors in the hour. The backfill
  // gateway's receipts are history landing, not pace, and are excluded
  // as the probe excludes them. Each is an index range or a tiny table.
  const { rows: pace } = await db.query(
    `select
       (select count(*)::int from api_receipt r join gateway g on g.gateway_id = r.gateway_id
         where r.fetched_at > now() - interval '1 hour'
           and g.name <> 'backfill-elixir-bot') as fetches_hour,
       (select count(*)::int from collector_fetch_error
         where fetched_at > now() - interval '1 hour') as fetch_errors_hour,
       (select round(rate_per_sec * 3600)::int from budget_state) as ceiling_hour,
       (select tokens::float from budget_state) as tokens,
       (select count(*)::int from gateway
         where status = 'active' and last_heartbeat_at > now() - interval '5 minutes') as collectors_active,
       (select count(*)::int from gateway where status = 'draining') as collectors_draining`,
  );
  return { ...rows[0], ...pace[0] };
}
