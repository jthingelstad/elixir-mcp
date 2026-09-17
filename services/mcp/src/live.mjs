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
 */

/** The API's cache-control max-age per endpoint, in seconds. */
const MAX_AGE_S = {
  clan: 120,
  currentriverrace: 120,
  riverracelog: 120,
};
const DEFAULT_MAX_AGE_S = 60;

export function makeLive({ enqueue, retryAfterS = 15 }) {
  return async function liveFetch(
    db,
    { endpoint, entityKey, needPayload = false, beforeMint = async () => {} },
  ) {
    const maxAge = MAX_AGE_S[endpoint] ?? DEFAULT_MAX_AGE_S;
    const { rows: fresh } = await db.query(
      `select r.admission, r.admission_errors, r.fetched_at, p.payload_json
       from api_receipt r
       left join api_payload p on p.endpoint = r.endpoint
         and p.entity_key = r.entity_key and p.payload_hash = r.payload_hash
       where r.endpoint = $1 and r.entity_key = $2
         and r.fetched_at >= now() - make_interval(secs => $3)
       order by r.receipt_id desc limit 1`,
      [endpoint, entityKey, maxAge],
    );
    const latest = fresh[0];
    if (latest) {
      if (latest.admission !== "admitted")
        return {
          ok: false,
          reason: "rejected",
          errors: latest.admission_errors,
        };
      if (!needPayload || latest.payload_json)
        return {
          ok: true,
          fetched_at: latest.fetched_at.toISOString(),
          payload: latest.payload_json ?? null,
        };
    }
    // One open job per subject: a second ask while the first is queued
    // or leased is the same ask, and is not charged again.
    const { rows: open } = await db.query(
      `select job_id, lane, status from job
       where endpoint = $1 and entity_key = $2 and status in ('queued', 'leased')
       order by job_id desc limit 1`,
      [endpoint, entityKey],
    );
    if (open[0]) {
      if (open[0].lane !== "live" && open[0].status === "queued") {
        // Promote the queued bulk row: live jumps the queue.
        await enqueue(db, { endpoint, entity_key: entityKey, lane: "live" });
      }
      return {
        ok: false,
        reason: "pending",
        retry_after_s: retryAfterS,
        job_id: Number(open[0].job_id),
        minted: false,
      };
    }
    await beforeMint();
    const row = await enqueue(db, {
      endpoint,
      entity_key: entityKey,
      lane: "live",
    });
    return {
      ok: false,
      reason: "pending",
      retry_after_s: retryAfterS,
      job_id: Number(row?.job_id),
      minted: true,
    };
  };
}

/** Allowlisted live paths -> (endpoint, entity key). Mirrors live_fetch. */
export function livePathToJob(path, normalizeTag) {
  // Leaderboards (agent feedback #6): location id, not a CR tag.
  const rank =
    /^\/locations\/([a-zA-Z0-9]+)\/(rankings\/players|pathoflegend\/players)$/.exec(
      path,
    );
  if (rank) {
    const loc = rank[1].toLowerCase();
    if (!/^(global|[0-9]+)$/.test(loc))
      return {
        error: "bad_request",
        message: `Location must be 'global' or a numeric id: ${rank[1]}`,
      };
    return {
      endpoint:
        rank[2] === "rankings/players" ? "rankings_players" : "rankings_pol",
      entityKey: loc,
    };
  }
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
