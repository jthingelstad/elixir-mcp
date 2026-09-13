/**
 * The Verify target draw (2026-09-13): the player's most-played recent
 * deck with two owned cards of similar elixir cost swapped in, never a
 * deck they played in the last month, random only without battles.
 * Pure over its inputs with an injected random, so every branch is
 * deterministic.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  drawTarget,
  mostPlayed,
  deckKey,
  deckIds,
  SWAPS,
} from "../src/routes/verify-draw.mjs";

const ids = (from, n = 8) => Array.from({ length: n }, (_, i) => from + i);
const costs = (owned) => new Map(owned.map((id) => [id, (id % 7) + 1]));
// A deterministic "random": walks a seed sequence.
function seeded(seq) {
  let i = 0;
  return (n) => seq[i++ % seq.length] % n;
}

test("deckKey ignores order and duplicates; deckIds wants eight distinct plain cards", () => {
  assert.equal(deckKey([8, 1, 3, 3]), "1,3,8");
  const plain = new Set(ids(1));
  assert.deepEqual(
    deckIds({ cards: ids(1).map((id) => ({ id })) }, plain),
    ids(1),
  );
  assert.equal(
    deckIds({ cards: ids(1, 7).map((id) => ({ id })) }, plain),
    null,
  );
  assert.equal(
    deckIds({ cards: [...ids(1, 7), 99].map((id) => ({ id })) }, plain),
    null,
    "a tower troop or unknown id does not complete a deck",
  );
});

test("mostPlayed: the deck seen most in the last ten, only if every card is owned", () => {
  const a = ids(1);
  const b = ids(20);
  const owned = new Set([...a, ...b, ...ids(40, 10)]);
  assert.deepEqual(mostPlayed([a, b, a, null, b, b], owned), b);
  assert.deepEqual(
    mostPlayed([a, b, a, b], owned),
    a,
    "ties go to the first seen, the newest",
  );
  assert.deepEqual(
    mostPlayed([ids(100), ids(100), a], owned),
    a,
    "unowned decks skipped",
  );
  assert.equal(mostPlayed([], owned), null);
});

test("drawTarget: two swaps of similar cost from the most-played deck, never the base, never a last-month deck", () => {
  const base = ids(1); // costs 2..7,1,2 by id%7+1
  const owned = new Set([...base, ...ids(20, 12)]);
  const cost = costs([...owned]);
  const lastMonth = new Set([deckKey(base)]);
  const t = drawTarget({
    owned,
    cost,
    recent: [base, base, ids(20)],
    lastMonth,
    random: seeded([3, 5, 1, 0, 2, 4, 6]),
  });
  assert.equal(t.source, "most_played");
  assert.equal(t.ids.length, 8);
  assert.equal(new Set(t.ids).size, 8);
  assert.equal(t.swapped.length, SWAPS);
  const kept = t.ids.filter((id) => base.includes(id));
  assert.equal(kept.length, 8 - SWAPS, "six of the player's own cards stay");
  for (const id of t.swapped) {
    assert.ok(
      owned.has(id) && !base.includes(id),
      "swapped-in cards are owned and new",
    );
    const out = base.find(
      (b) => !t.ids.includes(b) && Math.abs(cost.get(b) - cost.get(id)) <= 2,
    );
    assert.ok(out !== undefined, `a card of similar cost left for ${id}`);
  }
  assert.notEqual(deckKey(t.ids), deckKey(base));
  assert.ok(!lastMonth.has(deckKey(t.ids)));
});

test("drawTarget: a swap that lands on a deck played this month is redrawn", () => {
  const base = ids(1);
  const owned = new Set([...base, ...ids(20, 12)]);
  const cost = costs([...owned]);
  const seed = [3, 5, 1, 0, 2, 4, 6, 1, 1, 2];
  const first = drawTarget({
    owned,
    cost,
    recent: [base],
    lastMonth: new Set([deckKey(base)]),
    random: seeded(seed),
  });
  assert.equal(first.source, "most_played");
  // The same dice, but the deck they land on was played this month.
  const again = drawTarget({
    owned,
    cost,
    recent: [base],
    lastMonth: new Set([deckKey(base), deckKey(first.ids)]),
    random: seeded(seed),
  });
  assert.equal(again.source, "most_played");
  assert.notEqual(deckKey(again.ids), deckKey(first.ids));
  assert.equal(again.ids.filter((id) => base.includes(id)).length, 6);
});

test("drawTarget: a card swapped out is never swapped back in (5,000 real draws)", () => {
  const base = ids(1);
  const owned = new Set([...base, ...ids(20, 16)]);
  const cost = costs([...owned]);
  for (let k = 0; k < 5000; k += 1) {
    const t = drawTarget({ owned, cost, recent: [base], lastMonth: new Set() });
    assert.equal(t.ids.filter((id) => base.includes(id)).length, 8 - SWAPS);
    assert.equal(new Set(t.ids).size, 8);
    assert.ok(t.swapped.every((id) => !base.includes(id)));
  }
});

test("drawTarget: random eight owned cards when no battles are recorded", () => {
  const owned = new Set(ids(1, 12));
  const t = drawTarget({
    owned,
    cost: costs([...owned]),
    recent: [],
    lastMonth: new Set(),
    random: seeded([1, 2]),
  });
  assert.equal(t.source, "random");
  assert.equal(t.ids.length, 8);
  assert.deepEqual(t.swapped, []);
  assert.ok(t.ids.every((id) => owned.has(id)));
});
