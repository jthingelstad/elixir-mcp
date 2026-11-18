import { expect, test } from "vitest";
import { deckDisplayCards } from "../src/deck-display.ts";

const deck = (forms: Record<number, string> = {}) =>
  Array.from({ length: 8 }, (_, id) => ({
    id,
    form: forms[id] ?? "base",
    name: `Card ${id}`,
    level: id + 1,
  }));
const ids = (cards: { id: number }[]) => cards.map((c) => c.id);

test.each([
  [{ 5: "evolution", 3: "hero", 7: "evolution" }, [5, 3, 7, 0, 1, 2, 4, 6]],
  [{ 5: "evolution", 3: "hero", 7: "hero" }, [5, 3, 7, 0, 1, 2, 4, 6]],
  [{ 5: "evolution", 7: "evolution" }, [5, 0, 7, 1, 2, 3, 4, 6]],
  [{ 5: "hero", 7: "hero" }, [0, 5, 7, 1, 2, 3, 4, 6]],
  [{ 5: "hero" }, [0, 5, 1, 2, 3, 4, 6, 7]],
  [{ 5: "evolution" }, [5, 0, 1, 2, 3, 4, 6, 7]],
  [{}, [0, 1, 2, 3, 4, 5, 6, 7]],
])("uses only the active forms for Evo, Hero and Wild: %j", (forms, order) => {
  const cards = Object.freeze(deck(forms).map((c) => Object.freeze(c)));
  const shown = deckDisplayCards(cards);
  expect(ids(shown)).toEqual(order);
  expect(shown).not.toBe(cards);
  expect(shown.every((c) => c === cards[c.id])).toBe(true);
  expect(ids([...cards])).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  expect(deckDisplayCards(shown)).toEqual(shown);
});

test("a catalog Champion uses the Hero position without changing its form", () => {
  const cards = deck({ 7: "evolution" });
  const shown = deckDisplayCards(cards, (id) =>
    id === 4 ? "champion" : "common",
  );
  expect(ids(shown)).toEqual([7, 4, 0, 1, 2, 3, 5, 6]);
  expect(shown[1]?.form).toBe("base");
  const enriched = cards.map((c) => ({
    ...c,
    rarity: c.id === 4 ? "champion" : "common",
  }));
  expect(ids(deckDisplayCards(enriched))).toEqual(ids(shown));
});

test("a Champion and Hero can occupy the Hero and Wild positions", () => {
  const cards = deck({ 7: "evolution", 6: "hero" }).map((c) => ({
    ...c,
    rarity: c.id === 2 ? "champion" : "common",
  }));
  expect(ids(deckDisplayCards(cards))).toEqual([7, 2, 6, 0, 1, 3, 4, 5]);
});

test("ownership, capability, missing metadata and art never invent active forms", () => {
  const cards = deck().map((c) => ({
    ...c,
    evolutionLevel: 3,
    maxEvolutionLevel: 3,
    art: { hero: "hero.png", evolution: "evo.png" },
  }));
  expect(deckDisplayCards(cards)).toEqual(cards);
});

test("non-eight-card lists and layouts beyond current slot rules keep their order", () => {
  const special = deck({
    1: "evolution",
    3: "evolution",
    5: "hero",
    7: "hero",
  });
  for (const cards of [
    special,
    deck({ 1: "evolution", 3: "evolution", 5: "evolution" }),
    special.slice(0, 4),
    [...special, ...special.slice(0, 4)],
    [...special, ...special],
  ]) {
    expect(deckDisplayCards(cards)).toEqual(cards);
  }
});
