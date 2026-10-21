import { test } from "node:test";
import assert from "node:assert/strict";
import { RANKED_LEAGUES, rankedLeagueName } from "../src/ranked-leagues.mjs";

test("the seven Ranked leagues by their names in the game, and nothing past them", () => {
  assert.deepEqual(Object.values(RANKED_LEAGUES), [
    "Master I",
    "Master II",
    "Master III",
    "Champion",
    "Grand Champion",
    "Royal Champion",
    "Ultimate Champion",
  ]);
  assert.equal(rankedLeagueName(1), "Master I");
  assert.equal(rankedLeagueName(7), "Ultimate Champion");
  // 8 to 10 are a profile's best on the earlier ten-league scale.
  for (const n of [0, 8, 9, 10, null, undefined, "7", "constructor"])
    assert.equal(rankedLeagueName(n), null);
});
