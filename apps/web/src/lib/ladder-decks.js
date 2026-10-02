/**
 * Decks (LadderDecks.dc.html): every deck of the season, each judged in
 * the mode it was played in. battles_decks answers once over every mode
 * (which modes, which duel rounds) and then once per mode, so a war
 * record and a Trophy Road record never sit in one row; the rows here
 * are those answers, shaped. Nothing here sums records across decks or
 * modes, rates a deck or reads a cause into a change.
 */
import { cardLabel } from "@elixir-mcp/ui";
import { groupLabel } from "./ladder-days.js";
import { shortDay } from "./ladder.js";

/** Mode groups in reading order: the two trophy games first. */
const ORDER = [
  "ladder",
  "ranked",
  "war",
  "event",
  "challenge",
  "tournament",
  "casual",
];
const rank = (m) => {
  const i = ORDER.indexOf(m);
  return i < 0 ? ORDER.length : i;
};

/** The modes a deck is shown with its cards; every other mode's decks
 *  are rows of one table. */
export const GRID_MODES = ["ladder", "ranked"];

/** The modes to read one by one, from the every-mode answer: each mode
 *  a row was played in, and war when there were duel rounds (a duel is
 *  outside the rows, and duels are war's). */
export function modesOf(all) {
  const seen = new Set();
  for (const row of all?.decks ?? [])
    for (const [m, s] of Object.entries(row.modes ?? {}))
      if (Number(s?.battles ?? 0) > 0) seen.add(m);
  if ((all?.duel_decks ?? []).length) seen.add("war");
  return [...seen].sort((a, b) => rank(a) - rank(b));
}

/** How many decks the page shows: the distinct deck identities the
 *  every-mode answer returned, rows and duel rounds together. When the
 *  answer was cut at its limit, the tool's own total. */
export function deckCount(all) {
  if (all?.next_offset != null) return Number(all.total_decks ?? 0);
  const hashes = new Set();
  for (const d of [...(all?.decks ?? []), ...(all?.duel_decks ?? [])])
    hashes.add(d.deck_hash);
  return hashes.size;
}

const NUMBER = [
  "No",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
];
/** "Seven decks, three modes": small counts spelled, as the board does. */
export function decksTitle(decks, modes) {
  const n = (k) => NUMBER[k] ?? String(k);
  const lower = (k) => (NUMBER[k] ? n(k).toLowerCase() : n(k));
  return `${n(decks)} ${decks === 1 ? "deck" : "decks"}, ${lower(modes)} ${
    modes === 1 ? "mode" : "modes"
  }`;
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
  return cardNames(row)
    .filter((n) => /^(Evo|Hero) /.test(n))
    .join(", ");
}

/** The row's card_names as a list. */
const cardNames = (row) =>
  String(row?.card_names ?? "")
    .split(", ")
    .filter(Boolean);

/** Same eight cards in the same forms, whatever the order: a war deck
 *  (no tower troop) and a Trophy Road deck that are the same cards. */
const sameCards = (a, b) => {
  const x = cardNames(a).sort().join("|");
  return x !== "" && x === cardNames(b).sort().join("|");
};

/** "your cards 0.60 levels above theirs", from mean_level_gap. */
export function gapLine(gap) {
  if (gap == null) return null;
  const n = Number(gap);
  if (n === 0) return "your cards level with theirs";
  const v = Math.abs(n).toFixed(2);
  return `your cards ${v} ${v === "1.00" ? "level" : "levels"} ${
    n > 0 ? "above" : "below"
  } theirs`;
}

/** "Sep 8 – Sep 18", or one day, in the account's zone. */
export function dayRange(first, last, zone) {
  const a = shortDay(first, zone);
  const b = shortDay(last, zone);
  if (!a) return b;
  if (!b || a === b) return a;
  return `${a} – ${b}`;
}

/** "War, duels and events": the table's title, from what is in it. */
export function tableTitle(rows) {
  const parts = [];
  const has = (pred) => rows.some(pred);
  const PLURAL = {
    war: "War",
    event: "events",
    challenge: "challenges",
    tournament: "tournaments",
    casual: "casual battles",
    ladder: "Trophy Road",
    ranked: "Path of Legends",
  };
  for (const m of ORDER) {
    if (has((r) => r.mode === m && !r.duel)) parts.push(PLURAL[m]);
    if (m === "war" && has((r) => r.duel)) parts.push("duels");
  }
  if (!parts.length) return "Other modes";
  const words = parts.map((p, i) =>
    i === 0 ? p[0].toUpperCase() + p.slice(1) : p,
  );
  return words.length === 1
    ? words[0]
    : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

/**
 * The table: every deck of the modes shown without cards, mode by mode
 * in reading order, each mode's decks as the tool sorted them, then its
 * duel rounds. `byMode` maps a mode to its battles_decks answer. A duel
 * deck in the every-mode answer that no mode's answer claimed keeps no
 * mode rather than a guessed one.
 */
export function tableRows(byMode, all) {
  const rows = [];
  const claimed = new Set();
  const grid = GRID_MODES.flatMap((m) =>
    (byMode[m]?.decks ?? []).map((d) => ({ d, mode: m })),
  );
  const modes = Object.keys(byMode).sort((a, b) => rank(a) - rank(b));
  for (const mode of modes) {
    const body = byMode[mode];
    if (!GRID_MODES.includes(mode))
      for (const d of body?.decks ?? [])
        rows.push({
          key: `${mode}:${d.deck_hash}`,
          mode,
          modeLabel: groupLabel(mode),
          duel: false,
          label: d.archetype_label ?? "Unnamed deck",
          battles: d.battles,
          wins: d.wins,
          losses: d.losses,
          draws: d.draws ?? 0,
          forms: formNames(d),
          gap: gapLine(d.mean_level_gap),
          sameAs: grid.find((g) => sameCards(g.d, d))?.mode ?? null,
        });
    for (const d of body?.duel_decks ?? []) {
      claimed.add(d.deck_hash);
      rows.push(duelRow(d, mode));
    }
  }
  for (const d of all?.duel_decks ?? [])
    if (!claimed.has(d.deck_hash)) rows.push(duelRow(d, null));
  return rows;
}

function duelRow(d, mode) {
  return {
    key: `duel:${mode ?? "any"}:${d.deck_hash}`,
    mode,
    modeLabel: mode ? `${groupLabel(mode)} duel` : "Duel",
    duel: true,
    label: d.archetype_label ?? "Unnamed deck",
    battles: d.rounds,
    wins: d.wins,
    losses: d.losses,
    draws: 0,
    forms: formNames(d),
    gap: null,
    sameAs: null,
  };
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
