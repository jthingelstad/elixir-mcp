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

/**
 * The first read of a newly added player (2026-10-08). Adding a tag asks
 * for one live read of its profile, as Verify asks for one: charged to
 * nobody (no per-account quota), from the one global bucket. Within
 * minutes the record knows whether the game has this tag at all (a 404
 * is "Player not found", cr-agent-api-docs players.md) and which clan
 * the player is in, which is what follows the primary player's clan.
 * Bounded: nothing when the record has a profile of this tag, or a
 * failed fetch of it, from the last day, and liveFetch never queues a
 * second job for a subject that has one open. Never throws: the add has
 * already happened, and the scheduler's first read comes anyway.
 * Returns {requested, reason}, and not_found when the last day's failed
 * fetch was a 404.
 */
export async function requestFirstRead(db, live, tag) {
  try {
    const {
      rows: [seen],
    } = await db.query(
      `select exists (select 1 from api_receipt
                       where endpoint = 'player' and entity_key = $1
                         and fetched_at > now() - interval '1 day') as read,
              (select http_status from collector_fetch_error
                where endpoint = 'player' and entity_key = $1
                  and fetched_at > now() - interval '1 day'
                order by fetched_at desc limit 1) as failed_status`,
      [tag],
    );
    if (seen.read) return { requested: false, reason: "read_today" };
    if (seen.failed_status !== undefined && seen.failed_status !== null)
      return {
        requested: false,
        reason: "failed_today",
        not_found: seen.failed_status === 404,
      };
    if (!live) return { requested: false, reason: "no_live_lane" };
    const r = await live(db, { endpoint: "player", entityKey: tag });
    if (r.ok) return { requested: false, reason: "fresh" };
    return {
      requested: r.reason === "pending" && r.queued !== false,
      reason: r.reason,
    };
  } catch (err) {
    console.error("first_read_failed", tag, err?.message);
    return { requested: false, reason: "error" };
  }
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
