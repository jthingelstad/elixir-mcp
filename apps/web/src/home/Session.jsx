import { DeckRow, TagText } from "@elixir-mcp/ui";
import { modeWord } from "./logic.js";
import { Sparkline } from "./Sparkline.jsx";

/**
 * A sitting as every page draws it (slice 7, #765; G7, 2026-11-12: sessions
 * look the same everywhere): Home's feed, You's Timeline and a player's page.
 * The sparkline shows each battle's win or loss and its margin (Jamie,
 * 2026-11-11: "some sparkline that indicates win and loss as well as
 * magnitude"); the line beside it says the same facts in words.
 */
export const SITTINGS = new Set(["battle_session", "session_standout"]);

/** A sitting's numbers and its sparkline (the canvas's session tile,
 *  2026-11-13): battles, won, lost and, on Trophy Road, the trophies it
 *  moved, as figures; its bars; and the deck it was played with most. */
export function Sitting({ it }) {
  const f = it.facts ?? {};
  const modes = Object.keys(f.by_mode ?? {});
  const net =
    typeof f.trophy_net === "number" && (f.by_mode?.ladder ?? 0) > 0
      ? f.trophy_net
      : null;
  const deck = f.decks?.[0] ?? null;
  const note = sittingNote(f, it.scores);
  return (
    <div className="kit-feed__sitting">
      {modes.length > 0 ? (
        <p className="kit-feed__sub">
          {modes.length === 1
            ? modeWord(modes[0])
            : `${modes.slice(0, -1).map(modeWord).join(", ")} and ${modeWord(modes.at(-1))}`}
          {it.scores?.best_win ? ` · best win ${it.scores.best_win}` : ""}
        </p>
      ) : null}
      <div className="kit-stile">
        <dl className="kit-sfacts">
          <div>
            <dt>Battles</dt>
            <dd>{f.battles ?? 0}</dd>
          </div>
          <div>
            <dt>Won</dt>
            <dd className="kit-sfacts--won">{f.won ?? 0}</dd>
          </div>
          <div>
            <dt>Lost</dt>
            <dd>{f.lost ?? 0}</dd>
          </div>
          {net !== null ? (
            <div>
              <dt>Trophies</dt>
              <dd
                className={
                  net > 0 ? "kit-sfacts--up" : net < 0 ? "kit-sfacts--down" : ""
                }
              >
                {net > 0 ? `+${net}` : net}
              </dd>
            </div>
          ) : null}
        </dl>
        {note ? <p className="kit-stile__note">{note}</p> : null}
      </div>
      <Sparkline spark={it.spark} />
      {deck?.label ? (
        <p className="kit-decklabel">
          <b>
            <TagText>{deck.label}</TagText>
          </b>
          {typeof deck.battles === "number"
            ? ` · in ${deck.battles} of ${f.battles ?? deck.battles} battles`
            : ""}
        </p>
      ) : null}
      {/* Its eight cards, as kept when Home's week was built (design
          canvas, 2026-11-13); a week stored before then has the label
          alone. */}
      {it.deck?.cards?.length && it.deck.label === deck?.label ? (
        <DeckRow
          cards={it.deck.cards}
          showCost
          label={`${it.deck.label}, the deck played most`}
        />
      ) : null}
    </div>
  );
}

const COUNT_WORDS = ["no", "one", "two", "three", "four", "five"];
const countWord = (n) => COUNT_WORDS[n] ?? String(n);

/** The note right of a sitting's figures (design canvas, 2026-11-13): plain
 *  facts the figures don't already say. Its longest run of wins, when three
 *  or more, and two or more wins that took all three crowns.
 *  Nothing when neither holds. */
export function sittingNote(f, scores) {
  const parts = [];
  if (typeof f.won_in_a_row === "number" && f.won_in_a_row >= 3)
    parts.push(`${f.won_in_a_row} wins in a row`);
  const three = scores?.three_crowns ?? 0;
  if (three >= 2) parts.push(`${countWord(three)} 3-crown wins`);
  return parts.join(" · ");
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
