import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalDeckString, deckHash } from '../dist/index.js';

const cards = (...ids) => ids.map((id) => ({ id }));

test('hash is order-independent', () => {
  const a = { cards: cards(26000000, 26000001, 28000000), towerTroopId: 159000000 };
  const b = { cards: cards(28000000, 26000000, 26000001), towerTroopId: 159000000 };
  assert.equal(deckHash(a), deckHash(b));
});

test('evolution form is part of identity — forms never merge', () => {
  const base = { cards: [{ id: 26000000 }, { id: 26000001 }] };
  const evo = { cards: [{ id: 26000000, evolutionLevel: 1 }, { id: 26000001 }] };
  const hero = { cards: [{ id: 26000000, evolutionLevel: 2 }, { id: 26000001 }] };
  assert.notEqual(deckHash(base), deckHash(evo));
  assert.notEqual(deckHash(evo), deckHash(hero));
});

test('tower troop is part of identity; absence is 0', () => {
  const withTower = { cards: cards(26000000), towerTroopId: 159000000 };
  const without = { cards: cards(26000000) };
  assert.notEqual(deckHash(withTower), deckHash(without));
  assert.equal(canonicalDeckString(without), '26000000:0|0');
});

test('canonical string test vector is pinned', () => {
  const deck = {
    cards: [
      { id: 28000000 },
      { id: 26000000, evolutionLevel: 1 },
      { id: 26000037 },
    ],
    towerTroopId: 159000000,
  };
  // Pairs sort lexicographically as strings — this is the pinned contract.
  assert.equal(
    canonicalDeckString(deck),
    '26000000:1,26000037:0,28000000:0|159000000',
  );
});
