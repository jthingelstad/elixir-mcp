import { test } from "node:test";
import assert from "node:assert/strict";
import { deckLink, findDeckLink, parseDeckLink } from "../dist/index.js";

const IDS = [
  26000000, 26000001, 26000010, 26000014, 27000000, 28000000, 28000008,
  26000021,
];
const DECK = IDS.join(";");
const WANT = { cards: IDS, tower_troop: 159000000 };

test("the web form wrapping the app form reads as its eight cards and tower troop", () => {
  assert.deepEqual(
    parseDeckLink(
      `https://link.clashroyale.com/en/?clashroyale://copyDeck?deck=${DECK}&tt=159000000`,
    ),
    WANT,
  );
  // Another language, and the extra parameters the game adds.
  assert.deepEqual(
    parseDeckLink(
      `https://link.clashroyale.com/pt/?clashroyale://copyDeck?deck=${DECK}&l=Royals&slots=0;0;0;0;0;0;0;0&tt=159000000&id=ABC`,
    ),
    WANT,
  );
});

test("the older web form and the app form alone read the same", () => {
  assert.deepEqual(
    parseDeckLink(
      `https://link.clashroyale.com/deck/en?deck=${DECK}&tt=159000000`,
    ),
    WANT,
  );
  assert.deepEqual(
    parseDeckLink(`clashroyale://copyDeck?deck=${DECK}&tt=159000000`),
    WANT,
  );
});

test("percent-encoding is undone once", () => {
  assert.deepEqual(
    parseDeckLink(
      `https://link.clashroyale.com/en/?clashroyale%3A%2F%2FcopyDeck%3Fdeck%3D${IDS.join("%3B")}%26tt%3D159000000`,
    ),
    WANT,
  );
  assert.deepEqual(
    parseDeckLink(
      `https://link.clashroyale.com/deck/en?deck=${IDS.join("%3B")}`,
    ),
    { cards: IDS, tower_troop: null },
  );
});

test("anything else is not a deck link", () => {
  for (const bad of [
    `https://example.com/en/?clashroyale://copyDeck?deck=${DECK}`,
    `https://link.clashroyale.com.evil.example/deck/en?deck=${DECK}`,
    `https://evil.example/?clashroyale://copyDeck?deck=${DECK}`,
    `https://link.clashroyale.com/deck/en?deck=${IDS.slice(0, 7).join(";")}`,
    `https://link.clashroyale.com/deck/en?deck=${[...IDS.slice(0, 7), IDS[0]].join(";")}`,
    `https://link.clashroyale.com/deck/en?deck=${DECK};26000040`,
    `https://link.clashroyale.com/deck/en?deck=${IDS.slice(0, 7).join(";")};abc`,
    `https://link.clashroyale.com/deck/en?deck=${DECK}&tt=tower`,
    "https://link.clashroyale.com/en/?clashroyale://openClan?tag=0PYL",
    "clashroyale://copyDeck?l=Royals",
    "",
  ])
    assert.equal(parseDeckLink(bad), null, bad);
  assert.equal(parseDeckLink(null), null);
});

test("a deck link is found in running words, trailing punctuation left behind", () => {
  const link = `https://link.clashroyale.com/en/?clashroyale://copyDeck?deck=${DECK}&tt=159000000`;
  const found = findDeckLink(`Is this good for 7k? ${link}. Thanks`);
  assert.equal(found.link, link);
  assert.equal(found.index, 21);
  assert.deepEqual(found.deck, WANT);
  assert.equal(findDeckLink("Is Hog cycle good at 7k?"), null);
  // A link the reader does not know is not found and stays words.
  assert.equal(
    findDeckLink(`look https://link.clashroyale.com/deck/en?deck=1;2`),
    null,
  );
});

test("the link handed back is the game's copy link, and reads back the same", () => {
  const link = deckLink(WANT);
  assert.equal(
    link,
    `https://link.clashroyale.com/en/?clashroyale://copyDeck?deck=${DECK}&tt=159000000`,
  );
  assert.deepEqual(parseDeckLink(link), WANT);
  assert.equal(
    deckLink({ cards: IDS, tower_troop: null }),
    `https://link.clashroyale.com/en/?clashroyale://copyDeck?deck=${DECK}`,
  );
});
