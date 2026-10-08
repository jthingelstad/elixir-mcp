import { Fresh, Link } from "@elixir-mcp/ui";
import { MODES, fmt, playerName } from "./ladder.js";

/**
 * The pieces every Ladder page shares: the head (crumb, title, lede and
 * when the battle log was read), the mode switch, a record in the
 * house's win and loss inks, and the states a read can be in.
 */

export function LadderHead({ player, page, title, lede, observedAt }) {
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
      {observedAt ? <Fresh ts={observedAt} label="battle log read" /> : null}
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
