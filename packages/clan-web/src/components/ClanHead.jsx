import { FreshChip, Link, Tabs, Tag } from "@elixir-mcp/ui";
import { useRoster } from "../lib/queries.js";
import { clanTabs, tabOf } from "../lib/tabs.js";
import { ELIXIR_LINKS } from "../lib/links.js";
import { ClanPicker } from "./ClanPicker.jsx";

/**
 * The head every clan page wears: the clan's name, who you are in it, how
 * many are in it, how fresh the roster read is, a picker with two or more
 * clans, the verify banner, and the five tabs. The clan's name is the page's
 * one h1; each page's own head under it is an h2.
 */
export function ClanHead({ me, path, navigate, select, selecting }) {
  const clan = me.selected;
  const { state } = useRoster(clan.clan_tag);
  const roster = state.data ?? null;
  const count = roster?.member_count ?? null;
  const you = clan.acting_as_name ?? clan.player_name ?? null;
  const role = `${clan.role_label ?? ""}${clan.verified === false ? ", unverified" : ""}`;
  const sub = [
    you,
    role || null,
    count === null
      ? null
      : `${count} ${count === 1 ? "member" : "members"}, ${Math.max(0, 50 - count)} open`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <header className="clan-head">
      <div className="clan-head__top">
        <div className="clan-head__who">
          <h1 className="kit-head__title m-0">
            {clan.name ?? <Tag tag={clan.clan_tag} />}
          </h1>
          <p className="page__lede m-0">{sub}</p>
        </div>
        <div className="clan-head__side">
          <ClanPicker
            me={me}
            navigate={navigate}
            select={select}
            selecting={selecting}
          />
          {roster?.meta?.as_of ? (
            <FreshChip
              label="Roster read"
              ts={roster.meta.as_of}
              seconds={roster.meta.freshness_seconds}
            >
              Elixir reads the clan from the game on a schedule. A gap means
              unknown. It does not mean nobody played.
            </FreshChip>
          ) : null}
        </div>
      </div>
      {clan.verified === false || clan.unlock ? (
        <div className="callout callout--info" role="status">
          <span>
            {clan.unlock
              ? `In the game ${clan.unlock.name ?? clan.unlock.player_tag} is ${clan.unlock.role_label === "Elder" ? "an" : "a"} ${clan.unlock.role_label}. Verify that player in Elixir to use those tools here; until then you are here as a member.`
              : "Your player is not verified in Elixir, so you are here as a member who reads: verify it to mark yourself away, comment or join the clan map."}
          </span>
          <Link className="btn btn--sm" to={ELIXIR_LINKS.verify}>
            Verify {clan.unlock?.name ?? you ?? "your player"}
          </Link>
        </div>
      ) : null}
      <Tabs label="Clan" items={clanTabs(me)} value={tabOf(path) ?? ""} />
    </header>
  );
}
