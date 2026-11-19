/**
 * An opened session's games, as plain data for the view (Home's opened
 * session, 2026-11-13). Facts the read carries, said or left out; never
 * guessed.
 */

/** Consecutive games played with one deck, newest first: the run of each
 *  deck in the order the page holds them. A game with no recorded deck is
 *  a run of its own kind (`deck: null`), so it never sits under another
 *  deck's cards. */
export function deckRuns(battles = [], decks = []) {
  const runs = [];
  for (const b of battles) {
    const key = typeof b.deck === "number" ? b.deck : null;
    const last = runs.at(-1);
    if (last && last.key === key) last.games.push(b);
    else
      runs.push({
        key,
        deck: key === null ? null : (decks[key] ?? null),
        games: [b],
      });
  }
  return runs;
}

/** The score a row prints, or null when the record lacks a side. A duel's
 *  crowns are summed over its games, a score it never had: it prints its
 *  games won to lost instead, when every game's result is known. */
export function gameScore(b) {
  if (Array.isArray(b.games) && b.games.length) {
    if (b.games.some((g) => g.outcome === null)) return null;
    const won = b.games.filter((g) => g.outcome === "win").length;
    return `${won}–${b.games.length - won}`;
  }
  const theirs = b.opponents?.[0]?.crowns;
  return Number.isFinite(b.crowns) && Number.isFinite(theirs)
    ? `${b.crowns}–${theirs}`
    : null;
}

/** A trophy change worth printing: any number on Trophy Road (a zero
 *  there is a fact), elsewhere only one that moved. */
export function trophyWord(b) {
  const t = b.trophy_change;
  if (typeof t !== "number") return null;
  if (t === 0 && b.mode_group !== "ladder") return null;
  return t > 0 ? `+${t}` : t < 0 ? `−${Math.abs(t)}` : "0";
}

/** Whether two decks are the same eight cards in the same forms. */
export function sameCards(a, b) {
  if (!a?.cards?.length || !b?.cards?.length) return false;
  if (a.cards.length !== b.cards.length) return false;
  const key = (d) =>
    d.cards
      .map((c) => `${c.id}:${c.form ?? "base"}`)
      .sort()
      .join(",");
  return key(a) === key(b);
}

/** A player as a row names them: the in-game name, else the public tag. */
export const nameOf = (p) => p?.name ?? p?.player_tag ?? "Unknown";

/** An English ordinal: 1st, 2nd, 3rd, 4th, 11th, 21st. */
export function ordinal(n) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th"}`;
}

/**
 * The games that mattered on a session's page (2026-11-16), as plain facts
 * on their rows: a win that took all three crowns, the win that ended a run
 * of three or more, and the moments the server says a game proved ("New
 * best: 7,512 trophies"). The run needs the sitting's battles in played
 * order (`spark`) to line up with the page: it is said only when the strip
 * holds every recorded game. A Map of battle id to its words.
 */
export function battleHighlights(b) {
  if (b.outcome !== "win" || b.type === "boatBattle") return [];
  if (b.games?.length || /duel/i.test(b.type ?? "")) {
    const comeback =
      b.games?.length === 3 &&
      b.games.every(
        (g, i) => g.round === i + 1 && g.outcome === ["loss", "win", "win"][i],
      );
    return comeback ? ["Won the duel after losing game one"] : [];
  }
  const words = b.crowns === 3 ? ["Three crowns"] : [];
  if (
    b.opponents?.length === 1 &&
    !b.teammates?.length &&
    b.surviving_tower_hp > 0 &&
    b.surviving_tower_hp <= 100
  )
    words.push(`Won with a tower at ${b.surviving_tower_hp} HP`);
  return words;
}

export function gameMarks(
  battles = [],
  { spark = null, count = 0, offset = 0, marks = [] } = {},
) {
  const out = new Map();
  const add = (id, word) => {
    if (!id || !word) return;
    const list = out.get(id) ?? [];
    if (!list.includes(word)) list.push(word);
    out.set(id, list);
  };
  for (const m of marks) add(m.battle_id, m.label);
  const runs =
    Array.isArray(spark) && spark.length === count && count > 0
      ? spark.reduce((acc, b, i) => {
          acc.push(b.r === "w" ? (i ? acc[i - 1] : 0) + 1 : 0);
          return acc;
        }, [])
      : null;
  battles.forEach((b, j) => {
    for (const word of battleHighlights(b)) add(b.battle_id, word);
    if (!runs) return;
    // The page is newest first; the strip is in played order.
    const i = count - 1 - (offset + j);
    if (i < 0 || i >= count) return;
    const ends = i === count - 1 || spark[i + 1].r !== "w";
    if (spark[i].r === "w" && runs[i] >= 3 && ends && b.outcome === "win")
      add(b.battle_id, `${ordinal(runs[i])} win in a row`);
  });
  return out;
}
