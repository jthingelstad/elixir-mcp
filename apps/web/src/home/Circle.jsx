import { PlayerName } from "@elixir-mcp/ui";
import { useState } from "react";
import { Avatar, Link, Panel, Row, Rows, TagText } from "@elixir-mcp/ui";
import { playerHref, sessionHref } from "../lib/player.js";
import { useHomeCircle } from "../lib/queries.js";
import { CloseToggle } from "./close.jsx";
import { circleDetail, circleLine, circleWhy, panelOf } from "./logic.js";

/**
 * Your circle this week (2026-11-16): the few players you marked close
 * friends, and how each one's week went, above the feed.
 *
 * Compact first: one strip of faces, each with one line of fact, that
 * scrolls sideways inside itself on a phone, so the feed's first card
 * moves down by about one card's height and no more. "See all" opens the
 * fuller list: each friend's battles, days and sittings, and up to two of
 * the moments the timeline already told about them, in its own words.
 *
 * Facts only, and never a ranking: the read orders by who played last.
 * A friend with no battle this week says so plainly and nothing more.
 *
 * With nobody marked yet, it offers some of the players you follow (who
 * follow you back, then clanmates), each with one tap to mark. With nobody
 * to offer, it is not drawn: never an empty box. A read that failed draws
 * nothing either; the feed below is the page.
 *
 * Names come from the game and are escaped (TagText); the mark is yours
 * alone and the panel says so once.
 */
export function Circle() {
  const query = useHomeCircle();
  const circle = panelOf(query, "circle");
  const [open, setOpen] = useState(false);
  if (!circle?.ok) return null;
  const friends = circle.friends ?? [];
  if (friends.length === 0) {
    const offer = circle.suggestions ?? [];
    return offer.length ? <CircleOffer offer={offer} /> : null;
  }
  return (
    <Panel
      title="Your circle this week"
      titleAs="h2"
      className="kit-circle"
      action={
        <button
          type="button"
          className="btn btn--text"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? "Show less" : "See all"}
        </button>
      }
    >
      {open ? (
        <Rows>
          {friends.map((f) => (
            <CircleRow key={f.tag} f={f} />
          ))}
        </Rows>
      ) : (
        <ul className="kit-circle__strip" aria-label="Your close friends">
          {friends.map((f) => (
            <li key={f.tag} className="kit-circle__item">
              <Link
                to={
                  f.session
                    ? sessionHref(f.tag, f.session.id, f.session.started_at)
                    : playerHref(f.tag)
                }
                className={`kit-circle__face${f.battles > 0 ? "" : " kit-circle__face--quiet"}`}
              >
                <Avatar
                  name={f.name ?? f.tag}
                  tag={f.tag}
                  card={f.avatar_card_id ?? null}
                />
                <span className="kit-circle__name">
                  <TagText>{f.name ?? f.tag}</TagText>
                </span>
                <span className="kit-circle__fact">{circleLine(f)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** One friend in the fuller list. */
function CircleRow({ f }) {
  return (
    <Row
      className="kit-circle__row"
      lead={
        <Avatar
          name={f.name ?? f.tag}
          tag={f.tag}
          card={f.avatar_card_id ?? null}
          small
        />
      }
      title={
        <Link to={playerHref(f.tag)} className="hit">
          <PlayerName tag={f.tag}>
            <TagText>{f.name ?? f.tag}</TagText>
          </PlayerName>
        </Link>
      }
      detail={
        <>
          <span className="kit-circle__fact">{circleDetail(f)}</span>
          {(f.moments ?? []).map((m, i) => (
            <span key={i} className="kit-circle__moment">
              <TagText>{m.text}</TagText>
            </span>
          ))}
        </>
      }
      right={
        <span className="kit-circle__acts">
          {f.session ? (
            <Link
              to={sessionHref(f.tag, f.session.id, f.session.started_at)}
              className="btn btn--sm"
            >
              Latest session
            </Link>
          ) : null}
          <CloseToggle tag={f.tag} name={f.name} close />
        </span>
      }
    />
  );
}

/** Nobody marked yet: a few players you follow, each one tap to mark. */
function CircleOffer({ offer }) {
  return (
    <Panel title="Your circle" titleAs="h2" className="kit-circle">
      <p className="kit-tiny kit-circle__lead">
        Star a few close friends to see their week here. Only you see who you
        star.
      </p>
      <ul className="kit-circle__strip" aria-label="Players you follow">
        {offer.map((s) => (
          <li key={s.tag} className="kit-circle__item">
            <div className="kit-circle__face">
              <Link to={playerHref(s.tag)} className="kit-circle__who">
                <Avatar
                  name={s.name ?? s.tag}
                  tag={s.tag}
                  card={s.avatar_card_id ?? null}
                />
                <span className="kit-circle__name">
                  <TagText>{s.name ?? s.tag}</TagText>
                </span>
              </Link>
              <span className="kit-circle__fact">{circleWhy(s)}</span>
              <CloseToggle tag={s.tag} name={s.name} close={false} />
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
