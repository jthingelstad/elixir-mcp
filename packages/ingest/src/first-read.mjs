/**
 * How long a newly tracked player waits for their first read (2026-11-09).
 *
 * Home tells a person who adds their player that "the first read usually
 * lands within a few minutes"; this line is what measures it, from
 * natural traffic. Ingest already knows, from reads it makes anyway, when
 * an admission is the first of its kind for a tag: the profile projector
 * found no earlier profile observation (snapshots.mjs `firstProfile`), and
 * the battle log projector found no high-water mark and wrote one
 * (battles.mjs `firstLog`). Only then does this run, and it makes one
 * query: the subject's active player recording (unique partial index
 * `recording_one_active_per_subject`) and the job by primary key.
 *
 * The recording's created_at is when the first account still tracking the
 * player added it: an active player recording exists exactly while a claim
 * counts (packages/claims `reconcileRecording`), and is started by the first
 * one. No active recording means nobody tracks the tag (a clan member read
 * for a tracked clan, say), and nothing is logged.
 *
 * The line carries no tag, account or email: endpoint, lane and seconds.
 * Never throws and is run after the admission has committed: a failure
 * here is one error line, never a failed or retried submission.
 */

/** The first admission of `endpoint` for `entityKey`, if the projection
 *  says this one was it. */
export function isFirstRead(endpoint, projection) {
  if (endpoint === "player") return projection?.snapshot?.firstProfile === true;
  if (endpoint === "player_battlelog") return projection?.firstLog === true;
  return false;
}

const round1 = (v) =>
  v === null || v === undefined || !Number.isFinite(Number(v))
    ? null
    : Math.round(Number(v) * 10) / 10;

/**
 * Log `first_read_landed` for a tracked player's first admitted profile or
 * battle log. `log` is injectable for tests; production writes a
 * structured object, which the native runtime nests under `message`.
 */
export async function logFirstRead(
  db,
  { endpoint, entityKey, jobId, lane },
  log = console.info,
) {
  try {
    const {
      rows: [r],
    } = await db.query(
      `select extract(epoch from now() - r.created_at)::float8 as from_tracked,
              extract(epoch from now() - j.created_at)::float8 as from_minted,
              extract(epoch from j.leased_at - j.created_at)::float8 as queued
         from recording r
         left join job j on j.job_id = $2::bigint
        where r.subject_type = 'player' and r.subject_tag = $1
          and r.status = 'active'`,
      [entityKey, Number.isInteger(jobId) ? jobId : null],
    );
    if (!r) return false;
    log({
      event: "first_read_landed",
      endpoint,
      lane: lane ?? null,
      seconds_from_tracked: round1(r.from_tracked),
      seconds_from_minted: round1(r.from_minted),
      seconds_queued: round1(r.queued),
    });
    return true;
  } catch (err) {
    console.error("first_read_timing_failed", endpoint, err?.message);
    return false;
  }
}
