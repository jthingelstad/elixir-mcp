/** Website-only proof metadata for identities already present in a response.
 * No email, account id, Discord identity or additional player record is exposed.
 * A chosen card, a friend claim and a clan role are never evidence of ownership.
 */
import { verifiedPlayerIdentities } from "@elixir-mcp/tools/social";

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
    if (key !== "player_verifications") playerTagsIn(child, tags);
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
    /^GET \/api\/me\/(home|people|timeline|bell)(?:\/|$)/.test(route) ||
    /^GET \/api\/clan(?:\/|$)/.test(route) ||
    /^GET \/api\/public\/(battles|highlights)\//.test(route) ||
    route === "POST /api/me/tool" ||
    route === "POST /api/me/stats" ||
    route === "POST /api/explore";
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
  const identities = await verifiedPlayerIdentities(db, tags);
  target.player_verifications = Object.fromEntries(
    tags.map((tag) => [tag, identities.has(tag)]),
  );
  return { ...response, body: JSON.stringify(payload) };
}
