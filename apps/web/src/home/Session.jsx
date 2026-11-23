import { DeckRow, Icon, Link, TagText } from "@elixir-mcp/ui";
import {
  SITTINGS,
  compactSitting,
  deckCaption,
  modesSaid,
  sessionChips,
  sessionHeadline,
  signedCount as signed,
  trophyNet,
} from "@elixir-mcp/ui/session-story";
import { sessionHref } from "../lib/player.js";
import { Sparkline } from "./Sparkline.jsx";
import { ModeLine } from "./ModeLine.jsx";

/**
 * A sitting as every page draws it (slice 7, #765; G7, 2026-11-12: sessions
 * look the same everywhere): Home's feed, You's Timeline and a player's page.
 *
 * Since 2026-11-16 it is a card in the way a run is on Strava: a headline
 * made of the sitting's facts, its figures, the facts worth a chip, a slim
 * strip of its battles in order (Jamie, 2026-11-11: "some sparkline that
 * indicates win and loss as well as magnitude"), and the deck played most
 * as its eight cards. The whole card opens the session's own page. One or
 * two battles is a compact card: the result on one line with its trophies,
 * no figures, no strip and no chips, a smaller deck.
 */
// The headline, chips and deck caption are derived in the kit's
// session-story module, which the digest reads too, so a sitting is said
// the same way in the app and in mail (2026-11-16).
export {
  SITTINGS,
  compactSitting,
  deckCaption,
  modesSaid,
  sessionChips,
  sessionHeadline,
  trophyNet,
};

/** A sitting with the facts a card is drawn from; one without (an old or
 *  thin row) keeps the timeline's sentence. */
export const sittingCard = (it) =>
  SITTINGS.has(it?.kind) && (it.facts?.battles ?? 0) > 0;

/** What the card's link says to a screen reader: whose session, and the
 *  numbers the figures show. */
export function sessionLinkName(f = {}, who) {
  const net = trophyNet(f);
  const parts = [
    sessionHeadline(f),
    (f.battles ?? 0) > 1 ? `lost ${f.lost ?? 0}` : null,
    net !== null ? `${signed(net)} trophies` : null,
  ].filter(Boolean);
  return `Open ${who ? `${who}’s ` : ""}session: ${parts.join(", ")}`;
}

/** The card's link: the session's own page, by its player, its id and its
 *  start. Null when the item lacks one of them (an old row). */
export function sessionLink(it, tag) {
  const at = it.facts?.started_at;
  return tag && it.id && it.evidence?.kind === "session"
    ? sessionHref(tag, it.id, at)
    : null;
}

/** A sitting's card body. `href` opens its page; without one (an old row)
 *  the card draws the same and opens nothing. */
export function Sitting({ it, href = null, who = null }) {
  const f = it.facts ?? {};
  const one = compactSitting(f);
  const net = trophyNet(f);
  const chips = one ? [] : sessionChips(f, it.scores);
  const caption = deckCaption(f);
  const deck =
    it.deck?.cards?.length && it.deck.label === caption?.label ? it.deck : null;
  const body = (
    <>
      <p className="kit-scard__title">
        <span className="kit-scard__head">{sessionHeadline(f)}</span>
        {one && net !== null ? (
          <span
            className={`kit-scard__net${net > 0 ? " kit-scard__net--up" : net < 0 ? " kit-scard__net--down" : ""}`}
          >
            {" "}
            {signed(net)} trophies
          </span>
        ) : null}
        {href ? (
          <span className="kit-scard__go" aria-hidden="true">
            <Icon name="chevron-right" size={18} />
          </span>
        ) : null}
      </p>
      {one ? null : (
        <div className="kit-scard__figs">
          <dl className="kit-sfacts">
            <div>
              <dt>Won</dt>
              <dd className="kit-sfacts--won">{f.won ?? 0}</dd>
            </div>
            <div>
              <dt>Lost</dt>
              <dd>{f.lost ?? 0}</dd>
            </div>
            {(f.drawn ?? 0) > 0 ? (
              <div>
                <dt>Drawn</dt>
                <dd>{f.drawn}</dd>
              </div>
            ) : null}
            {net !== null ? (
              <div>
                <dt>Trophies</dt>
                <dd
                  className={
                    net > 0
                      ? "kit-sfacts--up"
                      : net < 0
                        ? "kit-sfacts--down"
                        : ""
                  }
                >
                  {signed(net)}
                </dd>
              </div>
            ) : null}
          </dl>
          <Sparkline spark={it.spark} slim />
        </div>
      )}
      {chips.length ? (
        <ul className="kit-scard__chips" aria-label="Facts">
          {chips.map((c) => (
            <li key={c.key} className="chip">
              {c.text}
            </li>
          ))}
        </ul>
      ) : null}
      <ModeLine facts={f} />
      {/* Its eight cards, as kept when Home's week was built (design
          canvas, 2026-11-13); a week stored before then has the label
          alone. */}
      {deck ? (
        <div className={`kit-scard__deck${one ? " kit-scard__deck--one" : ""}`}>
          <DeckRow
            cards={deck.cards}
            showForm={false}
            label={`${deck.label}, the deck played most`}
          />
        </div>
      ) : null}
      {caption ? (
        <p className="kit-decklabel kit-scard__caption">
          <b>
            <TagText>{caption.label}</TagText>
          </b>
          {caption.count ? ` · ${caption.count}` : ""}
          {caption.more ? (
            <span className="kit-scard__more">
              {" · "}
              <TagText>{caption.more}</TagText>
            </span>
          ) : null}
        </p>
      ) : null}
    </>
  );
  const cls = `kit-scard${one ? " kit-scard--one" : ""}`;
  return href ? (
    <Link to={href} className={cls} aria-label={sessionLinkName(f, who)}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** What an item's evidence toggle says, open or closed, on Home and on a
 *  player's page alike (design canvas, 2026-11-13): a sitting opens as a
 *  session, a moment's crossing as its crossing. */
export const evidenceWord = (it, open) =>
  it.evidence.kind === "session"
    ? open
      ? "Close session"
      : "Open session"
    : open
      ? "Close crossing"
      : "Open crossing";
