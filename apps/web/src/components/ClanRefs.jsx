import { Link } from "@elixir-mcp/ui";
import { tagPath } from "../lib/tag-url.js";

/**
 * A principal's clans, each named with its tag beside it and linked to
 * the Explore record. The name is what a person recognises; the tag is
 * the identifier, never shown alone when the corpus has named the clan.
 */
export function ClanRefs({ clans, empty = "—" }) {
  if (!clans?.length) return empty;
  return clans.map((c, i) => (
    <span key={c.clan_tag}>
      {i > 0 ? ", " : ""}
      <Link to={`/explore/clan/${tagPath(c.clan_tag)}`}>
        {c.name ?? c.clan_tag}
      </Link>
      {c.name ? (
        <>
          {" "}
          <span className="mono">{c.clan_tag}</span>
        </>
      ) : null}
    </span>
  ));
}
