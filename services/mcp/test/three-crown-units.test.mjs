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

/**
 * The win_rate numerator is decided_wins, not wins.
 *
 * denominators_note said "win_rate = wins / decided_battles". The
 * implementation was right, but `wins` includes boat attacks, so the
 * documented formula did not reproduce the returned number whenever
 * boat_battles > 0 - and decided_wins/decided_losses were computed and
 * then thrown away, so a caller could not check the division at all. An
 * auditor spent its deepest reconciliation here and could not close it.
 *
 * The fixture's boat row is a WIN, which is the case that breaks it.
 */
test("a boat win inflates wins without moving win_rate, and both halves are shown", async () => {
  const res = await call("battles_performance", {
    player_tag: TAG,
    from: "2026-09-01",
    to: "2026-09-03",
  });
  const w = res.window;

  // sweep(win) + loss + duel(loss) + boat(win) = 2 wins, 2 losses.
  assert.equal(w.wins, 2, "wins counts the boat attack too");
  assert.equal(w.boat_battles, 1);
  assert.equal(w.decided_wins, 1, "but only one win was head-to-head");
  assert.equal(w.decided_losses, 2);
  assert.equal(w.decided_battles, 3);

  // The returned rate follows the decided numerator...
  assert.equal(
    w.win_rate,
    Number((w.decided_wins / w.decided_battles).toFixed(3)),
  );
  // ...and the formula the note USED to state gives a different answer.
  assert.notEqual(
    w.win_rate,
    Number((w.wins / w.decided_battles).toFixed(3)),
    "this fixture must actually distinguish the two formulas",
  );

  assert.match(
    res.denominators_note,
    /win_rate = decided_wins \/ decided_battles/,
  );
});

/**
 * elixir_coverage reports the span it actually measured.
 *
 * average_ratio "1.000" is computed over observation intervals ENDING in
 * the last seven days, which can be a couple of days of coverage. The note
 * disclosed the mechanism but nothing said how much of the week was
 * watched, so a tester read a perfect ratio as a fully captured week and
 * cited it as licence to trust every other number (playtest round,
 * 2026-09-09).
 */
test("a perfect ratio over two days does not read as a captured week", async () => {
  const tag = "#CVR2G9Q";
  await scratch.db.query("insert into player (player_tag) values ($1)", [tag]);
  await scratch.db.query(
    "insert into recording (subject_type,subject_tag,requested_by) values ('player',$1,$2)",
    [tag, account.accountId],
  );
  // Three snapshots spanning two days: two intervals, fully captured.
  for (const [n, days, battles] of [
    [1, 4, 100],
    [2, 3, 105],
    [3, 2, 110],
  ]) {
    await scratch.db.query(
      `insert into player_snapshot_daily
         (player_tag,snapshot_date,snapshot_kind,observed_at,lifetime)
       values ($1, (now()-($2||' days')::interval)::date, 'daily',
               now()-($2||' days')::interval, $3::jsonb)`,
      [tag, days, JSON.stringify({ battleCount: battles })],
    );
    void n;
  }
  // Five in each interval, matching each lifetime delta exactly, so both
  // intervals are comparable and complete. An interval whose captured count
  // OVERSHOOTS its expected delta is not comparable and drops out of
  // measured_intervals entirely - which is how the first draft of this
  // fixture accidentally measured one interval instead of two.
  const seedBattle = async (id, offset) => {
    await scratch.db.query(
      `insert into battle (battle_id,battle_time,type,type_class)
       values ($1, now()-($2)::interval, 'PvP','pvp')`,
      [id, offset],
    );
    await scratch.db.query(
      `insert into battle_participant (battle_id,player_tag,side,outcome,battle_time)
       select battle_id,$1,0,'win',battle_time from battle where battle_id=$2`,
      [tag, id],
    );
  };
  for (let i = 0; i < 5; i++) {
    await seedBattle(`cov-a-${i}`, `3 days 12 hours ${i} minutes`);
    await seedBattle(`cov-b-${i}`, `2 days 12 hours ${i} minutes`);
  }

  const res = await call("elixir_coverage", { player_tag: tag });
  const c = res.completeness_last_7_days;

  assert.equal(c.measured_intervals, 2);
  assert.ok(c.measured_span, "the span must be reported");
  // Two days of coverage, not seven - the whole point.
  assert.ok(
    c.measured_hours > 0 && c.measured_hours < 72,
    `measured_hours should be about two days, got ${c.measured_hours}`,
  );
  assert.ok(
    c.measured_hours < 168,
    "a week is 168 hours; this must not claim one",
  );
  assert.ok(
    Date.parse(c.measured_span.to) > Date.parse(c.measured_span.from),
    "span runs forwards",
  );
  // The note has to make the comparison possible without arithmetic.
  assert.match(c.note, /measured_hours/);
  assert.match(c.note, /168/);
  assert.doesNotMatch(
    c.note,
    /the week was fully observed[^:]/i,
    "the note must not imply a full week",
  );
});
