import { test } from "node:test";
import assert from "node:assert/strict";
import { cardArt, cardArtAt, cardArtFor, cardArtPath } from "../dist/index.js";

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
    base: "https://elixir.poapkings.com/assets/cards/26000042-285.png",
    hero: "https://elixir.poapkings.com/assets/cards/26000042_hero-285.png",
  });
  assert.deepEqual(cardArt(26000085, ELECTRO_GIANT), {
    base: "https://elixir.poapkings.com/assets/cards/26000085-285.png",
    evolution: "https://elixir.poapkings.com/assets/cards/26000085_evo-285.png",
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
  assert.match(cardArtFor(art, "hero"), /26000042_hero-285\.png$/);
  assert.match(cardArtFor(art, "evolution"), /26000042-285\.png$/);
  assert.match(cardArtFor(art, null), /26000042-285\.png$/);
  assert.equal(cardArtFor(null, "hero"), null, "no art: the name");
});

test("every mirrored width is the same address with its width", () => {
  assert.equal(
    cardArtPath(26000085, "evolution", 128),
    "/assets/cards/26000085_evo-128.png",
  );
  assert.equal(
    cardArtAt(
      "https://elixir.poapkings.com/assets/cards/26000042_hero-285.png",
      128,
    ),
    "https://elixir.poapkings.com/assets/cards/26000042_hero-128.png",
  );
});
