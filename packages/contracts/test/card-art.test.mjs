import { test } from "node:test";
import assert from "node:assert/strict";
import * as contracts from "../dist/index.js";

const { cardArt, cardArtFor, cardArtPath } = contracts;

// The two the 2026-10-08 journey found as text: the catalog's own
// iconUrls (cr-agent-api-docs: medium always, evolutionMedium and
// heroMedium only for a card with that form).
const ELECTRO_WIZARD = {
  medium: "https://api-assets.clashroyale.com/cards/300/a.png",
  heroMedium: "https://api-assets.clashroyale.com/cardheroes/300/a.png",
};
const ELECTRO_GIANT = {
  medium: "https://api-assets.clashroyale.com/cards/300/b.png",
  evolutionMedium:
    "https://api-assets.clashroyale.com/cardevolutions/300/b.png",
};

test("art is one Elixir URL per form the API's iconUrls carry", () => {
  assert.deepEqual(cardArt(26000042, ELECTRO_WIZARD), {
    base: "https://elixir.poapkings.com/assets/cards/26000042.png",
    hero: "https://elixir.poapkings.com/assets/cards/26000042_hero.png",
  });
  assert.deepEqual(cardArt(26000085, ELECTRO_GIANT), {
    base: "https://elixir.poapkings.com/assets/cards/26000085.png",
    evolution: "https://elixir.poapkings.com/assets/cards/26000085_evo.png",
  });
  assert.equal(cardArt(26000999, null), null, "no icons, no art");
  assert.equal(cardArt(26000999, {}), null);
  assert.equal(
    cardArt(159000000, { medium: "https://x/t.png" }),
    null,
    "tower troops are not mirrored",
  );
});

test("a form the catalog lacks draws the base card", () => {
  const art = cardArt(26000042, ELECTRO_WIZARD);
  assert.match(cardArtFor(art, "hero"), /26000042_hero\.png$/);
  assert.match(cardArtFor(art, "evolution"), /26000042\.png$/);
  assert.match(cardArtFor(art, null), /26000042\.png$/);
  assert.equal(cardArtFor(null, "hero"), null, "no art: the name");
});

test("one file per card and form, the API's own bytes: no widths", () => {
  // Jamie, 2026-10-08: "you cannot resize the images or alter them in
  // anyway." The 11.5.0 widths (-128, -192, -285) were resized copies.
  assert.equal(
    cardArtPath(26000085, "evolution"),
    "/assets/cards/26000085_evo.png",
  );
  assert.equal(cardArtPath(26000042), "/assets/cards/26000042.png");
  for (const name of ["CARD_ART_WIDTHS", "CARD_ART_FULL_WIDTH", "cardArtAt"])
    assert.equal(contracts[name], undefined, `${name} is gone`);
  for (const url of Object.values(cardArt(26000042, ELECTRO_WIZARD)))
    assert.doesNotMatch(url, /-\d+\.png$/, "no width in the name");
});
