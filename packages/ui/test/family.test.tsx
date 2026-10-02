import { test, expect, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  FAMILY_DOCS,
  FAMILY_PRODUCTS,
  FAMILY_SIGN_IN,
  Icon,
} from "../src/index.ts";

afterEach(cleanup);

// The manifest (src/family.json) names each product's icon as a string,
// and family.ts hands it on as an IconName. That is only true if Icon
// can draw it: a name outside the kit's set renders nothing, and the
// button would lose its glyph without a word.
test("every icon the manifest names is one the kit's Icon draws", () => {
  expect(FAMILY_PRODUCTS.length).toBeGreaterThan(0);
  for (const p of [...FAMILY_PRODUCTS, FAMILY_DOCS, FAMILY_SIGN_IN]) {
    const { container } = render(<Icon name={p.icon} size={17} />);
    expect(
      container.querySelector("svg"),
      `${p.label}: ${p.icon}`,
    ).toBeTruthy();
    cleanup();
  }
});

// The places are on the left and the game is the candy button on the
// right (canvas 2026-09-29): Console, Ladder, Clan, then Drop.
test("the manifest's places, in order, and the one game", () => {
  expect(FAMILY_PRODUCTS.filter((p) => !p.game).map((p) => p.key)).toEqual([
    "console",
    "ladder",
    "clan",
  ]);
  const games = FAMILY_PRODUCTS.filter((p) => p.game);
  expect(games.map((p) => [p.key, p.action, p.external])).toEqual([
    ["drop", "Play Drop", true],
  ]);
});
