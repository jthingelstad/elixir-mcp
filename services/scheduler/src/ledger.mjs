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

/** Requeue expired leases (bounded retries), dead the exhausted. */
export async function settleLeases(db) {
  const { rowCount: requeued } = await db.query(
    `update job set status = 'queued', leased_at = null, leased_by = null
     where status = 'leased'
       and leased_at < now() - make_interval(secs => $1)
       and attempts < $2
       -- the one-queued-per-subject index must hold: if a NEWER queued
       -- row exists for the subject, this stale lease is redundant.
       and not exists (select 1 from job q
                       where q.endpoint = job.endpoint
                         and q.entity_key = job.entity_key
                         and q.status = 'queued')`,
    [LEASE_TTL_S, MAX_ATTEMPTS],
  );
  const { rowCount: died } = await db.query(
    `update job set status = 'dead', done_at = now()
     where status = 'leased'
       and leased_at < now() - make_interval(secs => $1)
       and attempts >= $2`,
    [LEASE_TTL_S, MAX_ATTEMPTS],
  );
  // Expired-but-redundant leases (a queued twin already exists) just close.
  const { rowCount: folded } = await db.query(
    `update job set status = 'done', done_at = now()
     where status = 'leased'
       and leased_at < now() - make_interval(secs => $1)`,
    [LEASE_TTL_S],
  );
  return { requeued, died, folded };
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
