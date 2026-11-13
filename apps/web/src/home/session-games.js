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
