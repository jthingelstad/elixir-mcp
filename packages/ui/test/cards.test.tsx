import { test, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  CardArt,
  cardArtSrc,
  cardLabel,
  DeckGrid,
  deckElixir,
  isTowerTroop,
  type DeckCard,
} from "../src/index.ts";

afterEach(cleanup);

/**
 * The kit's card tile (design canvas, 2026-10-01): one tile for every
 * surface that shows a card, so a deck reads the same on the battle page,
 * Ladder, Clan and the console.
 */
const hogs: DeckCard = {
  id: 26000046,
  name: "Royal Hogs",
  form: "evolution",
  level: 15,
};

test("the art is the smallest mirrored width that is sharp at 2x", () => {
  expect(cardArtSrc(26000000, "base", 40)).toBe(
    "/assets/cards/26000000-128.png",
  );
  expect(cardArtSrc(26000000, "base", 64)).toBe(
    "/assets/cards/26000000-128.png",
  );
  expect(cardArtSrc(26000000, "evolution", 72)).toBe(
    "/assets/cards/26000000_evo-192.png",
  );
  expect(cardArtSrc(26000000, "hero", 120)).toBe(
    "/assets/cards/26000000_hero-285.png",
  );
  expect(cardArtSrc(26000000, "hero", 400)).toBe(
    "/assets/cards/26000000_hero-285.png",
  );
});

test("a form is part of the card's name, never merged with the base", () => {
  expect(cardLabel(hogs)).toBe("Evo Royal Hogs");
  expect(cardLabel({ name: "Knight", form: "hero" })).toBe("Hero Knight");
  expect(cardLabel({ name: "Knight", form: "base" })).toBe("Knight");
  expect(cardLabel({ name: "Knight" })).toBe("Knight");
});

test("a tile without a link is one image named by card and level", () => {
  render(<CardArt card={hogs} />);
  const tile = screen.getByRole("img", { name: "Evo Royal Hogs, level 15" });
  expect(tile.tagName).toBe("SPAN");
  expect(tile.querySelector("img")?.getAttribute("src")).toBe(
    "/assets/cards/26000046_evo-128.png",
  );
  expect(tile.querySelector(".card-art__form--evolution")?.textContent).toBe(
    "Evo",
  );
  expect(tile.querySelector(".card-art__level")?.textContent).toBe("15");
});

test("a tile with a link is a real address", () => {
  render(<CardArt card={hogs} to="/cards/royal-hogs/" />);
  const a = screen.getByRole("link", { name: "Evo Royal Hogs, level 15" });
  expect(a.getAttribute("href")).toBe("/cards/royal-hogs/");
});

test("a tower troop has no mirrored art: its name stands in", () => {
  expect(isTowerTroop(159000000)).toBe(true);
  expect(isTowerTroop(26000000)).toBe(false);
  render(<CardArt card={{ id: 159000001, name: "Cannoneer", level: 14 }} />);
  const tile = screen.getByRole("img", { name: "Cannoneer, level 14" });
  expect(tile.querySelector("img")).toBeNull();
  expect(tile.querySelector(".card-art__blank")?.textContent).toBe("Cannoneer");
});

test("a deck is a list of eight tiles in the order played", () => {
  const cards = Array.from({ length: 8 }, (_, i) => ({
    id: 26000000 + i,
    name: `Card ${i}`,
    level: 14,
  }));
  render(<DeckGrid cards={cards} label="King Thing's deck" />);
  const list = screen.getByRole("list", { name: "King Thing's deck" });
  expect(list.className).toBe("deck-grid deck-grid--4");
  expect(screen.getAllByRole("listitem")).toHaveLength(8);
  expect(screen.getAllByRole("img")[0]?.getAttribute("aria-label")).toBe(
    "Card 0, level 14",
  );
});

test("a deck's elixir: the average to one place and the 4-card cycle", () => {
  const costs: Record<number, number> = {
    1: 2,
    2: 3,
    3: 4,
    4: 5,
    5: 1,
    6: 3,
    7: 4,
    8: 6,
  };
  const deck = Object.keys(costs).map((id) => ({ id: Number(id) }));
  expect(deckElixir(deck, (id) => costs[id])).toEqual({
    average: 3.5,
    cycle4: 9,
  });
});

test("a missing cost is never guessed", () => {
  expect(
    deckElixir([{ id: 1 }, { id: 2 }], (id) => (id === 1 ? 3 : null)),
  ).toEqual({
    average: null,
    cycle4: null,
  });
  expect(deckElixir([], () => 3)).toEqual({ average: null, cycle4: null });
});
