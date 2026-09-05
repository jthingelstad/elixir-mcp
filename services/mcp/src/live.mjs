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
    const since = new Date();
    await enqueue({ endpoint, entity_key: entityKey, lane: "live" });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const { rows } = await db.query(
        `select r.admission, r.admission_errors, p.payload_json
         from api_receipt r
         left join api_payload p on p.endpoint = r.endpoint
           and p.entity_key = r.entity_key and p.payload_hash = r.payload_hash
         where r.endpoint = $1 and r.entity_key = $2 and r.fetched_at >= $3
         order by r.receipt_id desc limit 1`,
        [endpoint, entityKey, since],
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
