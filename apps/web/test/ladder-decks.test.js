/**
 * Ladder's Decks page shaping (ladder/ladder-decks.js): battles_decks'
 * answers, every mode and then mode by mode, laid out as the board does.
 * These pin the seams where a deck could pick up a record that is not
 * its own: a deck played in two modes, duel rounds, a war deck with the
 * same cards as a Trophy Road one, and a swap of forms between two decks
 * of the same cards.
 */
import { test, expect } from "vitest";
import {
  dayRange,
  formNames,
  formSwaps,
  gapLine,
  nameList,
} from "../src/ladder/ladder-decks.js";

const CHI = "America/Chicago";
const h = (c) => c.repeat(64);

const card = (id, name, form = "base") => ({ id, name, form });
const CORE = [
  card(26000012, "Skeleton Army"),
  card(26000018, "Mini P.E.K.K.A", "hero"),
  card(26000037, "Inferno Dragon"),
  card(28000001, "Arrows"),
];
const BEFORE = {
  deck_hash: h("b"),
  card_names:
    "Evo Witch, Skeleton Army, Hero Mini P.E.K.K.A, Inferno Dragon, Evo Royal Ghost, Royal Hogs, Cannon, Arrows",
  archetype_label: "Royal Hogs bridge spam",
  cards: [
    card(26000007, "Witch", "evolution"),
    ...CORE,
    card(26000050, "Royal Ghost", "evolution"),
    card(26000059, "Royal Hogs"),
    card(27000000, "Cannon"),
  ],
  battles: 20,
  wins: 8,
  losses: 12,
  draws: 0,
  win_rate: 0.4,
  mean_level_gap: 0.6,
  modes: { ladder: { battles: 20, wins: 8, losses: 12 } },
  dominant_mode: "ladder",
  first_used: "2026-09-08T05:07:03.000Z",
  last_used: "2026-09-19T04:01:25.000Z",
};
const AFTER = {
  deck_hash: h("a"),
  card_names:
    "Witch, Skeleton Army, Hero Mini P.E.K.K.A, Inferno Dragon, Royal Ghost, Evo Royal Hogs, Evo Cannon, Arrows",
  archetype_label: "Evo Royal Hogs bridge spam",
  cards: [
    card(26000007, "Witch"),
    ...CORE,
    card(26000050, "Royal Ghost"),
    card(26000059, "Royal Hogs", "evolution"),
    card(27000000, "Cannon", "evolution"),
  ],
  battles: 15,
  wins: 4,
  losses: 11,
  draws: 0,
  win_rate: 0.267,
  mean_level_gap: 0.65,
  modes: {
    ladder: { battles: 15, wins: 4, losses: 11 },
    event: { battles: 2, wins: 0, losses: 2 },
  },
  dominant_mode: "ladder",
  first_used: "2026-09-21T01:04:46.000Z",
  last_used: "2026-09-30T02:51:11.000Z",
};
// The Trophy Road deck's cards, played in war: no tower troop, so its
// own row.
test("a deck's days are the account's: 05:07Z is still the 8th in Chicago", () => {
  expect(dayRange(BEFORE.first_used, BEFORE.last_used, CHI)).toBe(
    "Sep 8 to Sep 18",
  );
  expect(dayRange(BEFORE.first_used, BEFORE.last_used, "UTC")).toBe(
    "Sep 8 to Sep 19",
  );
  expect(dayRange(BEFORE.first_used, BEFORE.first_used, CHI)).toBe("Sep 8");
});

test("a swap: same eight cards, forms moved, the first deck put down before the second", () => {
  const [swap, ...rest] = formSwaps([AFTER, BEFORE]);
  expect(rest).toEqual([]);
  expect(swap.kind).toBe("evolution");
  expect(swap.at).toBe(AFTER.first_used);
  expect(swap.before.row).toBe(BEFORE);
  expect(swap.after.row).toBe(AFTER);
  expect(swap.before.cards.map((c) => c.name)).toEqual([
    "Witch",
    "Royal Ghost",
  ]);
  expect(swap.after.cards.map((c) => c.name)).toEqual(["Royal Hogs", "Cannon"]);
  expect(swap.unchanged.map((c) => c.name)).toEqual([
    "Skeleton Army",
    "Mini P.E.K.K.A",
    "Inferno Dragon",
    "Arrows",
  ]);
  expect(nameList(swap.before.cards)).toBe("Witch and Royal Ghost");
  expect(nameList([CORE[0], CORE[2], CORE[3]])).toBe(
    "Skeleton Army, Inferno Dragon and Arrows",
  );
});

test("no swap for decks played side by side, different cards, or a deck not read in full", () => {
  // Overlapping: the first deck was still played after the second began.
  expect(
    formSwaps([BEFORE, { ...AFTER, first_used: "2026-09-15T00:00:00.000Z" }]),
  ).toEqual([]);
  // One card different: not the same eight.
  expect(
    formSwaps([
      BEFORE,
      {
        ...AFTER,
        cards: [...AFTER.cards.slice(0, 7), card(26000014, "Musketeer")],
      },
    ]),
  ).toEqual([]);
  expect(formSwaps([BEFORE, { ...AFTER, cards: undefined }])).toEqual([]);
});

test("a deck's forms and its level gap, in words", () => {
  expect(
    formNames({ card_names: "Evo Witch, Knight, Hero Mini P.E.K.K.A" }),
  ).toBe("Evo Witch, Hero Mini P.E.K.K.A");
  expect(gapLine(0.6)).toBe("your cards 0.60 levels above theirs");
  expect(gapLine(-1)).toBe("your cards 1.00 level below theirs");
  expect(gapLine(0)).toBe("your cards level with theirs");
  expect(gapLine(null)).toBe(null);
});
