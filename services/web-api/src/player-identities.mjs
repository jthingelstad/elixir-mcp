/** Website-only proof metadata for identities already present in a response:
 * `player_verifications` (Verified, tag -> boolean) and, beside it,
 * `player_claims` (Claimed: an account says it is this player, unverified;
 * tag -> boolean), so a newer response can clear an older state. A tag false
 * in both is Imported or not followed (Jamie, 2026-11-15).
 * No email, account id, Discord identity or additional player record is exposed.
 * A chosen card, a friend claim and a clan role are never evidence of ownership.
 */
import { playerIdentityStates } from "@elixir-mcp/auth/player-identities";

export function playerTagsIn(value, tags = new Set()) {
  if (!value || typeof value !== "object") return tags;
  if (Array.isArray(value)) {
    for (const row of value) playerTagsIn(row, tags);
    return tags;
  }
  const tag =
    value.player_tag ??
    (value.kind === "player" || ("name" in value && value.kind !== "clan")
      ? value.tag
      : null);
  for (const playerTag of [tag, value.acting_as, value.followed_tag])
    if (typeof playerTag === "string" && playerTag.startsWith("#"))
      tags.add(playerTag);
  for (const [key, child] of Object.entries(value)) {
    if (key !== "player_verifications" && key !== "player_claims")
      playerTagsIn(child, tags);
  }
  return tags;
}

/** Successful website identity reads only. MCP, /api/v1, other public documents,
 * errors and writes retain their contracts. Tool metadata sits in the body's
 * website projection, after the original result has passed its size guard. */
export async function withPlayerVerifications(db, route, response) {
  const selected =
    route === "GET /api/me" ||
    route === "GET /api/player" ||
    route === "GET /api/accounts/*" ||
    /^GET \/api\/me\/(home|people|timeline|bell)(?:\/|$)/.test(route) ||
    /^GET \/api\/clan(?:\/|$)/.test(route) ||
    /^GET \/api\/public\/(battles|highlights)\//.test(route) ||
    route === "POST /api/me/tool" ||
    route === "POST /api/me/stats";
  if (
    !selected ||
    response?.statusCode !== 200 ||
    typeof response.body !== "string"
  )
    return response;
  const payload = JSON.parse(response.body);
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    payload.is_error
  )
    return response;
  const target = route.startsWith("POST ") ? payload.body : payload;
  if (!target || typeof target !== "object" || Array.isArray(target))
    return response;
  const tags = [...playerTagsIn(target)];
  if (!tags.length) return response;
  const states = await playerIdentityStates(db, tags);
  target.player_verifications = Object.fromEntries(
    tags.map((tag) => [tag, states.get(tag) === "verified"]),
  );
  target.player_claims = Object.fromEntries(
    tags.map((tag) => [tag, states.get(tag) === "claimed"]),
  );
  return { ...response, body: JSON.stringify(payload) };
}
