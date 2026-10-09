import { Tag, TagText } from "@elixir-mcp/ui";
import { CLAN, clanPath } from "../lib/base.js";

/**
 * The head every redesigned Clan page wears (the October 2026 canvas):
 * where you are (Clan › the clan › the page), the page's title, one
 * lede, and how fresh the read is on the right. `crumb` is the page's
 * own name; on the clan's front page there is none, and the clan's
 * name is the last step. `via` is a step between the clan and the page
 * (`{ label, to }`: Actions, above one action). `children` sit under the
 * lede (a week's earlier and later links, a clan switcher).
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
}) {
  const go = (path) => (e) => {
    if (!navigate) return;
    e.preventDefault();
    navigate(path);
  };
  const clanName = name ?? clan.name ?? <Tag tag={clan.clan_tag} />;
  const home = clanPath(clan.clan_tag);
  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-3 mb-[22px]">
      <div className="grow basis-[420px] min-w-0 grid gap-2">
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
        <h1 className="page__title">
          <TagText>{title}</TagText>
        </h1>
        {lede ? <p className="page__lede m-0">{lede}</p> : null}
        {children}
      </div>
      {fresh ?? null}
    </div>
  );
}

const TONE = { ok: "text-ok", warn: "text-warn", bad: "text-bad" };

/** One number with its label, the canvas's tile: a count the record
 *  returned, never a derived score. `of` is the whole it is out of. */
export function Tile({ label, value, of, hint, tone }) {
  return (
    <div className="panel grid content-start gap-1.5 px-[18px] py-4">
      <span className="label">{label}</span>
      <span
        className={`font-mono text-[26px] font-semibold leading-[1.15] ${TONE[tone] ?? "text-ink"}`}
      >
        {value}
        {of ? (
          <span className="text-[14px] font-normal text-ink-faint"> {of}</span>
        ) : null}
      </span>
      {hint ? (
        <span className="text-[12.5px] text-ink-faint">{hint}</span>
      ) : null}
    </div>
  );
}

/** The row of tiles under a page's head. */
export function Tiles({ children, label }) {
  return (
    <div
      className="grid gap-4 mb-[22px] grid-cols-[repeat(auto-fit,minmax(170px,1fr))]"
      role="group"
      aria-label={label}
    >
      {children}
    </div>
  );
}
