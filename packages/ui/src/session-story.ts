/**
 * A sitting told from its facts (2026-11-16): the headline, the figures'
 * trophies, the chips and the deck caption, as the web's session card draws
 * them and the digest prints them. One module, so the app and the mail say a
 * sitting the same way and cannot drift (the web card shipped first, in
 * apps/web src/home/Session.jsx and ModeLine.jsx; the digest followed the
 * same night, docs/notes/2026-11-16-digest-sessions.md).
 *
 * Plain functions over the item's `facts` (and the feed's `scores`): no
 * React, no markup. Every string is plain text, and a name in it is the
 * game's name as the facts carry it: each output escapes it (React does on
 * the web; packages/mail's `esc` in mail). Facts, never a verdict: nothing
 * here rates a sitting.
 */
import { noun } from "./noun.ts";

// The facts a sitting carries, as far as these functions read them. Loose
// on purpose: an older stored week lacks most of them.
type Facts = {
  battles?: number;
  won?: number;
  lost?: number;
  drawn?: number;
  won_in_a_row?: number | null;
  trophy_net?: number | null;
  by_mode?: Record<string, number>;
  events?: SessionEvent[];
  decks?: { label?: string; battles?: number }[];
  ranked?: Ranked | null;
  together?: Together[];
  [key: string]: unknown;
};
type SessionEvent = {
  name?: string;
  event_tag?: string;
  run_wins?: number;
  drawn_decks?: boolean;
};
type Ranked = {
  promotions?: { from_name?: string; to_name?: string }[];
  league_to_name?: string;
  rating?: { from?: number | null; to?: number | null } | null;
};
type Together = {
  player_tag?: string;
  name?: string;
  with?: number;
  against?: number;
};
type Scores = {
  three_crowns?: number;
  overtime_wins?: number;
  best_win?: string;
} | null;
export type Chip = { key: string; text: string };

/** The two kinds a sitting is told as. */
export const SITTINGS = new Set(["battle_session", "session_standout"]);

const MODE_WORDS: Record<string, string> = {
  ladder: "Trophy Road",
  ranked: "Ranked",
  war: "War",
  casual: "Casual",
  event: "Events",
};
/** A mode group as the game names it. */
export const modeWord = (mode: string) =>
  MODE_WORDS[mode] ?? `${mode.charAt(0).toUpperCase()}${mode.slice(1)}`;

/** The modes a sitting was played in, as the game names them: an event
 *  by its own name when the sitting was all one event. */
