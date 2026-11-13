import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@elixir-mcp/ui";
import { memberPath } from "../lib/base.js";
import { playerHref } from "../../lib/player.js";
import { keys } from "../lib/queries.js";

/** Whether a player is one of the signed-in reader's own, from the session
 *  the shell has already read (never a read of its own). */
function useOwn(playerTag) {
  const env = useQueryClient().getQueryData(keys.me);
  const identities = env?.ok ? (env.data?.identities ?? []) : [];
  return identities.some((p) => p.player_tag === playerTag);
}

/** A player's name opens their one player page (Clan as one view, slice 8,
 *  following "Every player name opens one player page"); for a clanmate that
 *  page links back to their page in this clan. A departed member's name
 *  opens it too: the player page is any player's. The reader's own name in
 *  a clan opens their page here instead, their record, standing and Away,
 *  because the player page offers no way back to Clan for your own player. */
export function MemberLink({ clanTag, playerTag, navigate, children }) {
  const own = useOwn(playerTag);
  if (!playerTag) return children;
  const to =
    own && clanTag ? memberPath(clanTag, playerTag) : playerHref(playerTag);
  return (
    <Link to={to} navigate={navigate} className="hit">
      {children}
    </Link>
  );
}
