import { Link } from "@elixir-mcp/ui";
import { memberPath } from "../lib/base.js";

/** Recorded member activity is clan-scoped and admits only current members. */
export function MemberLink({
  clanTag,
  playerTag,
  navigate,
  current = true,
  children,
}) {
  return current && clanTag && playerTag ? (
    <Link to={memberPath(clanTag, playerTag)} navigate={navigate}>
      {children}
    </Link>
  ) : (
    children
  );
}