export function modesSaid(f: Facts = {}) {
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
export function wherePlayed(f: Facts = {}) {
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
export function sessionHeadline(f: Facts = {}) {
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
  if (!((f.won ?? 0) > 0)) return `${n} battles${where ? ` ${where}` : ""}`;
  return `Won ${f.won} of ${n}${where ? ` ${where}` : ""}${run}`;
}

/** The trophies a sitting moved, when it was played on Trophy Road. */
export const trophyNet = (f: Facts = {}) =>
  typeof f.trophy_net === "number" && (f.by_mode?.ladder ?? 0) > 0
    ? f.trophy_net
    : null;

/** A signed count as a card prints it: "+30", "−12" (a minus sign), "0". */
export const signedCount = (n: number) =>
  n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0";

/** A sitting small enough for the compact card, and one line in mail. */
export const compactSitting = (f: Facts = {}) => (f.battles ?? 0) <= 2;

/** The facts worth a chip (2026-11-16): the wins that took all three
 *  crowns, the wins the tiebreaker decided at the end of overtime
 *  (2026-11-17), the widest win. Facts, never a verdict; nothing when
 *  none holds. The headline stays the result (sessionHeadline). */
export function sessionChips(f: Facts = {}, scores: Scores = null): Chip[] {
  // The run of wins is in the headline (sessionHeadline).
  const chips: Chip[] = [];
  const three =
    scores?.three_crowns ??
    (typeof f.three_crown_wins === "number" ? f.three_crown_wins : 0);
  if (three >= 1 && (f.battles ?? 0) > 1)
    chips.push({
      key: "three",
      text: `${three} three-crown ${noun(three, "win")}`,
    });
  // A sitting's own facts say these since 2026-11-17 (MCP's
  // three_crown_wins, overtime_wins); the feed's scores say them too.
  const overtime =
    scores?.overtime_wins ??
    (typeof f.overtime_wins === "number" ? f.overtime_wins : 0);
  if (overtime >= 1)
    chips.push({
      key: "overtime",
      text: `${overtime} overtime ${noun(overtime, "win")}`,
    });
  if (scores?.best_win && (f.battles ?? 0) > 1)
    chips.push({ key: "best", text: `Best win ${scores.best_win}` });
  return chips;
}

const count = (x: number) => Number(x).toLocaleString("en-US");

function rankedChips(r: Ranked | null | undefined): Chip[] {
  if (!r) return [];
  const out: Chip[] = [];
  const ups = r.promotions ?? [];
  if (ups.length)
    out.push({
      key: "climb",
      text: `Climbed ${ups[0]?.from_name} to ${ups.at(-1)?.to_name}`,
    });
  else if (r.league_to_name)
    out.push({ key: "league", text: `Ranked: ${r.league_to_name}` });
  if (r.rating && r.rating.from != null && r.rating.to != null)
    out.push({
      key: "rating",
      text: `Rating ${count(r.rating.from)} to ${count(r.rating.to)}`,
    });
  return out;
}

function eventChips(events: SessionEvent[] = []): Chip[] {
  const out: Chip[] = [];
  for (const e of events) {
    if (!e?.name) continue;
    const bits: string[] = [];
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

function togetherChips(together: Together[] = []): Chip[] {
  return together
    .filter((p) => p?.name)
    .map((p) => ({
      key: `with-${p.player_tag}`,
      text:
        (p.with ?? 0) > 0 && (p.against ?? 0) > 0
          ? `With and against ${p.name}`
          : (p.with ?? 0) > 0
            ? `With ${p.name}`
            : `Against ${p.name}`,
    }));
}

/** What a sitting's mode adds (docs/notes/2026-11-16-modes-in-the-timeline.md):
 *  a Ranked sitting's league, its climb and, in Ultimate Champion, the
 *  rating; a challenge run's furthest wins and drafted decks; and the
 *  followed players it was played with or against, in reading order. */
export function modeChips(f: Facts = {}): Chip[] {
  return [
    ...rankedChips(f.ranked),
    ...eventChips(f.events),
    ...togetherChips(f.together),
  ];
}

/** The deck caption: the deck played most, in how many of the battles, and
 *  how many other decks the sitting saw. */
export function deckCaption(f: Facts = {}) {
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

/** A session's own page (2026-11-16), as a path: under its player's page,
 *  by the item's id, with its start so the read finds it in a short
 *  window. The tag goes without its hash. The web (apps/web lib/player.js
 *  `sessionHref`), the mail, the bell and Discord all build it here. */
export const sessionPath = (
  tag: string,
  id: string,
  at: string | null = null,
) =>
  `/home/player/${encodeURIComponent(String(tag ?? "").replace(/^#/, ""))}/session/${encodeURIComponent(id)}${
    at ? `?${new URLSearchParams({ at })}` : ""
  }`;

type Item = {
  id?: string;
  kind?: string;
  subject_tag?: string;
  facts?: { player_tag?: string; started_at?: string } & Facts;
  evidence?: { kind?: string } | null;
};

/** The path of the session an item tells, or null: a sitting with its id,
 *  its player and its start. Null for any other item, and for an old row
 *  that lacks one of them. */
export function sessionPathOf(it: Item | null | undefined) {
  if (!it || !SITTINGS.has(it.kind ?? "")) return null;
  const tag = it.facts?.player_tag ?? null;
  const at = it.facts?.started_at ?? null;
  return tag && it.id && it.evidence?.kind === "session"
    ? sessionPath(tag, it.id, at)
    : null;
}
