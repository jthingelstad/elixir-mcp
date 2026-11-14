/**
 * Profile images on the website's reads (2026-11-14). An account chooses one
 * card (`account.avatar_card_id`, POST /api/me/avatar); it shows on every
 * player that account verified, wherever the website draws that player, to
 * anyone who can already read that surface. A player nobody verified keeps
 * initials. Each read asks once for its whole page of tags
 * (`verifiedAvatars` in @elixir-mcp/tools/social), never once a row.
 *
 * `avatar_card_id` is added to a row only when its player has an image, so
 * a row without one is unchanged. The website's alone: no MCP tool output
 * and no `/api/v1` answer carries it.
 */
import { verifiedAvatars } from "@elixir-mcp/tools/social";

export { verifiedAvatars };

/** `row` with its player's image, when `avatars` has one for `tag`. */
export const withAvatar = (row, tag, avatars) =>
  row && tag && avatars.has(tag)
    ? { ...row, avatar_card_id: avatars.get(tag) }
    : row;

/** Find's and Home's people lists: every row under `people` or `players`
 *  (its `tag`, or `player_tag`), in one statement for the whole answer. */
export async function peopleWithAvatars(db, out) {
  const lists = ["people", "players"].filter((k) => Array.isArray(out?.[k]));
  if (lists.length === 0) return out;
  const tagOf = (p) => p?.tag ?? p?.player_tag ?? null;
  const avatars = await verifiedAvatars(
    db,
    lists.flatMap((k) => out[k].map(tagOf)),
  );
  if (avatars.size === 0) return out;
  const next = { ...out };
  for (const k of lists)
    next[k] = out[k].map((p) => withAvatar(p, tagOf(p), avatars));
  return next;
}
