import { DeckRow, Icon, Link, TagText, noun } from "@elixir-mcp/ui";
import { sessionHref } from "../lib/player.js";
import { modeWord } from "./logic.js";
import { Sparkline } from "./Sparkline.jsx";

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
export const SITTINGS = new Set(["battle_session", "session_standout"]);

/** A sitting with the facts a card is drawn from; one without (an old or
 *  thin row) keeps the timeline's sentence. */
export const sittingCard = (it) =>
  SITTINGS.has(it?.kind) && (it.facts?.battles ?? 0) > 0;

/** The modes a sitting was played in, as the game names them: an event
 *  by its own name when the sitting was all one event. */
export function modesSaid(f = {}) {
  const modes = Object.keys(f.by_mode ?? {});
  const events = f.events ?? [];
  const words = modes.map((m) =>
    m === "event" && events.length === 1 && events[0]?.name
      ? events[0].name
      : modeWord(m),
  );
  if (words.length <= 1) return words[0] ?? null;
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

/** Where a sitting was played, as a phrase after its result: "on Trophy
 *  Road", "in Ranked", "in Classic 1v1" (an event by its own
 *  name), "across Trophy Road and Casual". */
export function wherePlayed(f = {}) {
  const modes = Object.keys(f.by_mode ?? {});
  const said = modesSaid(f);
  if (!said) return null;
  if (modes.length > 1) return `across ${said}`;
  return modes[0] === "ladder" ? `on ${said}` : `in ${said}`;
}

/** A sitting's headline, from its facts alone (2026-11-16): its result and
 *  what stood out, never the timeline's sentence, which repeats the name
 *  and every number the card shows (that sentence stays for MCP, RSS and
 *  Discord). "Won 8 of 12 on Trophy Road, 5 in a row"; "Lost a Ranked
 *  battle". */
export function sessionHeadline(f = {}) {
  const n = f.battles ?? 0;
  const where = wherePlayed(f);
  const modes = Object.keys(f.by_mode ?? {});
  if (n === 1) {
    const did = (f.won ?? 0) > 0 ? "Won" : (f.lost ?? 0) > 0 ? "Lost" : "Drew";
    const said = modesSaid(f);
    if (!said) return `${did} a battle`;
    return modes[0] === "event" || modes.length > 1
      ? `${did} a battle ${where}`
      : `${did} a ${said} battle`;
  }
  const run =
    typeof f.won_in_a_row === "number" && f.won_in_a_row >= 3
      ? `, ${f.won_in_a_row} in a row`
      : "";
  // No win: the count and where, never "Won 0 of 3".
  if (!(f.won > 0)) return `${n} battles${where ? ` ${where}` : ""}`;
  return `Won ${f.won} of ${n}${where ? ` ${where}` : ""}${run}`;
}

/** The trophies a sitting moved, when it was played on Trophy Road. */
export const trophyNet = (f = {}) =>
  typeof f.trophy_net === "number" && (f.by_mode?.ladder ?? 0) > 0
    ? f.trophy_net
    : null;

const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0");

/** The facts worth a chip (2026-11-16): the wins that took all three
 *  crowns, the widest win. Facts, never a verdict; nothing when none
 *  holds. */
export function sessionChips(f = {}, scores = null) {
  // The run of wins is in the headline (sessionHeadline).
  const chips = [];
  const three = scores?.three_crowns ?? 0;
  if (three >= 1 && (f.battles ?? 0) > 1)
    chips.push({
      key: "three",
      text: `${three} three-crown ${noun(three, "win")}`,
    });
  if (scores?.best_win && (f.battles ?? 0) > 1)
    chips.push({ key: "best", text: `Best win ${scores.best_win}` });
  return chips;
}

/** The deck caption: the deck played most, in how many of the battles, and
 *  how many other decks the sitting saw. */
export function deckCaption(f = {}) {
  const decks = f.decks ?? [];
  const top = decks[0] ?? null;
  if (!top?.label) return null;
  const n = f.battles ?? 0;
  const other = decks.length - 1;
  return {
    label: top.label,
    count:
      n > 1 && typeof top.battles === "number"
        ? `${top.battles} of ${n} battles`
        : null,
    // The switch, said (2026-11-16): the other decks by name and count,
    // so a sitting that changed deck reads as one that did.
    more:
      other > 0
        ? `+${other} more ${noun(other, "deck")}: ${decks
            .slice(1)
            .map((d) =>
              typeof d.battles === "number"
                ? `${d.label} (${d.battles})`
                : d.label,
            )
            .join(", ")}`
        : null,
  };
}

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
/** A sitting small enough for the compact card. */
export const compactSitting = (f = {}) => (f.battles ?? 0) <= 2;

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
      {/* Its eight cards, as kept when Home's week was built (design
          canvas, 2026-11-13); a week stored before then has the label
          alone. */}
      {deck ? (
        <div className={`kit-scard__deck${one ? " kit-scard__deck--one" : ""}`}>
          <DeckRow
            cards={deck.cards}
            showCost
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
