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

/** A sitting's numbers and its sparkline: battles, won, lost and, on
 *  Trophy Road, the trophies it moved; the deck it was played with most. */
export function Sitting({ it }) {
  const f = it.facts ?? {};
  const modes = Object.keys(f.by_mode ?? {});
  const trophies =
    typeof f.trophy_net === "number" && (f.by_mode?.ladder ?? 0) > 0
      ? `${f.trophy_net > 0 ? "+" : ""}${f.trophy_net} trophies`
      : null;
  const line = [
    `${f.battles ?? 0} battles`,
    `${f.won ?? 0} won`,
    `${f.lost ?? 0} lost`,
    trophies,
    modes.length === 1 ? modeWord(modes[0]) : null,
    f.decks?.[0]?.label ?? null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="kit-feed__sitting">
      <Sparkline spark={it.spark} />
      <span className="kit-tiny">
        <TagText>{line}</TagText>
      </span>
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
