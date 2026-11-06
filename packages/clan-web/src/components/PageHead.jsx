import { PageHead as KitHead, Stat, Stats, Tag, TagText } from "@elixir-mcp/ui";
import { CLAN, clanPath } from "../lib/base.js";

/**
 * The head every redesigned Clan page wears (the October 2026 canvas):
 * where you are (Clan › the clan › the page), the page's title, one
 * lede, and how fresh the read is on the right. `crumb` is the page's
 * own name; on the clan's front page there is none, and the clan's
 * name is the last step. `via` is a step between the clan and the page
 * (`{ label, to }`: Actions, above one action). `children` sit under the
 * lede (a week's earlier and later links, the roster's clan name).
 */
export function PageHead({
  clan,
  name,
  crumb,
  via,
  title,
  lede,
  fresh,
  navigate,
  children,
  breadcrumb = true,
}) {
  const go = (path) => (e) => {
    if (!navigate) return;
    e.preventDefault();
    navigate(path);
  };
  const clanName = name ?? clan.name ?? <Tag tag={clan.clan_tag} />;
  // The clan's roster, by its own address: the clan's bare one is the
  // landing, Actions for a leader with Actions waiting.
  const home = `${clanPath(clan.clan_tag)}/roster`;
  return (
    <KitHead
      title={<TagText>{title}</TagText>}
      sub={lede}
      aside={fresh}
      crumb={
        breadcrumb ? (
          <nav
            aria-label="Breadcrumb"
            className="page__crumb m-0 flex flex-wrap items-center gap-2 text-ink-faint"
          >
            <a
              className="text-ink-faint"
              href={`${CLAN}/clans`}
              onClick={go(`${CLAN}/clans`)}
            >
              Clan
            </a>
            <span aria-hidden="true">›</span>
            {crumb ? (
              <>
                <a className="text-ink-faint" href={home} onClick={go(home)}>
                  {clanName}
                </a>
                <span aria-hidden="true">›</span>
                {via ? (
                  <>
                    <a
                      className="text-ink-faint"
                      href={via.to}
                      onClick={go(via.to)}
                    >
                      {via.label}
                    </a>
                    <span aria-hidden="true">›</span>
                  </>
                ) : null}
                <span aria-current="page" className="text-ink-dim">
                  {crumb}
                </span>
              </>
            ) : (
              <span aria-current="page" className="text-ink-dim">
                {clanName}
              </span>
            )}
          </nav>
        ) : null
      }
    >
      {children}
    </KitHead>
  );
}

/** One number with its label, the canvas's tile: a count the record
 *  returned, never a derived score. `of` is the whole it is out of. */
export function Tile({ label, value, of, hint, tone }) {
  return <Stat label={label} value={value} of={of} note={hint} tone={tone} />;
}

/** The row of tiles under a page's head. */
export function Tiles({ children, label }) {
  return (
    <Stats className="fact-strip" label={label}>
      {children}
    </Stats>
  );
}
