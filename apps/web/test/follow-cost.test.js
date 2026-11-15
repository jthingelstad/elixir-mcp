/**
 * What a Follow costs, in words (#760): free when Elixir already records
 * the player, else one of the account's player slots; at the limit, the
 * reason and the way out.
 */
import { test, expect } from "vitest";
import { followCostLine } from "../src/home/follow.jsx";

const cost = (over) => ({
  player_tag: "#09CV8UVL",
  following: false,
  free: false,
  reason: null,
  used: 3,
  limit: 50,
  ...over,
});

test("a player nothing else records uses a slot, with the used count", () => {
  expect(followCostLine(cost())).toBe("Uses 1 of your 50 follows · 3 used");
});

test("a player Elixir already records is free", () => {
  expect(followCostLine(cost({ free: true, reason: "in_recorded_clan" }))).toBe(
    "Free · already recorded · 3 of your 50 follows used",
  );
  expect(followCostLine(cost({ free: true, limit: null }))).toBe(
    "Free · already recorded",
  );
});

test("at the limit it says why, and what stays free", () => {
  expect(followCostLine(cost({ used: 50 }))).toBe(
    "All 50 player slots in use. Following a player Elixir already records stays free.",
  );
});

test("nothing to say when already followed, or when slots are unlimited", () => {
  expect(followCostLine(cost({ following: true }))).toBeNull();
  expect(followCostLine(cost({ limit: null }))).toBeNull();
});

test("a Verified player's follow says what comes along (linked follows)", () => {
  expect(
    followCostLine(
      cost({ free: true, limit: null, linked: { players: 0, slots: 0 } }),
    ),
  ).toBe("Free · already recorded · Also follows their account");
  expect(
    followCostLine(
      cost({ free: true, limit: null, linked: { players: 2, slots: 0 } }),
    ),
  ).toBe(
    "Free · already recorded · Also follows their account and 2 more players",
  );
  expect(followCostLine(cost({ linked: { players: 1, slots: 1 } }))).toBe(
    "Uses 1 of your 50 follows · 3 used · Also follows their account and 1 more player (1 uses a follow)",
  );
  expect(
    followCostLine(cost({ limit: null, linked: { players: 1, slots: 0 } })),
  ).toBe("Also follows their account and 1 more player");
});
