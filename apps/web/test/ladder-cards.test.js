/**
 * Ladder's Cards page shaping (lib/ladder-cards.js): battles_cards'
 * rows as the page lists them. These pin a form as its own row, the
 * card page link (never for a tower troop), counts that never add rows
 * up, and an opponent the record has no name for.
 */
import { test, expect } from "vitest";
import {
  cameBack,
  cardRows,
  distinctCards,
  modeBattles,
  opponentName,
  times,
} from "../src/lib/ladder-cards.js";

const BODY = {
  modes_in_window: { ladder: { battles: 35, mean_level_gap: 0.62 } },
  cards: [
    {
      id: 26000018,
      name: "Mini P.E.K.K.A",
      form: "hero",
      battles: 35,
      wins: 12,
      losses: 23,
      win_rate: 0.343,
    },
    {
      id: 26000007,
      name: "Witch",
      form: "evolution",
      battles: 20,
      wins: 8,
      losses: 12,
      win_rate: 0.4,
    },
    {
      id: 26000007,
      name: "Witch",
      form: "base",
      battles: 15,
      wins: 4,
      losses: 11,
      win_rate: 0.267,
    },
    {
      id: 159000000,
      name: "Tower Princess",
      battles: 35,
      wins: 12,
      losses: 23,
      win_rate: 0.343,
    },
  ],
};

test("each card and form is its own row, in the tool's order, linked to the card's page", () => {
  const rows = cardRows(BODY);
  expect(rows.map((r) => [r.label, r.battles, r.wins, r.losses])).toEqual([
    ["Hero Mini P.E.K.K.A", 35, 12, 23],
    ["Evo Witch", 20, 8, 12],
    ["Witch", 15, 4, 11],
    ["Tower Princess", 35, 12, 23],
  ]);
  // One page per card, every form on it.
  expect(rows[1].href).toBe("/cards/26000007/");
  expect(rows[2].href).toBe("/cards/26000007/");
  // A tower troop has no page.
  expect(rows[3].href).toBeNull();
  expect(rows[3].card.form).toBe("base");
  expect(rows[1].rate).toBe(0.4);
  // Two forms of the Witch are two rows and one card.
  expect(distinctCards(rows)).toBe(3);
  expect(cardRows(null)).toEqual([]);
});

test("the mode's battles are the tool's count for that mode", () => {
  expect(modeBattles(BODY, "ladder")).toBe(35);
  expect(modeBattles(BODY, "war")).toBeNull();
});

test("opponents read as words", () => {
  expect(times(1)).toBe("once");
  expect(times(2)).toBe("twice");
  expect(times(5)).toBe("5 times");
  expect(cameBack(1)).toBe("One came back");
  expect(cameBack(12)).toBe("12 came back");
  expect(
    opponentName({ player_tag: "#20V9PQLPCG", name: "Toxic_Watson" }),
  ).toBe("Toxic_Watson");
  expect(
    opponentName({ player_tag: "#20V9PQLPCG", name: null, name_known: false }),
  ).toBe("#20V9PQLPCG");
});
