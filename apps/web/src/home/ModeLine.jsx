import { TagText } from "@elixir-mcp/ui";
import { modeChips } from "@elixir-mcp/ui/session-story";

/**
 * What a sitting's mode adds, as chips under its figures (2026-11-16,
 * docs/notes/2026-11-16-modes-in-the-timeline.md): a Ranked sitting's
 * league, its climb and, in Ultimate Champion, the rating; a challenge
 * run's furthest wins and drafted decks; and the followed players it was
 * played with or against. Facts the record holds, never a verdict; nothing
 * when the sitting carries none of them (an older stored week). The chips
 * themselves are the kit's session-story module's (`modeChips`), which the
 * digest prints too.
 */
export { modeChips };

/** The chips, drawn; nothing when there are none. Plain text: the card is
 *  one link, so a name here is never a link of its own. */
export function ModeLine({ facts }) {
  const chips = modeChips(facts ?? {});
  if (!chips.length) return null;
  return (
    <ul
      className="kit-scard__chips kit-scard__modes"
      aria-label="How it was played"
    >
      {chips.map((c) => (
        <li key={c.key} className="chip">
          <TagText>{c.text}</TagText>
        </li>
      ))}
    </ul>
  );
}
