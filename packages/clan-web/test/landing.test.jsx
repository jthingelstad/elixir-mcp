import { expect, test } from "vitest";
import { landingPath } from "../src/lib/landing.js";

/**
 * Arriving at a clan lands on Today, for everyone (A12). This replaces the
 * 2026-10-20 rule that sent a member to the roster; a leader with Actions
 * waiting finds them at the top of Today.
 */
const me = (role, open_actions) => ({
  selected: { clan_tag: "#2PQRJ8LV", role },
  open_actions,
});

test("Today for anyone, whatever is waiting", () => {
  for (const m of [me("leader", 2), me("leader", 0), me("member", 1)])
    expect(landingPath(m)).toBe("/clan/2PQRJ8LV/today");
});

test("picking another clan goes to that clan's Today", () => {
  expect(landingPath(me("leader", 2), "#GQ08RJPL")).toBe(
    "/clan/GQ08RJPL/today",
  );
});
