import { TagText } from "@elixir-mcp/ui";
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
  return (
    <div className="kit-feed__sitting">
      {modes.length > 0 ? (
        <p className="kit-feed__sub">
          {modes.length === 1
            ? modeWord(modes[0])
            : `${modes.slice(0, -1).map(modeWord).join(", ")} and ${modeWord(modes.at(-1))}`}
        </p>
      ) : null}
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
    </div>
  );
}

/** What an item's evidence toggle says, open or closed: a sitting's games,
 *  or a moment's crossing. */
export const evidenceWord = (it, open) =>
  it.evidence.kind === "session"
    ? open
      ? "Close games"
      : "View games"
    : open
      ? "Close crossing"
      : "View crossing";
