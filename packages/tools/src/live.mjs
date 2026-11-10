import { isRetiredRecordingEndpoint } from "@elixir-mcp/contracts";
import { RACE_MATCHMAKING } from "@elixir-mcp/ingest/admission";
/**
 * The live lane, asynchronous (2026-09-11; review §9.2 / §10, Jamie:
 * "async live_fetch would be really smart").
 *
 * `live: true` means: answer from a read of the game no older than the
 * API's own cache if one is in hand; otherwise queue ONE priority fetch
 * and answer now with `pending` and when to call again. Nothing waits on
 * a collector inside a call. Every collector in the fleet picks up
 * priority work - there is no live channel - and a queued live fetch is
 * charged once, when it is minted, never on the follow-up call that
 * finds it landed.
 *
 * Why freshness rather than job binding: the CR API serves a cached copy
 * for max-age seconds (60 s for players, battle logs and boards; 120 s
 * for clans and the river race - cr-agent-api-docs), so a receipt inside
 * that window IS what a new fetch would return, whichever lane fetched it.
 *
 * A minted live job is charged one token from the one global bucket,
 * before the per-account quota. With no token
 * left nothing is minted and nothing is charged: the answer is `pending`
 * with `queued: false` and `retry_after_s` at the next scheduler tick,
 * when the bucket refills.
 *
 * `record: false` is live_fetch's read (Jamie, 2026-10-08: "live_fetch
 * should ONLY live fetch and not record data"; 0209). Its job is minted
 * fetch-only, and the result waits in `live_fetch_result`, outside the
 * record: no projection, receipt, archive or freshness. Any read inside
 * the cache window answers it, a recorded one included. A recording read
 * never counts a fetch-only result as fresh (the record did not move),
 * and turns a fetch-only open job into a recording one.
 *
 * A race read that found the race in matchmaking (RACE_MATCHMAKING: the
 * minute or two after a season roll when the race exists without a
 * clan) is a fresh answer of its own, `reason: "matchmaking"`: no race
 * yet. It is not a rejection, and asking again inside the cache window
 * answers the same without minting another fetch.
 */

import {
  takeLiveToken,
  refundLiveToken,
  recordOpenJob,
} from "@elixir-mcp/ledger";
import { poolLimits, poolOwner } from "@elixir-mcp/claims";

/** The API's cache-control max-age per endpoint, in seconds. */
const MAX_AGE_S = {
  clan: 120,
  currentriverrace: 120,
  riverracelog: 120,
};
const DEFAULT_MAX_AGE_S = 60;

/** Seconds until a read fetched at `fetchedAt` leaves the API's cache
 *  window, so the next ask can mint a new fetch (at least 15). */
function cacheLeftS(fetchedAt, maxAgeS) {
  const left = Math.ceil(
    (fetchedAt.getTime() + maxAgeS * 1000 - Date.now()) / 1000,
  );
  return Math.max(15, left);
}

