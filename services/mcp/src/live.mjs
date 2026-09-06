/**
 * The live lane — DESIGN §5.1. An MCP call enqueues a live-lane job
 * (gateways drain live before bulk), then polls Postgres for the
 * resulting receipt: the fetch flows through the normal results->ingest
 * path, which is also what makes live fetches opportunistically recorded.
 * Bounded wait; a structured live_unavailable, never a hang. The
 * scheduler's live_reserve is the budget this lane spends.
 */

const POLL_INTERVAL_MS = 400;

export function makeLive({
  enqueue,
  timeoutMs = 12000,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  return async function liveFetch(db, { endpoint, entityKey }) {
    // Receipts carry the collector's SECOND-precision fetched_at, so a
    // fetch that completes in the same wall-clock second as this request
    // sorts BEFORE a millisecond `since` and would be dropped (prod
    // verification 2026-09-06: two healthy live collectors, an admitted
    // receipt at 13:19:09.000, since=13:19:09.2xx -> timeout). Floor to
    // the second with a small margin. The job_id binding below is the
    // real correctness guard; this only bounds the scan.
    const since = new Date(Math.floor(Date.now() / 1000) * 1000 - 5000);
    const enqueued = await enqueue(db, {
      endpoint,
      entity_key: entityKey,
      lane: "live",
    });
    // Bind the wait to THIS job (issue #3): the receipt must carry our
    // job_id AND come from a live-channel collector. A bulk collector's
    // receipt for the same subject — leased before we asked — is still
    // recorded opportunistically, but it never serves a live answer
    // (the ratified channel boundary). No job id = nothing can match.
    const jobId = Number.isInteger(enqueued?.job_id)
      ? enqueued.job_id
      : Number(enqueued?.job_id) || null;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const { rows } = await db.query(
        `select r.admission, r.admission_errors, p.payload_json
         from api_receipt r
         join gateway g on g.gateway_id = r.gateway_id and g.channel = 'live'
         left join api_payload p on p.endpoint = r.endpoint
           and p.entity_key = r.entity_key and p.payload_hash = r.payload_hash
         where r.endpoint = $1 and r.entity_key = $2 and r.fetched_at >= $3
           and r.job_id = $4
         order by r.receipt_id desc limit 1`,
        [endpoint, entityKey, since, jobId],
      );
      const row = rows[0];
      if (row) {
        if (row.admission === "admitted" && row.payload_json) {
          return { ok: true, payload: row.payload_json };
        }
        return { ok: false, reason: "rejected", errors: row.admission_errors };
      }
    }
    return { ok: false, reason: "timeout" };
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
