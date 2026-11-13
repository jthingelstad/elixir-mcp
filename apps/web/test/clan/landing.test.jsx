import { expect, test } from "vitest";
import { landingPath } from "../../src/clan/lib/landing.js";

/**
 * Arriving at a clan lands on the Feed, for everyone (A12; Today until Clan became one view). This replaces the
 * 2026-10-20 rule that sent a member to the roster; a leader with Actions
 * waiting finds them at the top of the Feed.
 */
const me = (role, open_actions) => ({
  selected: { clan_tag: "#0QC8RCGY", role },
  open_actions,
});

test("the Feed for anyone, whatever is waiting", () => {
  for (const m of [me("leader", 2), me("leader", 0), me("member", 1)])
    expect(landingPath(m)).toBe("/clan/0QC8RCGY/feed");
});

test("picking another clan goes to that clan's Feed", () => {
  expect(landingPath(me("leader", 2), "#0JR0LRU0")).toBe("/clan/0JR0LRU0/feed");
});