export function makeLive({
  enqueue,
  retryAfterS = 15,
  charge = takeLiveToken,
  refund = refundLiveToken,
  markRecord = recordOpenJob,
}) {
  return async function liveFetch(
    db,
    {
      endpoint,
      entityKey,
      needPayload = false,
      record = true,
      beforeMint = async () => {},
    },
  ) {
    if (isRetiredRecordingEndpoint(endpoint))
      return { ok: false, reason: "live_unavailable" };
    const maxAge = MAX_AGE_S[endpoint] ?? DEFAULT_MAX_AGE_S;
    const recorded = `select r.admission, r.admission_errors, r.fetched_at, p.payload_json
       from api_receipt r
       left join api_payload p on p.endpoint = r.endpoint
         and p.entity_key = r.entity_key and p.payload_hash = coalesce(r.replay_payload_hash,r.payload_hash)
       where r.endpoint = $1 and r.entity_key = $2 and r.replay_retired_at is null
         and r.fetched_at >= now() - make_interval(secs => $3)`;
    const { rows: fresh } = await db.query(
      record === false
        ? `select * from (${recorded}
           union all
           select f.admission, f.admission_errors, f.fetched_at, f.payload_json
             from live_fetch_result f
            where f.endpoint = $1 and f.entity_key = $2
              and f.fetched_at >= now() - make_interval(secs => $3)) x
           order by (payload_json is not null) desc, fetched_at desc limit 1`
        : `${recorded} order by r.receipt_id desc limit 1`,
      [endpoint, entityKey, maxAge],
    );
    const latest = fresh[0];
    if (latest) {
      if (
        latest.admission === RACE_MATCHMAKING &&
        (!needPayload || latest.payload_json)
      )
        return {
          ok: false,
          reason: "matchmaking",
          fetched_at: latest.fetched_at.toISOString(),
          retry_after_s: cacheLeftS(latest.fetched_at, maxAge),
          payload: latest.payload_json ?? null,
        };
      if (latest.admission === "rejected")
        return {
          ok: false,
          reason: "rejected",
          errors: latest.admission_errors,
        };
      if (
        latest.admission === "admitted" &&
        (!needPayload || latest.payload_json)
      )
        return {
          ok: true,
          fetched_at: latest.fetched_at.toISOString(),
          payload: latest.payload_json ?? null,
        };
    }
    // One open job per subject: a second ask while the first is queued
    // or leased is the same ask, and is not charged again.
    const { rows: open } = await db.query(
      `select job_id, lane, status, record from job
       where endpoint = $1 and entity_key = $2 and status in ('queued', 'leased')
       order by job_id desc limit 1`,
      [endpoint, entityKey],
    );
    if (open[0]) {
      if (open[0].lane !== "live" && open[0].status === "queued") {
        // Promote the queued bulk row: live jumps the queue. A bulk row
        // records, and a fetch-only ask never turns that off.
        await enqueue(db, {
          endpoint,
          entity_key: entityKey,
          lane: "live",
          record: record !== false,
        });
      }
      // A recording ask behind live_fetch's fetch-only job: record it.
      if (record !== false && open[0].record === false)
        await markRecord(db, open[0].job_id);
      return {
        ok: false,
        reason: "pending",
        retry_after_s: retryAfterS,
        job_id: Number(open[0].job_id),
        minted: false,
      };
    }
    const token = await charge(db);
    if (!token.ok)
      return {
        ok: false,
        reason: "pending",
        retry_after_s: token.retry_after_s,
        job_id: null,
        minted: false,
        queued: false,
      };
    let row;
    try {
      await beforeMint();
      row = await enqueue(db, {
        endpoint,
        entity_key: entityKey,
        lane: "live",
        record: record !== false,
      });
    } catch (err) {
      await refund(db).catch(() => {});
      throw err;
    }
    // Another caller's job got in between the check above and this
    // insert: it was charged for, so this token goes back.
    const minted = row?.inserted !== false;
    if (!minted) await refund(db);
    return {
      ok: false,
      reason: "pending",
      retry_after_s: retryAfterS,
      job_id: Number(row?.job_id),
      minted,
    };
  };
}

/** A pool's first reads for the day are spent (spendFirstRead). */
class FirstReadsSpent extends Error {}

/**
 * The first read of a newly added player (2026-10-08). Adding a tag asks
 * for one live read of its profile, as Verify asks for one: charged to
 * nobody's live quota, from the one global bucket. Within minutes the
 * record knows whether the game has this tag at all (a 404 is "Player
 * not found", cr-agent-api-docs players.md) and which clan the player is
 * in, which is what follows the primary player's clan.
 * Bounded: nothing when the record has a profile of this tag, or a
 * failed fetch of it, from the last day, and liveFetch never queues a
 * second job for a subject that has one open. And per person: a pool (a
 * person and their agents) mints at most one first read per player slot
 * per UTC day (FIRST_READS bucket), so adding, removing and re-adding
 * fresh tags cannot drain the global bucket (#371 review). Past that the
 * add still happens and the scheduler's first read comes as for any new
 * recording. Never throws: the add has already happened.
 *
 * `battles: true` (2026-11-09, Jamie: "adding new players battles right
 * away makes a ton of sense and makes first user experience way better")
 * also asks for the battle log on the live lane, after the profile and
 * only when the profile's read is on its way (minted or joined), so the
 * last 30 battles land with the profile instead of at the scheduler's
 * next tick. It has the same guards on its own endpoint (a battle log
 * read or failed in the last day, one open job per subject) and its own
 * per-pool allowance, FIRST_BATTLES, of the same size: a second live
 * token per new player, and nothing else. A refusal or failure never
 * touches the add or the profile's read: the scheduler reads the battle
 * log as for any new recording.
 *
 * Returns {requested, reason}, and not_found when the last day's failed
 * fetch was a 404; with `battles`, also battles: {requested, reason}.
 */
