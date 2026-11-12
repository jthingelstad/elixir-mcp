import { Tag } from "@elixir-mcp/ui";

/**
 * A principal's clans, each named with its tag beside it. The name is what
 * a person recognises; the tag is the identifier, never shown alone when
 * the corpus has named the clan. Unlinked since the Console's clan record
 * folded (2026-11-12).
 */
export function ClanRefs({ clans, empty = "—" }) {
  if (!clans?.length) return empty;
  return clans.map((c, i) => (
    <span key={c.clan_tag}>
      {i > 0 ? ", " : ""}
      {c.name ?? <Tag tag={c.clan_tag} />}
      {c.name ? (
        <>
          {" "}
          <span className="mono">{c.clan_tag}</span>
        </>
      ) : null}
    </span>
  ));
}
