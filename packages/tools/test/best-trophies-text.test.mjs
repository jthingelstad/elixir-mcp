/**
 * A new best is told as it happened. Live in POAP KINGS on 2026-10-11:
 * "I Hate Witch set a new best of 12,032 trophies, crossing 12,000, on a
 * 3-0 win over keyluis (11,943), +26 to 12,005." The 12,032 best came
 * after the battle that crossed 12,000, so the line read as a
 * contradiction. The crossing is told, then the peak after it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { itemText } from "../src/activity/summary.mjs";

const crossed_by = {
  battle_id: "b2".repeat(32),
  battle_time: "2026-10-11T19:03:23.000Z",
  type: "PvP",
  opponent: {
    player_tag: "#2GC2YJ2Y0",
    name: "keyluis",
    starting_trophies: 11943,
  },
  crowns: 3,
  crowns_against: 0,
  trophy_change: 26,
  trophies_after: 12005,
};
const best = (facts) =>
  itemText({
    kind: "best_trophies_band",
    subject_tag: "#J2RGCRVG",
    subject_name: "POAP KINGS",
    at: "2026-10-11T19:03:23.000Z",
    facts: { player_tag: "#20LP8UPJ8R", name: "I Hate Witch", ...facts },
  });

test("a best seen later than the crossing: the crossing, then the peak", () => {
  assert.equal(
    best({ best: 12032, band: 12000, crossed_by }),
    "I Hate Witch passed 12,000 trophies for the first time, on a 3-0 win over keyluis (11,943), +26 to 12,005, and went on to a best of 12,032.",
  );
});

test("a best the crossing itself set is the new best, crossing the rung", () => {
  assert.equal(
    best({ best: 12005, band: 12000, crossed_by }),
    "I Hate Witch set a new best of 12,005 trophies, crossing 12,000, on a 3-0 win over keyluis (11,943), +26 to 12,005.",
  );
});

test("a best read below where the crossing ended is stale: the crossing alone", () => {
  assert.equal(
    best({ best: 11990, band: 12000, crossed_by }),
    "I Hate Witch passed 12,000 trophies for the first time, on a 3-0 win over keyluis (11,943), +26 to 12,005.",
  );
});

test("no crossing battle: the best alone", () => {
  assert.equal(
    best({ best: 12032, band: 12000 }),
    "I Hate Witch set a new best of 12,032 trophies.",
  );
});
