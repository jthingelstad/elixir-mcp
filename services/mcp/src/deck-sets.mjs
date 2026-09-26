/**
 * Deck sets (battles_deck_sets, 9.4.0; Jamie, 2026-09-25): the decks a
 * player could field together, N of them sharing no card, chosen from
 * decks the season's recorded players actually played. Clan Wars asks for
 * four decks with 32 distinct cards; a card and its Evolution or Hero form
 * are the same card (the tower troop is not one of the 32).
 *
 * Why it lives here and not in a prompt: an agent handed the meta and a
 * collection returned "war sets" repeating six cards (dry runs of real
 * member questions, 2026-09-25), and choosing decks one at a time fails at
 * the last deck ("even if you're able to construct 3 meta decks, the 4th
 * deck is always a struggle", RoyaleAPI, 2022). Packing is a small exact
 * search, so it is solved once, here, for every agent and every person
 * asking Claude directly.
 *
 * Facts, never judgments: every number a deck carries is a record or a
 * measured effect, and the order the search optimises is written out in
 * `SET_OBJECTIVE`, term by term, so an agent can say why a set won.
 *
 * This module is pure (no I/O): the tool gathers rows, this scores and
 * packs them.
 */

/** The modes a deck's record pools (Jamie, 2026-09-25: "all competitive
 *  modes is just more data"): Trophy Road, Path of Legends and Clan Wars.
 *  Casual, challenges, tournaments and events are other games. */
export const SET_MODES = ["ladder", "ranked", "war"];

/** Log-odds per deck level where levels are free, measured on the corpus
 *  (docs/reviews/2026-09-19-PILOT-SCORE-ASSESSMENT.md: ladder 0.50, war
 *  0.50). Ranked equalises levels, so its rows are not corrected: a
 *  residual gap there marks an under-developed account, not card power. */
export const LOGIT_PER_LEVEL = 0.5;
const LEVEL_CORRECTED = new Set(["ladder", "war"]);

/** A deck the player has played at least this often this season is one
 *  they know; it earns a tie-break, not a thumb on the scale (a 2026 study
 *  of 926k matches links switching decks to lower win rates, unquantified
 *  here, so the bonus stays small). */
export const FAMILIAR_MIN_BATTLES = 5;
const FAMILIARITY_LOGIT = 0.05;

/** The level floor: a card MORE than this many levels under the level the
 *  player fields leaves the deck out (min_level < target - 4); at or above
 *  it, level_term prices the gap.
 *  It shipped at 2 (the "war ready" rule other builders label with) and
 *  left one maxed account 3 decks of 889 (2026-09-25): a player who fields
 *  level 16 holds few decks with no card under 14, and a floor that tight
 *  refuses the question instead of pricing the gap. */
export const MAX_CARD_LEVELS_BELOW = 4;

/** What the search maximises, as the response states it. */
export const SET_OBJECTIVE = {
  deck_value:
    "corpus_logit + level_term + form_term + familiarity_term, in log-odds: corpus_logit pools the deck's shrunk win rate over Trophy Road, Path of Legends and Clan Wars by battles, each Trophy Road and Clan Wars rate first corrected for its players' level edge at 0.5 log-odds per level; level_term is 0.5 per level the player would field the deck above (+) or below (-) the level they field now; form_term, on a deck played with an Evolution or Hero form the player has not unlocked (they would play the base card), subtracts each such card's measured form advantage this season (its form's shrunk win rate against its base form's, in log-odds, never a bonus); familiarity_term is 0.05 when they have played these eight cards 5+ times this season (any tower troop; each Clan Wars duel round is a game)",
  set_value:
    "the sum of the deck values plus the weakest deck's value again, so a set is not carried by three strong decks and one weak one: every war day asks for all four",
  constraint:
    "no card appears in two decks (a card's Evolution or Hero form is the same card; the tower troop is not counted)",
};

const clamp = (p) => Math.min(0.999, Math.max(0.001, p));
const logit = (p) => Math.log(clamp(p) / (1 - clamp(p)));
const round = (x, d = 3) =>
  x === null || x === undefined ? null : Number(x.toFixed(d));

