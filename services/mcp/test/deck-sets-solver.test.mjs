/**
 * The deck-set search (services/mcp/src/deck-sets.mjs) without a
 * database: exact packing, the weakest deck counted twice, alternatives
 * that really differ, required and blocked cards, and each deck's value.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LOGIT_PER_LEVEL,
  deckValue,
  formAdvantage,
  nearMisses,
  packSets,
  setValue,
} from "../src/deck-sets.mjs";

/** A deck of eight cards starting at `first` (ids first..first+7). */
const deck = (key, value, ids) => ({ key, value, cards: new Set(ids) });
const run = (first) => Array.from({ length: 8 }, (_, i) => first + i);

test("packing is exact: the best set can leave out the single best deck", () => {
  // Deck A is the best alone but shares a card with B and with C; taking
  // it first (the greedy rule) leaves no fourth deck at all. The exact
  // search gives it up for B, C, D and E.
  const candidates = [
    deck("A", 1.0, [...run(100).slice(0, 7), 200]),
    deck("B", 0.9, [...run(200)]),
    deck("C", 0.85, [...run(300).slice(0, 7), 106]),
    deck("D", 0.8, run(400)),
    deck("E", 0.75, run(500)),
    deck("F", 0.1, [...run(600).slice(0, 7), 400]),
  ];
  const { sets, exhausted } = packSets(candidates, { count: 4 });
  assert.equal(exhausted, true);
  assert.deepEqual([...sets[0].keys].sort(), ["B", "C", "D", "E"]);
  // Every chosen deck is disjoint from every other.
  const cards = sets[0].keys.flatMap((k) => [
    ...candidates.find((c) => c.key === k).cards,
  ]);
  assert.equal(new Set(cards).size, 32, "32 distinct cards");
});

test("the weakest deck counts twice: a balanced set beats one carried by three strong decks", () => {
  // Same sum (2.4) both ways; the balanced set's weakest is 0.6, the other's 0.
  const balanced = [0.6, 0.6, 0.6, 0.6];
  const lopsided = [0.8, 0.8, 0.8, 0.0];
  assert.ok(setValue(balanced) > setValue(lopsided));
  const candidates = [
    ...lopsided.map((v, i) => deck(`L${i}`, v, run(100 * (i + 1)))),
    // The balanced decks share their first card with a lopsided deck each,
    // so the two sets compete for the same cards.
    ...balanced.map((v, i) =>
      deck(`B${i}`, v, [100 * (i + 1), ...run(1000 + 100 * i).slice(1)]),
    ),
  ];
  const { sets } = packSets(candidates, { count: 4 });
  // Three strong decks and the balanced deck that does not collide with
  // them (3.0 + 0.6 = 3.6) beat the lopsided four (2.4 + 0 = 2.4) and the
  // balanced four (2.4 + 0.6 = 3.0).
  assert.deepEqual([...sets[0].keys].sort(), ["B3", "L0", "L1", "L2"]);
  assert.equal(sets[0].value, 3.6);
  assert.ok(!sets[0].keys.includes("L3"), "the zero-value deck is not carried");
});

test("alternatives differ from every earlier set by at least two decks", () => {
  const candidates = Array.from({ length: 10 }, (_, i) =>
    deck(`D${i}`, 1 - i * 0.05, run(100 * (i + 1))),
  );
  const { sets } = packSets(candidates, { count: 4, alternatives: 3 });
  assert.equal(sets.length, 3);
  for (let a = 0; a < sets.length; a++)
    for (let b = a + 1; b < sets.length; b++) {
      const shared = sets[a].keys.filter((k) => sets[b].keys.includes(k));
      assert.ok(shared.length <= 2, `sets ${a} and ${b} share ${shared}`);
    }
  assert.ok(sets[0].value >= sets[1].value && sets[1].value >= sets[2].value);
});

test("a required card is in the set, and a blocked card never is", () => {
  const candidates = [
    deck("A", 1.0, run(100)),
    deck("B", 0.9, run(200)),
    deck("C", 0.8, run(300)),
    deck("D", 0.7, run(400)),
    deck("E", 0.2, run(500)),
  ];
  const required = packSets(candidates, { count: 4, require: [503] });
  assert.ok(required.sets[0].keys.includes("E"));
  const blocked = packSets(candidates, {
    count: 3,
    blocked: new Set([101]),
  });
  assert.ok(!blocked.sets[0].keys.includes("A"));
  // Nothing can satisfy a card no candidate holds: no set, said by absence.
  assert.deepEqual(packSets(candidates, { count: 4, require: [999] }).sets, []);
});

test("near misses name the card they lost to and the deck that holds it", () => {
  const candidates = [
    deck("A", 1.0, [...run(100).slice(0, 7), 200]),
    deck("B", 0.9, run(200)),
    deck("C", 0.85, [...run(300).slice(0, 7), 106]),
    deck("D", 0.8, run(400)),
    deck("E", 0.75, run(500)),
  ];
  const { sets } = packSets(candidates, { count: 4 });
  const misses = nearMisses(candidates, sets[0]);
  assert.equal(misses[0].key, "A");
  const withB = misses[0].conflicts.find((c) => c.with === "B");
  assert.deepEqual(withB.cards, [200]);
});

test("a deck's value: shrunk, level-corrected where levels are free, then fitted to the player", () => {
  const priors = { ladder: 0.5, ranked: 0.5, war: 0.5 };
  const base = {
    modes: { ladder: { battles: 100, wins: 60, mean_level_gap: 0 } },
    priors,
    ownMean: 14,
    target: 14,
    m: 20,
  };
  const even = deckValue(base);
  // A population one level up in ladder: its rate is worth 0.5 logit less.
  const edged = deckValue({
    ...base,
    modes: { ladder: { battles: 100, wins: 60, mean_level_gap: 1 } },
  });
  assert.ok(
    Math.abs(even.corpus_logit - edged.corpus_logit - LOGIT_PER_LEVEL) < 0.002,
  );
  // Ranked equalises levels: its gap is never corrected.
  const ranked = deckValue({
    ...base,
    modes: { ranked: { battles: 100, wins: 60, mean_level_gap: 1 } },
  });
  assert.equal(ranked.corpus_logit, even.corpus_logit);
  // Two levels under what the player fields costs a full logit.
  const under = deckValue({ ...base, ownMean: 12 });
  assert.equal(under.level_term, -1);
  // A deck they know gets the tie-break, nothing more.
  const known = deckValue({ ...base, yours: 5 });
  assert.equal(known.familiarity_term, 0.05);
  assert.equal(deckValue({ ...base, modes: {} }), null, "no record, no value");
});

test("a form's advantage is measured against its base form, never a bonus, and unmeasured when thin", () => {
  const m = 20;
  const prior = 0.5;
  const evo = { battles: 200, wins: 120 };
  const base = { battles: 200, wins: 100 };
  const a = formAdvantage({ form: evo, base, prior, m });
  assert.ok(a > 0.3 && a < 0.45, `${a}`);
  // A form that does worse than its base costs nothing.
  assert.equal(formAdvantage({ form: base, base: evo, prior, m }), 0);
  // Too few battles on either side: not measured.
  assert.equal(
    formAdvantage({ form: { battles: 10, wins: 9 }, base, prior, m }),
    null,
  );
  // A substituted deck carries it as a negative form_term.
  const v = deckValue({
    modes: { ladder: { battles: 100, wins: 60, mean_level_gap: 0 } },
    priors: { ladder: 0.5 },
    ownMean: 14,
    target: 14,
    formTerm: -a,
    m,
  });
  assert.equal(v.form_term, -a);
});
