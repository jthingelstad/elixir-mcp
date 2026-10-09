import { test, expect, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  CardArt,
  CardArtProvider,
  type CardArtSource,
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

test("the art is the mirror's one file per form: never a resized copy", () => {
  // Jamie, 2026-10-08: "you cannot resize the images or alter them in
  // anyway." 11.5.0 asked for -128, -192 or -285 copies by size.
  expect(cardArtSrc(26000000, "base")).toBe("/assets/cards/26000000.png");
  expect(cardArtSrc(26000000, "evolution")).toBe(
    "/assets/cards/26000000_evo.png",
  );
  expect(cardArtSrc(26000000, "hero")).toBe("/assets/cards/26000000_hero.png");
  expect(cardArtSrc(26000000, null)).toBe("/assets/cards/26000000.png");
});

test("the display size is the tile's width and height, whatever the size", () => {
  for (const size of [40, 64, 80, 160]) {
    cleanup();
    render(<CardArt card={hogs} size={size} />);
    const img = screen
      .getByRole("img", { name: "Evo Royal Hogs, level 15" })
      .querySelector("img");
    expect(img?.getAttribute("src")).toBe("/assets/cards/26000046_evo.png");
    expect(img?.getAttribute("width")).toBe(String(size));
    expect(img?.getAttribute("height")).toBe(
      String(Math.round((size * 420) / 285)),
    );
    expect(img?.hasAttribute("srcset")).toBe(false);
  }
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
    "/assets/cards/26000046_evo.png",
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

/**
 * The art the catalog names (2026-10-08: "Card art should be in the api
 * response for cards"). A journey found Hero Electro Wizard and Evo
 * Electro Giant as text on a top player's Ladder: the tile had guessed
 * file names the mirror had never written.
 */
const ORIGIN = "https://elixir.poapkings.com/assets/cards";
const catalog: CardArtSource = {
  status: "ready",
  art: (id) =>
    ({
      26000042: {
        base: `${ORIGIN}/26000042.png`,
        hero: `${ORIGIN}/26000042_hero.png`,
      },
      26000085: {
        base: `${ORIGIN}/26000085.png`,
        evolution: `${ORIGIN}/26000085_evo.png`,
      },
    })[id] ?? null,
};
const srcOf = (name: string) =>
  screen.getByRole("img", { name }).querySelector("img")?.getAttribute("src");

test("a tile draws the art the catalog names, as named, at its own size", () => {
  render(
    <CardArtProvider value={catalog}>
      <CardArt card={{ id: 26000042, name: "Electro Wizard", form: "hero" }} />
      <CardArt
        card={{ id: 26000085, name: "Electro Giant", form: "evolution" }}
        size={80}
      />
    </CardArtProvider>,
  );
  expect(srcOf("Hero Electro Wizard")).toBe(`${ORIGIN}/26000042_hero.png`);
  expect(srcOf("Evo Electro Giant")).toBe(`${ORIGIN}/26000085_evo.png`);
  const giant = screen
    .getByRole("img", { name: "Evo Electro Giant" })
    .querySelector("img");
  expect(giant?.getAttribute("width")).toBe("80");
  expect(giant?.getAttribute("height")).toBe("118");
});

test("a form the catalog has no art for draws the base card's", () => {
  render(
    <CardArtProvider value={catalog}>
      <CardArt card={{ id: 26000085, name: "Electro Giant", form: "hero" }} />
    </CardArtProvider>,
  );
  expect(srcOf("Hero Electro Giant")).toBe(`${ORIGIN}/26000085.png`);
});

test("art that fails steps down: the form, the base card, the name", () => {
  render(
    <CardArtProvider value={catalog}>
      <CardArt card={{ id: 26000042, name: "Electro Wizard", form: "hero" }} />
    </CardArtProvider>,
  );
  const tile = screen.getByRole("img", { name: "Hero Electro Wizard" });
  fireEvent.error(tile.querySelector("img")!);
  expect(tile.querySelector("img")?.getAttribute("src")).toBe(
    `${ORIGIN}/26000042.png`,
  );
  expect(tile.querySelector(".card-art__form--hero")?.textContent).toBe("Hero");
  fireEvent.error(tile.querySelector("img")!);
  expect(tile.querySelector("img")).toBeNull();
  expect(tile.querySelector(".card-art__blank")?.textContent).toBe(
    "Electro Wizard",
  );
});

test("a card the catalog lacks is its name; a loading catalog an empty frame", () => {
  render(
    <>
      <CardArtProvider value={catalog}>
        <CardArt card={{ id: 26000999, name: "Mirror" }} />
      </CardArtProvider>
      <CardArtProvider value={{ status: "loading", art: () => null }}>
        <CardArt card={{ id: 26000042, name: "Electro Wizard" }} />
      </CardArtProvider>
    </>,
  );
  const mirror = screen.getByRole("img", { name: "Mirror" });
  expect(mirror.querySelector(".card-art__blank")?.textContent).toBe("Mirror");
  const loading = screen.getByRole("img", { name: "Electro Wizard" });
  expect(loading.querySelector("img")).toBeNull();
  expect(loading.querySelector(".card-art__blank")).toBeNull();
});

test("without a catalog, the mirror's names, the form then the base", () => {
  render(
    <CardArt card={{ id: 26000042, name: "Electro Wizard", form: "hero" }} />,
  );
  const tile = screen.getByRole("img", { name: "Hero Electro Wizard" });
  expect(tile.querySelector("img")?.getAttribute("src")).toBe(
    "/assets/cards/26000042_hero.png",
  );
  fireEvent.error(tile.querySelector("img")!);
  expect(tile.querySelector("img")?.getAttribute("src")).toBe(
    "/assets/cards/26000042.png",
  );
});

test("the first tile asks for the catalog; a page with no tile never does", () => {
  let asked = 0;
  const source: CardArtSource = {
    status: "loading",
    art: () => null,
    want: () => {
      asked += 1;
    },
  };
  const { rerender } = render(
    <CardArtProvider value={source}>
      <p>no cards here</p>
    </CardArtProvider>,
  );
  expect(asked).toBe(0);
  rerender(
    <CardArtProvider value={source}>
      <CardArt card={{ id: 26000042, name: "Electro Wizard" }} />
    </CardArtProvider>,
  );
  expect(asked).toBe(1);
});