/** Empirical-Bayes shrinkage toward a prior mean, as the meta tools do. */
function shrink(wins, decided, prior, m) {
  return (wins + m * prior) / (decided + m);
}

/**
 * One deck's value for one player.
 *   modes:   { [mode]: { battles, wins, mean_level_gap|null } } over SET_MODES
 *   priors:  { [mode]: corpus mean win rate } (0.5 when unknown)
 *   ownMean: the mean level the player would field the deck at
 *   target:  the level the player fields now (null: no level term)
 *   yours:   the player's own games on these eight cards (duel rounds count)
 *   formTerm: minus the measured advantage of each form played as its base
 *   m:       the prior strength (META_METHODOLOGY.prior_strength)
 * Returns the parts and their sum, all in log-odds, plus the pooled
 * shrunk win rate the corpus part is built from (for reading).
 */
export function deckValue({
  modes,
  priors,
  ownMean,
  target,
  yours = 0,
  formTerm = 0,
  m,
}) {
  let battles = 0;
  let weighted = 0;
  let wins = 0;
  let shrunkWeighted = 0;
  for (const mode of SET_MODES) {
    const r = modes[mode];
    if (!r || !r.battles) continue;
    const prior = priors[mode] ?? 0.5;
    const s = shrink(r.wins, r.battles, prior, m);
    const gap =
      LEVEL_CORRECTED.has(mode) && r.mean_level_gap !== null
        ? r.mean_level_gap
        : 0;
    weighted += r.battles * (logit(s) - LOGIT_PER_LEVEL * gap);
    shrunkWeighted += r.battles * s;
    battles += r.battles;
    wins += r.wins;
  }
  if (battles === 0) return null;
  const corpus = weighted / battles;
  const level =
    target === null || ownMean === null
      ? 0
      : LOGIT_PER_LEVEL * (ownMean - target);
  const familiarity = yours >= FAMILIAR_MIN_BATTLES ? FAMILIARITY_LOGIT : 0;
  return {
    battles,
    wins,
    shrunk_win_rate: round(shrunkWeighted / battles),
    corpus_logit: round(corpus),
    level_term: round(level),
    form_term: round(formTerm),
    familiarity_term: familiarity,
    value: round(corpus + level + formTerm + familiarity),
  };
}

/**
 * One card's measured form advantage this season, in log-odds: its form's
 * shrunk win rate against its base form's (card_meta_season, every mode),
 * floored at 0 so a form that does worse never earns a bonus. null when
 * either form has too few battles to say (MIN_FORM_BATTLES).
 */
const MIN_FORM_BATTLES = 30;
export function formAdvantage({ form, base, prior, m }) {
  if (!form || !base) return null;
  if (form.battles < MIN_FORM_BATTLES || base.battles < MIN_FORM_BATTLES)
    return null;
  const f = logit(shrink(form.wins, form.battles, prior, m));
  const b = logit(shrink(base.wins, base.battles, prior, m));
  return round(Math.max(0, f - b));
}

/** The set's value: every deck once, the weakest twice. */
export function setValue(values) {
  if (values.length === 0) return -Infinity;
  return values.reduce((s, v) => s + v, 0) + Math.min(...values);
}

/**
 * The best sets of `count` decks sharing no card, exactly, by branch and
 * bound over candidates sorted by value (highest first).
 *
 *   candidates:   [{ key, cards: Set<card id>, value }]
 *   count:        decks to choose (1-4)
 *   alternatives: how many sets to return; each after the first shares at
 *                 most count - minDiffer decks with every earlier one
 *   require:      card ids that must appear somewhere in the set
 *   blocked:      card ids no chosen deck may hold (the locked decks' cards)
 *   fixed:        the locked decks' values: they are in every set, so the
 *                 objective (every deck once, the weakest twice) counts
 *                 them, and a weak locked deck is the set's weakest
 *   nodeBudget:   search nodes before it stops with the best found so far
 *
 * Returns { sets: [{ keys, value }], exhausted } where exhausted false
 * means a search stopped at the budget (its set is the best it found).
 * A set's value is the whole set's, locked decks included.
 */
