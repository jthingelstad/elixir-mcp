import { tagPath } from "../lib/tag-url.js";

/**
 * A principal's clans, each named with its tag beside it and linked to
 * the Explore record. The name is what a person recognises; the tag is
 * the identifier, never shown alone when the corpus has named the clan.
 */
export function ClanRefs({ clans, navigate, empty = "—" }) {
  if (!clans?.length) return empty;
  return clans.map((c, i) => (
    <span key={c.clan_tag}>
      {i > 0 ? ", " : ""}
      <a onClick={() => navigate(`/explore/clan/${tagPath(c.clan_tag)}`)}>
        {c.name ?? c.clan_tag}
      </a>
      {c.name ? (
        <>
          {" "}
          <span className="mono">{c.clan_tag}</span>
        </>
      ) : null}
    </span>
  ));
}
