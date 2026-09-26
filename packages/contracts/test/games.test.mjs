import { test } from "node:test";
import assert from "node:assert/strict";
import { DUEL_TYPES, duelGamesSql, typesForModeGroup } from "../dist/index.js";

test("the duel types are war types", () => {
  for (const t of DUEL_TYPES) assert.ok(typesForModeGroup("war").includes(t));
});

test("duelGamesSql: every row passes as round 0; a round carries its own deck and result, a blank column is null", () => {
  const sql = duelGamesSql(
    "battle_participant",
    [
      "battle_id",
      "player_tag",
      "type",
      "deck_hash",
      "outcome",
      "deck_avg_level",
    ],
    { blank: ["deck_avg_level"] },
  );
  assert.match(
    sql,
    /select g\.battle_id, g\.player_tag, g\.type, g\.deck_hash, g\.outcome, g\.deck_avg_level, 0::smallint as round from battle_participant g\s+union all/,
  );
  assert.match(
    sql,
    /r\.deck_hash, r\.outcome, null as deck_avg_level, r\.round/,
  );
  assert.match(
    sql,
    /g\.type = any\('\{riverRaceDuel,riverRaceDuelColosseum\}'::text\[\]\)/,
  );
});