export function packSets(
  candidates,
  {
    count,
    alternatives = 1,
    minDiffer = 2,
    require = [],
    blocked = new Set(),
    fixed = [],
    nodeBudget = 2_000_000,
  },
) {
  const fixedSum = fixed.reduce((sum, v) => sum + v, 0);
  const fixedMin = fixed.length ? Math.min(...fixed) : Infinity;
  const pool = candidates
    .filter((c) => ![...c.cards].some((id) => blocked.has(id)))
    .sort((a, z) => z.value - a.value || (a.key < z.key ? -1 : 1));
  const need = require.filter((id) => !blocked.has(id));
  // A required card no candidate holds makes every set unacceptable, and
  // the search would learn that only at the leaves, after its whole node
  // budget (feedback #364: require and exclude naming one card timed
  // out). Settled before the search.
  if (need.some((id) => !pool.some((c) => c.cards.has(id))))
    return { sets: [], exhausted: true };
  const found = [];
  let exhausted = true;
  const maxShared = count - Math.min(minDiffer, count);
  for (let alt = 0; alt < alternatives; alt++) {
    let best = null;
    let bestValue = -Infinity;
    let nodes = 0;
    const chosen = [];
    const used = new Set();
    const acceptable = (keys) =>
      found.every(
        (f) => keys.filter((k) => f.keys.includes(k)).length <= maxShared,
      ) && need.every((id) => chosen.some((i) => pool[i].cards.has(id)));
    const search = (start, sum, min) => {
      if (nodes++ > nodeBudget) return false;
      const r = count - chosen.length;
      if (r === 0) {
        const keys = chosen.map((i) => pool[i].key);
        const value = fixedSum + sum + Math.min(min, fixedMin);
        if (value > bestValue && acceptable(keys)) {
          bestValue = value;
          best = { keys, value: round(value) };
        }
        return true;
      }
      for (let i = start; i <= pool.length - r; i++) {
        const v = pool[i].value;
        // Sorted descending: r more picks add at most r * v, and the set's
        // minimum can be no higher than v or the minimum so far.
        if (fixedSum + sum + r * v + Math.min(min, v, fixedMin) <= bestValue)
          break;
        const cards = pool[i].cards;
        let clash = false;
        for (const id of cards)
          if (used.has(id)) {
            clash = true;
            break;
          }
        if (clash) continue;
        chosen.push(i);
        for (const id of cards) used.add(id);
        const ok = search(i + 1, sum + v, Math.min(min, v));
        for (const id of cards) used.delete(id);
        chosen.pop();
        if (!ok) return false;
      }
      return true;
    };
    if (count === 0) {
      // Every deck locked: the set is the locked decks alone.
      if (alt === 0 && acceptable([]))
        found.push({ keys: [], value: round(fixedSum + fixedMin) });
      break;
    }
    if (!search(0, 0, Infinity)) exhausted = false;
    if (!best) break;
    found.push(best);
  }
  return { sets: found, exhausted };
}

/**
 * What almost made the first set, and why not: decks worth at least the
 * set's weakest deck that are not in it, each with the cards it shares
 * with the set's decks (a deck the set had to give up for a card another
 * deck holds). At most `limit`.
 */
export function nearMisses(pool, set, { limit = 5 } = {}) {
  if (!set) return [];
  const inSet = pool.filter((c) => set.keys.includes(c.key));
  const weakest = Math.min(...inSet.map((c) => c.value));
  return pool
    .filter((c) => !set.keys.includes(c.key) && c.value >= weakest)
    .sort((a, z) => z.value - a.value)
    .slice(0, limit)
    .map((c) => ({
      key: c.key,
      value: c.value,
      conflicts: inSet
        .map((d) => ({
          with: d.key,
          cards: [...c.cards].filter((id) => d.cards.has(id)),
        }))
        .filter((x) => x.cards.length > 0),
    }));
}