export async function requestFirstRead(
  db,
  live,
  tag,
  accountId,
  { battles = false } = {},
) {
  const { result, outcome } = await firstReadOutcome(db, live, tag, accountId, {
    endpoint: "player",
    pool: FIRST_READS,
  });
  // By name, so a slow first read can be told from a refused one
  // (first_read_landed in packages/ingest/src/first-read.mjs times the
  // landing). No tag, account or email in the line.
  console.info({ event: "first_read_requested", endpoint: "player", outcome });
  if (!battles) return result;
  // The profile first; the battle log only behind a profile read that is
  // on its way, so a tag the game does not have costs one token, not two.
  const second =
    outcome === "minted" || outcome === "joined"
      ? await firstReadOutcome(db, live, tag, accountId, {
          endpoint: "player_battlelog",
          pool: FIRST_BATTLES,
        })
      : {
          result: { requested: false, reason: "profile_not_requested" },
          outcome: "profile_not_requested",
        };
  console.info({
    event: "first_read_requested",
    endpoint: "player_battlelog",
    outcome: second.outcome,
  });
  return {
    ...result,
    battles: {
      requested: second.result.requested,
      reason: second.result.reason,
    },
  };
}

/**
 * The outcomes, one word each: minted (a live job queued for it), joined
 * (a job for the tag was already open), no_token (the global bucket was
 * empty: nothing queued, the scheduler reads it on a later tick),
 * first_reads_spent (the pool's first reads for the day are used: the
 * same), fresh, read_today, failed_today, not_found_today, no_live_lane,
 * no_account, error; for the battle log also not_recorded (no active
 * comprehensive recording, so the scheduler would not read it either) and
 * profile_not_requested (requestFirstRead above).
 */
async function firstReadOutcome(db, live, tag, accountId, { endpoint, pool }) {
  const done = (result, outcome) => ({ result, outcome });
  let spent = null;
  try {
    const {
      rows: [seen],
    } = await db.query(
      `select exists (select 1 from api_receipt
                       where endpoint = $2 and entity_key = $1
                         and fetched_at > now() - interval '1 day') as read,
              (select http_status from collector_fetch_error
                where endpoint = $2 and entity_key = $1
                  and fetched_at > now() - interval '1 day'
                order by fetched_at desc limit 1) as failed_status,
              exists (select 1 from recording
                       where subject_type = 'player' and subject_tag = $1
                         and status = 'active' and scope = 'comprehensive') as deep`,
      [tag, endpoint],
    );
    if (seen.read)
      return done({ requested: false, reason: "read_today" }, "read_today");
    if (seen.failed_status !== undefined && seen.failed_status !== null)
      return done(
        {
          requested: false,
          reason: "failed_today",
          not_found: seen.failed_status === 404,
        },
        seen.failed_status === 404 ? "not_found_today" : "failed_today",
      );
    // The scheduler reads a player's battle log only for a comprehensive
    // recording (plan.mjs seedPollState); a first read never reaches past it.
    if (endpoint === "player_battlelog" && !seen.deep)
      return done({ requested: false, reason: "not_recorded" }, "not_recorded");
    if (!live)
      return done({ requested: false, reason: "no_live_lane" }, "no_live_lane");
    if (!accountId)
      return done({ requested: false, reason: "no_account" }, "no_account");
    const r = await live(db, {
      endpoint,
      entityKey: tag,
      // Spent only when a job is minted: a fresh read or an open job
      // costs the pool nothing. Throwing here gives the token back.
      beforeMint: async () => {
        spent = await spendFirstRead(db, accountId, pool);
        if (!spent.ok) throw new FirstReadsSpent();
      },
    });
    // Another add of the same tag got its job in first: nothing was
    // minted for this one, so the pool's read goes back with the token.
    if (spent?.ok && r.minted === false) await refundFirstRead(db, spent);
    if (r.ok) return done({ requested: false, reason: "fresh" }, "fresh");
    const requested = r.reason === "pending" && r.queued !== false;
    return done(
      { requested, reason: r.reason },
      r.reason !== "pending"
        ? r.reason
        : r.queued === false
          ? "no_token"
          : r.minted
            ? "minted"
            : "joined",
    );
  } catch (err) {
    if (err instanceof FirstReadsSpent)
      return done(
        { requested: false, reason: "first_reads_spent" },
        "first_reads_spent",
      );
    // The mint failed after the pool paid for it: give it back.
    if (spent?.ok) await refundFirstRead(db, spent).catch(() => {});
    console.error("first_read_failed", tag, err?.message, endpoint);
    return done({ requested: false, reason: "error" }, "error");
  }
}

