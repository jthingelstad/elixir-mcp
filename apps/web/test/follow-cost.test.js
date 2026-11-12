/**
 * What a Follow costs, in words (#760): free when Elixir already records
 * the player, else one of the account's player slots; at the limit, the
 * reason and the way out.
 */
import { test, expect } from "vitest";
import { followCostLine } from "../src/home/follow.jsx";

const cost = (over) => ({
  player_tag: "#2PP0V90Y",
  following: false,
  free: false,
  reason: null,
  used: 3,
  limit: 50,
  ...over,
});

test("a player nothing else records uses a slot, with the used count", () => {
  expect(followCostLine(cost())).toBe(
    "Uses 1 of your 50 player slots · 3 used",
  );
});

test("a player Elixir already records is free", () => {
  expect(followCostLine(cost({ free: true, reason: "in_recorded_clan" }))).toBe(
    "Free · already recorded · 3 of 50 slots used",
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
