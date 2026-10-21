import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RANKED_LEAGUES,
  rankedLeagueName,
  seasonResultLeague,
} from "../src/ranked-leagues.mjs";

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

test("a rated season result is Ultimate Champion on either scale; 1 with no rating, or an unrated best, names nothing", () => {
  const uc = { league: 7, name: "Ultimate Champion" };
  // Only Ultimate Champion is rated: a recorded final at 7, and a best of
  // 10 (the earlier ten-league scale) or 7 with a rating.
  assert.deepEqual(seasonResultLeague({ league: 7, trophies: 1805 }), uc);
  assert.deepEqual(
    seasonResultLeague({ league: 10, trophies: 1596 }, { best: true }),
    uc,
  );
  assert.deepEqual(
    seasonResultLeague({ league: 7, trophies: 1805 }, { best: true }),
    uc,
  );
  // A recorded final in 2 to 6 is named.
  assert.deepEqual(seasonResultLeague({ league: 6, trophies: 0 }), {
    league: 6,
    name: "Royal Champion",
  });
  assert.deepEqual(seasonResultLeague({ league: 2, trophies: 0 }), {
    league: 2,
    name: "Master II",
  });
  // 1 with 0 is also a player who never played that season.
  assert.equal(seasonResultLeague({ league: 1, trophies: 0 }), null);
  // An unrated best can be the earlier scale's (a 7 there was Champion).
  for (const league of [1, 4, 7, 8, 9])
    assert.equal(
      seasonResultLeague({ league, trophies: 0 }, { best: true }),
      null,
    );
  for (const r of [
    { league: 7, trophies: 0 },
    { league: 9, trophies: 0 },
    { league: null, trophies: null },
    { league: "5", trophies: "0" },
  ])
    assert.equal(seasonResultLeague(r), null);
});
