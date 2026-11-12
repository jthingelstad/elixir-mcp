/**
 * Decks: every deck of the season in the chip's mode, with its record there.
 * battles_decks answers per mode, so a war record and a Trophy Road record never
 * sit in one row. Nothing here sums records across decks or modes, rates a deck
 * or reads a cause into a change.
 */
import { cardLabel } from "@elixir-mcp/ui";
import { shortDay } from "./ladder.js";

/** "your cards 0.60 levels above theirs", from mean_level_gap. For a
 *  player you follow (`own` false), "their cards 0.60 levels above their
 *  opponents'": "theirs" would be ambiguous. */
export function gapLine(gap, own = true) {
  if (gap == null) return null;
  const n = Number(gap);
  const [mine, other] = own
    ? ["your cards", "theirs"]
    : ["their cards", "their opponents'"];
  if (n === 0) return `${mine} level with ${other}`;
  const v = Math.abs(n).toFixed(2);
  return `${mine} ${v} ${v === "1.00" ? "level" : "levels"} ${
    n > 0 ? "above" : "below"
  } ${other}`;
}

/** "Sep 8 to Sep 18", or one day, in the account's zone. */
export function dayRange(first, last, zone) {
  const a = shortDay(first, zone);
  const b = shortDay(last, zone);
  if (!a) return b;
  if (!b || a === b) return a;
  return `${a} to ${b}`;
}

/** The forms in a deck, as a person reads them: "Evo Witch, Evo Royal
 *  Ghost". From the cards when the deck was read in full, else from the
 *  row's card_names, whose forms the tool prefixes. */
export function formNames(row) {
  if (Array.isArray(row?.cards))
    return row.cards
      .filter((c) => c.form && c.form !== "base")
      .map(cardLabel)
      .join(", ");
  return String(row?.card_names ?? "")
    .split(", ")
    .filter((n) => /^(Evo|Hero) /.test(n))
    .join(", ");
}

const FORM_WORD = { evolution: "evolution", hero: "hero" };

/**
 * Two decks of one mode with the same eight cards and a form moved, one
 * played after the other was put down (the earlier deck's last battle
 * before the later deck's first): the swap the board draws. `rows` are
 * one mode's decks read in full (cards with id and form). Consecutive
 * decks of the same cards pair up; decks played side by side do not,
 * because "before" and "after" would not be true of them.
 */
export function formSwaps(rows) {
  const full = rows.filter((r) => Array.isArray(r?.cards) && r.cards.length);
  const groups = new Map();
  for (const r of full) {
    const key = r.cards
      .map((c) => c.id)
      .sort((a, b) => a - b)
      .join(",");
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const swaps = [];
  for (const group of groups.values()) {
    const timed = [...group].sort(
      (a, b) => Date.parse(a.first_used) - Date.parse(b.first_used),
    );
    for (let i = 1; i < timed.length; i++) {
      const before = timed[i - 1];
      const after = timed[i];
      if (!(Date.parse(before.last_used) < Date.parse(after.first_used)))
        continue;
      const was = new Map(before.cards.map((c) => [c.id, c.form ?? "base"]));
      const moved = after.cards.filter(
        (c) => (c.form ?? "base") !== was.get(c.id),
      );
      if (!moved.length) continue;
      const movedIds = new Set(moved.map((c) => c.id));
      const forms = new Set(
        [...before.cards, ...after.cards]
          .filter((c) => movedIds.has(c.id) && c.form && c.form !== "base")
          .map((c) => c.form),
      );
      swaps.push({
        key: `${before.deck_hash}>${after.deck_hash}`,
        at: after.first_used,
        kind: forms.size === 1 ? FORM_WORD[[...forms][0]] : "form",
        before: {
          row: before,
          cards: before.cards.filter(
            (c) => movedIds.has(c.id) && c.form && c.form !== "base",
          ),
        },
        after: {
          row: after,
          cards: after.cards.filter(
            (c) => movedIds.has(c.id) && c.form && c.form !== "base",
          ),
        },
        unchanged: after.cards.filter((c) => !movedIds.has(c.id)),
      });
    }
  }
  return swaps.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** "Witch and Royal Ghost": card names (no form) joined for prose. */
export function nameList(cards) {
  const names = cards.map((c) => c.name);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** The record line of a deck: "22 battles · 15–7 · 68% won" is laid out by the
 *  row; this is the line under its cards. */
export function deckLine(row, full, zone, own = true) {
  return [
    dayRange(row.first_used, row.last_used, zone),
    full?.archetype?.average_elixir != null
      ? `${Number(full.archetype.average_elixir).toFixed(2)} average elixir`
      : null,
    row.tower_troop_name ?? null,
    gapLine(row.mean_level_gap, own),
  ]
    .filter(Boolean)
    .join(" · ");
}
