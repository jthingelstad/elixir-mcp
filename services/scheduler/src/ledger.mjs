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

/** Insert or upgrade a job. Live beats bulk; nothing downgrades. */
export async function enqueueJob(db, { endpoint, entity_key, lane }) {
  const { rows } = await db.query(
    `insert into job (endpoint, entity_key, lane)
     values ($1, $2, $3)
     on conflict (endpoint, entity_key) where status = 'queued'
       do update set lane = case
         when excluded.lane = 'live' or job.lane = 'live' then 'live'
         else 'bulk' end
     returning job_id, lane`,
    [endpoint, entity_key, lane],
  );
  return rows[0];
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
       returning leased_by`,
      [LEASE_TTL_S, MAX_ATTEMPTS],
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
  return rows[0];
}
