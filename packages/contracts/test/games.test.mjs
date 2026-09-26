import { test } from "node:test";
import assert from "node:assert/strict";
import { DUEL_TYPES, duelGamesSql, typesForModeGroup } from "../dist/index.js";

test("the duel types are war types", () => {
  for (const t of DUEL_TYPES) assert.ok(typesForModeGroup("war").includes(t));
});

test("duelGamesSql: a round carries its own deck and result, a blank column is null, whole duels only on request", () => {
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
    /r\.deck_hash, r\.outcome, null as deck_avg_level, r\.round/,
  );
  assert.match(
    sql,
    /g\.type <> all\('\{riverRaceDuel,riverRaceDuelColosseum\}'::text\[\]\)/,
  );
  assert.doesNotMatch(sql, /not exists/);
  assert.match(
    duelGamesSql(
      "pop",
      ["battle_id", "player_tag", "type", "deck_hash", "outcome"],
      {
        wholeDuels: true,
      },
    ),
    /not exists \(select 1 from battle_participant_round r/,
  );
});
