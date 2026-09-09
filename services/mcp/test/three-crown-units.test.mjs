/**
 * three_crown_rate counts sweeps, not summed duel rounds.
 *
 * Three crowns means the king tower fell, which only reads as a sweep on a
 * single game. A duel row collapses up to three games and SUMS their
 * crowns, so 1+1+1 across three rounds - possibly a LOSS - used to be
 * counted exactly like a genuine 3-0. The denominator was every recorded
 * battle, draws and boat attacks included.
 *
 * The tool already warned that duels mix crown units in
 * crowns_for/crowns_against; the rate was committing the same error
 * (playtest round, 2026-09-09). Note that type_class alone does not
 * separate duels: ingest sets 'boat' only for boatBattle*, so every duel
 * is 'pvp' and the duel TYPES have to be named.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import { makeRegistry } from "../src/tools.mjs";

let scratch;
let account;
const registry = makeRegistry();
const TAG = "#2P9YQCV";
const call = (name, args = {}) =>
  registry.invoke(name, { db: scratch.db, account }, args);

/** One battle plus this player's side of it. */
async function battle({ id, type, typeClass, outcome, crowns, day = 2 }) {
  const at = `2026-09-0${day}T12:00:00Z`;
  await scratch.db.query(
    `insert into battle (battle_id,battle_time,type,type_class,game_mode_name)
     values ($1,$4::timestamptz,$2,$3,'Ladder')`,
    [id, type, typeClass, at],
  );
  await scratch.db.query(
    `insert into battle_participant (battle_id,player_tag,side,outcome,battle_time,crowns)
     values ($1,$2,0,$3,$5::timestamptz,$4)`,
    [id, TAG, outcome, crowns, at],
  );
}

before(async () => {
  scratch = await scratchDb("three_crown_units");
  await scratch.db.query("set timezone to 'UTC'");
  const {
    rows: [row],
  } = await scratch.db.query(
    "insert into account (email_hash,status) values ('three-crown','approved') returning account_id",
  );
  account = {
    accountId: row.account_id,
    timezone: "UTC",
    kind: "person",
    role: "member",
  };
  await scratch.db.query("insert into player (player_tag) values ($1)", [TAG]);
  await scratch.db.query(
    "insert into recording (subject_type,subject_tag,requested_by) values ('player',$1,$2)",
    [TAG, account.accountId],
  );

  // The one real sweep.
  await battle({
    id: "tc-sweep",
    type: "PvP",
    typeClass: "pvp",
    outcome: "win",
    crowns: 3,
  });
  // A head-to-head loss, so the denominator is not degenerate.
  await battle({
    id: "tc-loss",
    type: "PvP",
    typeClass: "pvp",
    outcome: "loss",
    crowns: 0,
  });
  // Three crowns SUMMED over three rounds - and the duel was LOST.
  await battle({
    id: "tc-duel",
    type: "riverRaceDuel",
    typeClass: "pvp",
    outcome: "loss",
    crowns: 3,
  });
  // A boat attack has no king tower to take.
  await battle({
    id: "tc-boat",
    type: "boatBattle",
    typeClass: "boat",
    outcome: "win",
    crowns: 3,
  });

  // A separate day holding ONLY a duel and a boat attack.
  await battle({
    id: "tc-duel-only",
    type: "riverRaceDuel",
    typeClass: "pvp",
    outcome: "win",
    crowns: 3,
    day: 5,
  });
  await battle({
    id: "tc-boat-only",
    type: "boatBattle",
    typeClass: "boat",
    outcome: "win",
    crowns: 3,
    day: 5,
  });
});
after(async () => scratch.drop());

test("a duel that summed three crowns across rounds is not a three-crown victory", async () => {
  const res = await call("battles_performance", {
    player_tag: TAG,
    from: "2026-09-01",
    to: "2026-09-03",
  });
  const w = res.window;

  // Four rows recorded, but only two are decided head-to-head games.
  assert.equal(w.battles, 4, "every recorded row still counts in battles");
  assert.equal(w.duel_battles, 1);
  assert.equal(w.boat_battles, 1);
  assert.equal(w.head_to_head_battles, 2, "the sweep and the plain loss");

  // One sweep out of two head-to-head battles. Before the fix this was
  // 3/4 = 0.75: the duel loss and the boat attack both counted as sweeps.
  assert.equal(w.three_crown_rate, 0.5);
  assert.notEqual(w.three_crown_rate, 0.75, "the old, unit-mixed answer");

  assert.match(
    res.denominators_note,
    /head_to_head_battles/,
    "the note must name the denominator",
  );
});

test("with only a duel and a boat battle there is no head-to-head rate to report", async () => {
  const res = await call("battles_performance", {
    player_tag: TAG,
    from: "2026-09-05",
    to: "2026-09-06",
  });
  // Both rows carry three crowns, and neither is a sweep of a single
  // game. A rate here would be invented.
  assert.equal(res.window.battles, 2);
  assert.equal(res.window.head_to_head_battles, 0);
  assert.equal(res.window.three_crown_rate, null);
});
