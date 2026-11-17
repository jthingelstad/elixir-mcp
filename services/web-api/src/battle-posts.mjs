/** A battle attachment: resolve the battle and which verified players
 * the author may post as. Canonical post reads live in @elixir-mcp/posts;
 * all sharing uses the one-item capability door. */
import { normalizeTag } from "@elixir-mcp/contracts";
import { resolveBattleRef } from "@elixir-mcp/record/battle-links";

/** The battle a reference names when it names exactly one, and the
 *  account's verified players who played it (primary first): the players
 *  it may post about it as. `{ battle_id, players }` or a 404's error. */
export async function battleFor(db, accountId, ref) {
  const ids = await resolveBattleRef(db, ref);
  if (ids.length !== 1)
    return { error: "not_found", message: "No battle at this address." };
  const { rows } = await db.query(
    `select bp.player_tag
       from battle_participant bp
       join claim c on c.player_tag = bp.player_tag
      where bp.battle_id = $1 and c.account_id = $2
        and c.status = 'verified'
      order by c.is_primary desc, bp.player_tag`,
    [ids[0], accountId],
  );
  return { battle_id: ids[0], players: rows.map((r) => r.player_tag) };
}

/** The player a post is written as: the one asked for when it may be, or
 *  the only one; null when neither. */
export function pickPlayer(players, asked) {
  if (asked == null || asked === "")
    return players.length === 1 ? players[0] : null;
  let tag;
  try {
    tag = normalizeTag(String(asked));
  } catch {
    return null;
  }
  return players.includes(tag) ? tag : null;
}
