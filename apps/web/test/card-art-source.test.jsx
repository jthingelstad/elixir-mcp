import { test, expect } from "vitest";
import { cardArtSource } from "../src/components/CardArtSource.jsx";

/** The catalog's art as every tile reads it (2026-10-08). */
const ORIGIN = "https://elixir.poapkings.com/assets/cards";
const data = {
  cards: [
    {
      id: 26000042,
      name: "Electro Wizard",
      art: {
        base: `${ORIGIN}/26000042-285.png`,
        hero: `${ORIGIN}/26000042_hero-285.png`,
      },
    },
    { id: 26000999, name: "A card with no art" },
  ],
};

test("the catalog's art by card id; a card without art has none", () => {
  const source = cardArtSource({ isPending: false, isError: false, data });
  expect(source.status).toBe("ready");
  expect(source.art(26000042)?.hero).toBe(`${ORIGIN}/26000042_hero-285.png`);
  expect(source.art(26000999)).toBeNull();
  expect(source.art(1)).toBeNull();
});

test("loading draws empty frames; a failed read falls back to the mirror", () => {
  expect(cardArtSource({ isPending: true }).status).toBe("loading");
  expect(cardArtSource({ isPending: false, isError: true }).status).toBe(
    "unavailable",
  );
  expect(
    cardArtSource({ isPending: false, isError: false, data: {} }).status,
  ).toBe("unavailable");
});