/** The day's first reads, per pool: `firstread#<owner>` in rate_limit,
 *  windowed by UTC date like `liveday#`. */
const FIRST_READS = "firstread#";
/** The day's first battle log reads, per pool, the same size: one per
 *  player slot, so a profile's allowance is never spent on battles. */
const FIRST_BATTLES = "firstbattles#";

/** Take one of the pool's first reads for today: ok while the pool has
 *  one left within its player slots (an exempt pool is never counted).
 *  A refusal leaves the count alone, so the count is always the reads
 *  taken and not given back, and a refund frees a read for the next add.
 *  Returns the window it charged, for refundFirstRead. */
async function spendFirstRead(db, accountId, pool = FIRST_READS) {
  const owner = await poolOwner(db, accountId);
  if (!owner) return { ok: false, bucket: null };
  const max = poolLimits(owner).player_slots;
  if (max === Infinity) return { ok: true, bucket: null };
  if (!(max >= 1)) return { ok: false, bucket: null };
  const bucket = `${pool}${owner.account_id}`;
  const day = new Date().toISOString().slice(0, 10);
  const { rows } = await db.query(
    `insert into rate_limit (bucket, window_start, count) values ($1, $2::date, 1)
     on conflict (bucket, window_start) do update set count = rate_limit.count + 1
       where rate_limit.count < $3
     returning count`,
    [bucket, day, max],
  );
  return rows.length ? { ok: true, bucket, day } : { ok: false, bucket: null };
}

/** Give back a first read that minted nothing. */
async function refundFirstRead(db, { bucket, day }) {
  if (!bucket) return;
  await db.query(
    `update rate_limit set count = count - 1
      where bucket = $1 and window_start = $2::date and count > 0`,
    [bucket, day],
  );
}

/** Allowlisted live paths -> (endpoint, entity key). Mirrors live_fetch. */
export function livePathToJob(path, normalizeTag) {
  const m =
    /^\/(players|clans)\/([^/]+)(\/(battlelog|currentriverrace|riverracelog))?$/.exec(
      path,
    );
  if (!m)
    return {
      error: "bad_request",
      message: `Path not in the allowlist: ${path}`,
    };
  let tag;
  try {
    tag = normalizeTag(decodeURIComponent(m[2]));
  } catch {
    return { error: "invalid_tag", message: `Invalid tag in path: ${m[2]}` };
  }
  if (m[1] === "players") {
    if (m[4] && m[4] !== "battlelog")
      return { error: "bad_request", message: `${m[4]} is a clan endpoint.` };
    return {
      endpoint: m[4] === "battlelog" ? "player_battlelog" : "player",
      entityKey: tag,
    };
  }
  if (m[4] === "battlelog")
    return { error: "bad_request", message: "battlelog is a player endpoint." };
  return { endpoint: m[4] ?? "clan", entityKey: tag };
}
