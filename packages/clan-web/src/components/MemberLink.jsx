import { Link } from "@elixir-mcp/ui";
import { playerPath } from "../lib/base.js";

/** A player's name opens their one player page (Clan as one view, slice 8,
 *  following "Every player name opens one player page"); for a clanmate that
 *  page links back to their page in this clan. A departed member's name
 *  opens it too: the player page is any player's. */
export function MemberLink({ playerTag, navigate, children }) {
  return playerTag ? (
    <Link to={playerPath(playerTag)} navigate={navigate}>
      {children}
    </Link>
  ) : (
    children
  );
}
