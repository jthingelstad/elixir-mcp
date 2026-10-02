/**
 * Ladder's Decks page shaping (lib/ladder-decks.js): battles_decks'
 * answers, every mode and then mode by mode, laid out as the board does.
 * These pin the seams where a deck could pick up a record that is not
 * its own: a deck played in two modes, duel rounds, a war deck with the
 * same cards as a Trophy Road one, and a swap of forms between two decks
 * of the same cards.
 */
import { test, expect } from "vitest";
import {
  dayRange,
  deckCount,
  decksTitle,
  formNames,
  formSwaps,
  gapLine,
  modesOf,
  nameList,
  tableRows,
  tableTitle,
} from "../src/lib/ladder-decks.js";

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
const MORTAR = {
  deck_hash: h("c"),
  card_names:
    "Spear Goblins, Dart Goblin, Bandit, Electro Dragon, Golden Knight, Evo Mortar, The Log, Evo Giant Snowball",
  archetype_label: "Evo Mortar siege",
  battles: 9,
  wins: 5,
  losses: 4,
  draws: 0,
  mean_level_gap: 1.75,
  modes: { war: { battles: 9, wins: 5, losses: 4 } },
  dominant_mode: "war",
};
// The Trophy Road deck's cards, played in war: no tower troop, so its
// own row.
const HOGS_WAR = {
  ...AFTER,
  deck_hash: h("d"),
  cards: undefined,
  battles: 2,
  wins: 1,
  losses: 1,
  mean_level_gap: 1.5,
  modes: { war: { battles: 2, wins: 1, losses: 1 } },
  dominant_mode: "war",
};
const DUEL = {
  deck_hash: h("e"),
  card_names:
    "Minions, Bomber, Hog Rider, Guards, Evo Skeleton Barrel, Boss Bandit, Evo Furnace, Royal Delivery",
  archetype_label: "Evo Skeleton Barrel bait",
  rounds: 10,
  wins: 3,
  losses: 7,
};
const ALL = {
  total_decks: 4,
  next_offset: null,
  decks: [BEFORE, AFTER, MORTAR, HOGS_WAR],
  duel_decks: [DUEL, { ...MORTAR, rounds: 1, wins: 0, losses: 1 }],
};

test("the modes to read: each a row was played in, in reading order, and war for duel rounds", () => {
  expect(modesOf(ALL)).toEqual(["ladder", "war", "event"]);
  expect(modesOf({ decks: [MORTAR], duel_decks: [] })).toEqual(["war"]);
  expect(
    modesOf({ decks: [{ ...BEFORE, modes: {} }], duel_decks: [DUEL] }),
  ).toEqual(["war"]);
  expect(modesOf({ decks: [], duel_decks: [] })).toEqual([]);
});

test("the count is the distinct decks returned, rows and duel rounds together", () => {
  // Four rows, two duel decks, one of them a row's deck: five decks.
  expect(deckCount(ALL)).toBe(5);
  // A cut answer counts by the tool's own total, never by its page.
  expect(deckCount({ ...ALL, next_offset: 100, total_decks: 140 })).toBe(140);
  expect(decksTitle(7, 3)).toBe("Seven decks, three modes");
  expect(decksTitle(1, 1)).toBe("One deck, one mode");
  expect(decksTitle(14, 2)).toBe("14 decks, two modes");
});

test("forms come from the cards when read in full, else from card_names' prefixes", () => {
  expect(formNames(BEFORE)).toBe(
    "Evo Witch, Hero Mini P.E.K.K.A, Evo Royal Ghost",
  );
  expect(formNames(MORTAR)).toBe("Evo Mortar, Evo Giant Snowball");
  expect(formNames({ card_names: "Knight, Archers" })).toBe("");
});

test("the level gap is read back in words, signed by direction", () => {
  expect(gapLine(0.6)).toBe("your cards 0.60 levels above theirs");
  expect(gapLine(-1)).toBe("your cards 1.00 level below theirs");
  expect(gapLine(0)).toBe("your cards level with theirs");
  expect(gapLine(null)).toBeNull();
});

test("a deck's days are the account's: 05:07Z is still the 8th in Chicago", () => {
  expect(dayRange(BEFORE.first_used, BEFORE.last_used, CHI)).toBe(
    "Sep 8 – Sep 18",
  );
  expect(dayRange(BEFORE.first_used, BEFORE.last_used, "UTC")).toBe(
    "Sep 8 – Sep 19",
  );
  expect(dayRange(BEFORE.first_used, BEFORE.first_used, CHI)).toBe("Sep 8");
});

test("the table: other modes' decks with their own records, then duel rounds; nothing pooled", () => {
  // Each mode's answer is that mode's own: the deck played in two modes
  // shows only its event battles under events.
  const byMode = {
    ladder: { decks: [BEFORE, { ...AFTER, battles: 15 }], duel_decks: [] },
    war: {
      decks: [MORTAR, HOGS_WAR],
      duel_decks: [{ ...MORTAR, rounds: 1, wins: 0, losses: 1 }],
    },
    event: {
      decks: [
        {
          ...AFTER,
          cards: undefined,
          battles: 2,
          wins: 0,
          losses: 2,
          mean_level_gap: 0,
        },
      ],
      duel_decks: [],
    },
  };
  const rows = tableRows(byMode, ALL);
  expect(
    rows.map((r) => [r.modeLabel, r.label, r.battles, r.wins, r.losses]),
  ).toEqual([
    ["War", "Evo Mortar siege", 9, 5, 4],
    ["War", "Evo Royal Hogs bridge spam", 2, 1, 1],
    ["War duel", "Evo Mortar siege", 1, 0, 1],
    ["Event", "Evo Royal Hogs bridge spam", 2, 0, 2],
    // A duel deck no mode's answer claimed keeps no mode.
    ["Duel", "Evo Skeleton Barrel bait", 10, 3, 7],
  ]);
  expect(rows[0].forms).toBe("Evo Mortar, Evo Giant Snowball");
  expect(rows[0].gap).toBe("your cards 1.75 levels above theirs");
  // The same eight cards in the same forms as a Trophy Road deck.
  expect(rows[1].sameAs).toBe("ladder");
  expect(rows[0].sameAs).toBeNull();
  expect(rows[2].duel).toBe(true);
  expect(rows[4].mode).toBeNull();
  expect(tableTitle(rows)).toBe("War, duels and events");
  expect(tableTitle(rows.filter((r) => r.mode === "event"))).toBe("Events");
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
