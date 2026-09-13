/**
 * The target deck (2026-09-13, Jamie: "make sure the deck we ask them to
 * play isn't miserable"). The first draw was eight random owned cards: a
 * deck nobody would play, built from scratch under a timer. Now the
 * target is the player's OWN most-played deck from their last ten
 * recorded battles with two cards swapped for owned cards of similar
 * elixir cost - playable by construction, recognisable at a glance, and
 * unmistakable as a challenge because of the two swaps. Any deck the
 * player has played in the last month is rejected as a target (a deck
 * they already run proves nothing about who is at the keyboard), and the
 * swap is redrawn until the result is new. A player with no recorded
 * battles still gets a random owned eight.
 *
 * Pure over its inputs; the route loads them. `random(n)` is injectable.
 */
import { randomInt } from "node:crypto";

export const SWAPS = 2;
const TRIES = 40;

export function deckKey(ids) {
  return [...new Set(ids.map(Number))].sort((a, b) => a - b).join(",");
}

function shuffleWith(list, random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = random(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The eight distinct plain-card ids of a stored deck, or null. */
export function deckIds(deck, plain) {
  const ids = (deck?.cards ?? [])
    .map((c) => Number(c?.id))
    .filter(Number.isFinite);
  const distinct = [...new Set(ids)].filter((id) => plain.has(id));
  return distinct.length === 8 ? distinct : null;
}

/** Most-played deck among `recent` (newest first): the key seen most, ties
 *  to the newest; only decks every card of which the player owns. */
export function mostPlayed(recent, owned) {
  const counts = new Map();
  for (const ids of recent) {
    if (!ids || !ids.every((id) => owned.has(id))) continue;
    const key = deckKey(ids);
    const c = counts.get(key) ?? { ids, n: 0 };
    c.n += 1;
    counts.set(key, c);
  }
  let best = null;
  for (const c of counts.values()) if (!best || c.n > best.n) best = c;
  return best?.ids ?? null;
}

/** Owned cards outside the BASE deck (never one the swap itself just
 *  took out - a card swapped out and back in is no swap), nearest in
 *  elixir cost first (within 1, then 2, then anything); unknown costs
 *  sort last. */
function swapCandidates(out, base, owned, cost) {
  const inBase = new Set(base);
  const pool = [...owned].filter((id) => !inBase.has(id));
  const c0 = cost.get(out);
  const dist = (id) =>
    c0 == null || cost.get(id) == null ? 9 : Math.abs(cost.get(id) - c0);
  const near = pool.filter((id) => dist(id) <= 1);
  if (near.length) return near;
  const mid = pool.filter((id) => dist(id) <= 2);
  return mid.length ? mid : pool;
}

/**
 * Draw the target. `owned`: Set of owned plain card ids; `cost`: Map of
 * card id -> elixir cost; `recent`: the player's last ten decks as id
 * arrays, newest first; `lastMonth`: Set of deckKey()s played in the
 * last 30 days. Returns { ids, source, swapped } where source is
 * 'most_played' or 'random' and swapped lists the cards put in.
 */
export function drawTarget({
  owned,
  cost,
  recent,
  lastMonth,
  random = randomInt,
}) {
  const base = mostPlayed(recent, owned);
  if (base && owned.size >= 8 + SWAPS) {
    for (let t = 0; t < TRIES; t += 1) {
      const deck = [...base];
      const outs = shuffleWith(deck, random).slice(0, SWAPS);
      const swapped = [];
      for (const out of outs) {
        const options = swapCandidates(out, base, owned, cost).filter(
          (id) => !swapped.includes(id),
        );
        if (!options.length) break;
        const pick = options[random(options.length)];
        deck[deck.indexOf(out)] = pick;
        swapped.push(pick);
      }
      if (swapped.length !== SWAPS) break;
      const key = deckKey(deck);
      if (key !== deckKey(base) && !lastMonth.has(key))
        return { ids: deck, source: "most_played", swapped };
    }
  }
  // No usable recent deck (or every swap landed on a deck they already
  // run): eight random owned cards, still never one they played lately.
  for (let t = 0; t < TRIES; t += 1) {
    const ids = shuffleWith([...owned], random).slice(0, 8);
    if (!lastMonth.has(deckKey(ids)))
      return { ids, source: "random", swapped: [] };
  }
  return {
    ids: shuffleWith([...owned], random).slice(0, 8),
    source: "random",
    swapped: [],
  };
}
