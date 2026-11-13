import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DUEL_TYPES,
  duelGamesSql,
  duelSql,
  isDuelBattle,
  typesForModeGroup,
} from "../dist/index.js";

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
  // A duel's games are its round rows whatever its type (13.1.0): no
  // type list decides which rows are expanded.
  assert.doesNotMatch(sql, /riverRaceDuel/);
  assert.match(
    sql,
    /join battle_participant_round r\s+on r\.battle_id = g\.battle_id and r\.player_tag = g\.player_tag\)$/,
  );
});

test("isDuelBattle: a river race duel by type, any other battle by its round decks", () => {
  for (const t of DUEL_TYPES) assert.equal(isDuelBattle(t), true);
  assert.equal(isDuelBattle("trail"), false);
  assert.equal(isDuelBattle("trail", true), true);
  assert.equal(isDuelBattle("friendly", true), true);
  assert.equal(isDuelBattle("PvP", false), false);
  assert.equal(isDuelBattle(null), false);
});

test("duelSql: the same rule in SQL, by type or by stored round rows", () => {
  const sql = duelSql("b.type", "bp.battle_id");
  assert.match(
    sql,
    /b\.type = any\('\{riverRaceDuel,riverRaceDuelColosseum\}'::text\[\]\)/,
  );
  assert.match(
    sql,
    /or \(select true from battle_participant_round duel_r\s+where duel_r\.battle_id = bp\.battle_id limit 1\) is not null\)/,
  );
});
