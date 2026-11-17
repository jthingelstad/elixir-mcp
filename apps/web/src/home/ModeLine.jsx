import { TagText } from "@elixir-mcp/ui";

/**
 * What a sitting's mode adds, as chips under its figures (2026-11-16,
 * docs/notes/2026-11-16-modes-in-the-timeline.md): a Ranked sitting's
 * league, its climb and, in Ultimate Champion, the rating; a challenge
 * run's furthest wins and drafted decks; and the followed players it was
 * played with or against. Facts the record holds, never a verdict; nothing
 * when the sitting carries none of them (an older stored week).
 */

const n = (x) => Number(x).toLocaleString("en-US");

function rankedChips(r) {
  if (!r) return [];
  const out = [];
  const ups = r.promotions ?? [];
  if (ups.length)
    out.push({
      key: "climb",
      text: `Climbed ${ups[0].from_name} to ${ups.at(-1).to_name}`,
    });
  else if (r.league_to_name)
    out.push({ key: "league", text: `Ranked: ${r.league_to_name}` });
  if (r.rating && r.rating.from != null && r.rating.to != null)
    out.push({
      key: "rating",
      text: `Rating ${n(r.rating.from)} to ${n(r.rating.to)}`,
    });
  return out;
}

function eventChips(events = []) {
  const out = [];
  for (const e of events) {
    if (!e?.name) continue;
    const bits = [];
    if (typeof e.run_wins === "number" && e.run_wins > 0)
      bits.push(`up to ${e.run_wins} ${e.run_wins === 1 ? "win" : "wins"}`);
    if (e.drawn_decks) bits.push("drafted decks");
    if (bits.length)
      out.push({
        key: `event-${e.event_tag ?? e.name}`,
        text: `${e.name}: ${bits.join(", ")}`,
      });
  }
  return out;
}

function togetherChips(together = []) {
  return together
    .filter((p) => p?.name)
    .map((p) => ({
      key: `with-${p.player_tag}`,
      text:
        p.with > 0 && p.against > 0
          ? `With and against ${p.name}`
          : p.with > 0
            ? `With ${p.name}`
            : `Against ${p.name}`,
    }));
}

/** The chips a sitting's facts give, in reading order. */
export function modeChips(f = {}) {
  return [
    ...rankedChips(f.ranked),
    ...eventChips(f.events),
    ...togetherChips(f.together),
  ];
}

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
