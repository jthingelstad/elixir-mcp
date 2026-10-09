import { Fresh, Icon, Link } from "@elixir-mcp/ui";
import { useId } from "react";
import { MODES, fmt, playerName } from "./ladder.js";
import { ZoneOffer } from "../components/ZoneOffer.jsx";

/**
 * The pieces every Ladder page shares: the head (crumb, title, lede and
 * when the battle log was read, then the offer to set a time zone while
 * the account has none), the mode switch, a record in the
 * house's win and loss inks, and the states a read can be in.
 */

export function LadderHead({
  player,
  page,
  title,
  lede,
  observedAt,
  season,
  seasonPicker,
}) {
  return (
    <>
      <LadderHeadRow
        player={player}
        page={page}
        title={title}
        lede={lede}
        observedAt={observedAt}
        seasonPicker={seasonPicker}
      />
      <SeasonFallback season={season} seasonPicker={seasonPicker} />
      <ZoneOffer className="mb-4" />
    </>
  );
}

function LadderHeadRow({
  player,
  page,
  title,
  lede,
  observedAt,
  seasonPicker,
}) {
  return (
    <div className="page-head ladder-head">
      <div className="min-w-0 flex-auto">
        <p className="page__crumb ladder-crumb">
          <span>Ladder</span>
          <span aria-hidden="true">›</span>
          <span>{playerName(player)}</span>
          <span aria-hidden="true">›</span>
          <span className="text-ink-dim">{page}</span>
        </p>
        <h1 className="page__title">{title}</h1>
        {lede ? <p className="page__lede">{lede}</p> : null}
      </div>
      <div className="ladder-head__side">
        {seasonPicker ? <SeasonSwitch {...seasonPicker} /> : null}
        {observedAt ? <Fresh ts={observedAt} label="battle log read" /> : null}
      </div>
    </div>
  );
}

/** Which season the page reads (2026-10-08): the seasons on the
 *  player's record, newest first, and any other the address names. A
 *  choice is going to that season's address (`?season=136`), so a
 *  link or a reload keeps it, as the mode tabs do. */
function SeasonSwitch({ seasons, value, hrefFor, navigate }) {
  const id = useId();
  const list = seasons ?? [];
  if (!list.length) return null;
  const options = list.some((s) => s.key === value)
    ? list
    : [
        ...list,
        { key: value, name: /^\d+$/.test(value) ? `Season ${value}` : value },
      ];
  return (
    <div className="ladder-season">
      <label htmlFor={id} className="ladder-season__label">
        Season
      </label>
      <select
        id={id}
        className="ladder-season__select"
        value={value}
        onChange={(e) => navigate?.(hrefFor(e.target.value))}
      >
        {options.map((s) => (
          <option key={s.key} value={s.key}>
            {s.name}
            {s.current ? " (now)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

/** The current season has no recorded battle yet, so the page reads the
 *  one before (pickSeason): it says so, and the empty season is one click
 *  away. Calm, not an alarm: the first days of every season look like
 *  this. */
function SeasonFallback({ season, seasonPicker }) {
  const empty = season?.fallback;
  if (!empty) return null;
  return (
    <div className="callout callout--info ladder-season-note" role="status">
      <Icon name="info" size={17} />
      <span>
        {empty.name} has no recorded battles yet, so this is {season.name}.{" "}
        {seasonPicker?.hrefFor ? (
          <Link to={seasonPicker.hrefFor(empty.key)}>Show {empty.name} ›</Link>
        ) : null}
      </span>
    </div>
  );
}

/** One tab per mode, each its own address: a mode is a different game,
 *  so switching is going somewhere, not filtering a pooled list. */
export function ModeSwitch({ mode, hrefFor, modes = MODES }) {
  return (
    <nav aria-label="Mode" className="ladder-modes">
      {modes.map((m) => (
        <Link
          key={m.key}
          to={hrefFor(m.key)}
          className="ladder-modes__tab"
          aria-current={m.key === mode ? "true" : undefined}
        >
          {m.label}
        </Link>
      ))}
    </nav>
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
    <div className="ladder-tile">
      <span className="ladder-tile__label">{label}</span>
      <span
        className={`ladder-tile__value${small ? " ladder-tile__value--sm" : ""}`}
      >
        {children}
      </span>
      {sub ? <span className="ladder-tile__sub">{sub}</span> : null}
    </div>
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
 *  and a season belongs to a player. Tracking is where one is added. */
export function NoPlayers() {
  return (
    <div className="empty mt-6">
      <h1 className="empty__title">No player of yours yet</h1>
      <p className="empty__body">
        Ladder reads back the season of a player you play as. Add the player you
        play as on Tracking; the record starts with the next battle log Elixir
        reads.
      </p>
      <Link className="btn btn--sm" to="/console/account/tracking">
        Go to Tracking
      </Link>
    </div>
  );
}
