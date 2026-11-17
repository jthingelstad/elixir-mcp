/**
 * The Timeline's mode filter (Jamie, 2026-11-17): Trophy Road, Ranked,
 * War and Casual, folded from the one mode-group vocabulary. Every mode
 * group lands in exactly one of the four, so no item with a mode is
 * unreachable from the filter.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MODE_GROUPS,
  TIMELINE_MODES,
  modeGroupOf,
  timelineModeOf,
} from "../dist/index.js";

test("the four filters, in the week chips' order", () => {
  assert.deepEqual(TIMELINE_MODES, ["ladder", "ranked", "war", "casual"]);
});

test("every mode group lands in exactly one filter", () => {
  const landed = Object.fromEntries(
    MODE_GROUPS.map((g) => [g, timelineModeOf(g)]),
  );
  assert.deepEqual(landed, {
    casual: "casual",
    challenge: "casual",
    event: "casual",
    ladder: "ladder",
    ranked: "ranked",
    tournament: "casual",
    war: "war",
  });
  for (const f of Object.values(landed)) assert.ok(TIMELINE_MODES.includes(f));
});

test("a battle's filter follows its mode group", () => {
  assert.equal(timelineModeOf(modeGroupOf("PvP")), "ladder");
  assert.equal(timelineModeOf(modeGroupOf("pathOfLegend")), "ranked");
  assert.equal(timelineModeOf(modeGroupOf("riverRaceDuel")), "war");
  assert.equal(timelineModeOf(modeGroupOf("boatBattle")), "war");
  assert.equal(timelineModeOf(modeGroupOf("trail", "SomeEvent")), "casual");
  assert.equal(timelineModeOf(modeGroupOf("challenge")), "casual");
  assert.equal(timelineModeOf(modeGroupOf("clanMate", "SomeEvent")), "casual");
  // A group the vocabulary does not know is Casual, as modeGroupOf's
  // own fallback is.
  assert.equal(timelineModeOf("something-new"), "casual");
});
