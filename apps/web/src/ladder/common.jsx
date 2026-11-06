import { Empty, Icon, Link, PageHead, Stat, useClock } from "@elixir-mcp/ui";
import { fmt, warLine } from "./ladder.js";
import { useToolRead } from "../lib/queries.js";
import { tagPath } from "../lib/tag-url.js";

/**
 * The pieces every Ladder tab shares: the callouts the frame draws, a record
 * in the house's win and loss inks, and the states a read can be in.
 */

/** A season's edge always names its date: "Mon 5:00 am" reads as a day of
 *  this week and says nothing beside another date. */
export function useSeasonEdge() {
  const { whenDay, clock } = useClock();
  return (ts) => `${whenDay(ts)}, ${clock(ts)}`;
}

/** The current season has no recorded battle yet, so the page reads the
 *  one before (pickSeason): it says so, and the empty season is one click
 *  away. Calm, not an alarm: the first days of every season look like
 *  this. */
export function SeasonFallback({ season, hrefFor }) {
  const empty = season?.fallback;
  if (!empty) return null;
  return (
    <div className="callout callout--info ladder-season-note" role="status">
      <Icon name="info" size={17} />
      <span>
        {empty.name} has no recorded battles yet, so this is {season.name}.{" "}
        <Link to={hrefFor({ season: empty.key })}>Show {empty.name} ›</Link>
      </span>
    </div>
  );
}

/**
 * This race week, above War's pages: decks and points are the clan war week,
 * and the battles below stay one by one. No clan on record, or a clan whose war
 * this account cannot read, and there is no line.
 */
export function WarLine({ player, clan, seasonWar, full = false }) {
  const { when } = useClock();
  const clanTag = clan?.clan_tag ?? player.last_known_clan_tag ?? null;
  const current = useToolRead(
    "war_current",
    { clan_tag: clanTag, verbosity: "compact" },
    { enabled: Boolean(clanTag) },
  );
  const history = useToolRead(
    "war_history",
    { clan_tag: clanTag, player_tag: player.player_tag, seasons: 1 },
    { enabled: Boolean(clanTag) },
  );
  if (!clanTag || current.isError || !current.data || !history.data)
    return null;
  const line = warLine({
    current: current.data,
    weeks: history.data.member_weeks,
    seasonWar,
  });
  if (!line) return null;
  const note = [
    line.note
      ? `${!player.is_primary && clan?.name ? `${clan.name}, ` : ""}${line.note}.`
      : null,
    full && line.note
      ? "A duel spends one deck a round, so decks and battles differ."
      : null,
    line.finished ? "Decks after the finish earn no points." : null,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="callout callout--info ladder-war" role="status">
      <span>
        <b className="ladder-war__line">
          {line.line}
          {line.at ? ` As of ${when(line.at)}.` : ""}
        </b>{" "}
        {note ? <span className="ladder-war__note">{note}</span> : null}{" "}
        <Link to={`/clan/${tagPath(clanTag)}/season`}>
          See the race in Clan › Season
        </Link>
      </span>
    </div>
  );
}

/** "12–22": wins in the win ink, losses in the loss ink, a draw count
 *  only when there were draws. Read aloud as words. */
export function Record({ wins, losses, draws = 0 }) {
  const said = `${fmt(wins)} won, ${fmt(losses)} lost${draws ? `, ${fmt(draws)} drawn` : ""}`;
  return (
    <span className="ladder-record" aria-label={said} role="img">
      <span className="ladder-w">{fmt(wins)}</span>
      <span className="ladder-sep">–</span>
      <span className="ladder-l">{fmt(losses)}</span>
      {draws ? (
        <>
          <span className="ladder-sep">–</span>
          <span>{fmt(draws)}</span>
        </>
      ) : null}
    </span>
  );
}

export function Tile({ label, children, small = false, sub = null }) {
  return (
    <Stat
      className="ladder-tile"
      label={label}
      value={children}
      small={small}
      note={sub || undefined}
    />
  );
}

export function Loading({ what = "the record" }) {
  return (
    <p className="text-ink-faint" role="status">
      Reading {what}…
    </p>
  );
}

/** A read that did not come back: the tool's own words, never a guess
 *  at what the number would have been. */
export function ReadError({ error, what = "this" }) {
  return (
    <div className="callout callout--bad" role="alert">
      <span>
        Elixir could not read {what}
        {error?.message ? `: ${error.message}` : "."}
      </span>
    </div>
  );
}

/** The reader has no player of their own yet: Ladder reads a season,
 *  and a season belongs to a player. */
export function NoPlayers() {
  return (
    <div className="ladder-page">
      <PageHead
        className="ladder-head"
        title="Ladder"
        sub="Your season, read back"
      />
      <Empty
        title="No player of yours yet"
        titleAs="h2"
        action={
          <Link
            className="btn btn--sm"
            to="/console/account/tracking#add-player-tag"
          >
            Add your player
          </Link>
        }
      >
        Ladder reads back the season of a player you play as. Add the player you
        play as, and the record starts with the next battle log Elixir reads.
      </Empty>
    </div>
  );
}
