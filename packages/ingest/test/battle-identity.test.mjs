import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalBattleIdentity,
  canonicalizeBattle,
} from "../src/battles.mjs";

test("archive identity stays equal to ingest across observer order, duels, teams and boat defenses", () => {
  for (const type of ["PvP", "riverRaceDuel", "boatBattle"]) {
    const entry = {
      battleTime: "20261002T120000.000Z",
      type,
      team: [
        { tag: "00uqg", cards: [] },
        { tag: "#0LGYR", cards: [] },
      ],
      opponent: [{ tag: "#0G89G", cards: [] }, { cards: [] }],
    };
    const identity = canonicalBattleIdentity(entry),
      projected = canonicalizeBattle(entry).battle;
    assert.equal(identity.battle_id, projected.battle_id);
    assert.equal(identity.battle_time, projected.battle_time);
    assert.equal(identity.type_class, projected.type_class);
    assert.deepEqual(
      canonicalBattleIdentity({
        ...entry,
        team: entry.opponent,
        opponent: entry.team.toReversed(),
      }),
      identity,
    );
    assert.notEqual(
      canonicalBattleIdentity({ ...entry, battleTime: "20261002T120001.000Z" })
        .battle_id,
      identity.battle_id,
    );
  }
  assert.throws(
    () =>
      canonicalBattleIdentity({
        battleTime: "malformed",
        team: [],
        opponent: [],
      }),
    /unrecognized CR battleTime/,
  );
});
