/**
 * The deck switch (0289, the owner 2026-11-17). Each rule has a case that
 * fails without it: the third battle in a run, inside seven days, after
 * fourteen days without the label, with something to switch from, a
 * record that reaches back, a live delivery past the mark, never a late
 * capture, modes never pooled, one a day per mode. The database half
 * proves the deploy is silent over battles already recorded.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  DECK_SWITCH_RULE,
  detectDeckSwitches,
  findDeckSwitches,
} from "../src/deck-switch.mjs";
import { playerEvents } from "./event-rows.mjs";
import { scratchDb } from "./helpers.mjs";

const DAY = 24 * 3600_000;
const T0 = Date.parse("2026-11-01T12:00:00Z");

let seq = 0;
/** One battle, `day` days after T0 (fractions allowed). */
const b = (day, label, { mode = "ladder", win = true, late = false } = {}) => ({
  battle_id: `b${(seq += 1)}`,
  t: T0 + day * DAY,
  created: T0 + day * DAY + (late ? 3 * DAY : 60_000),
  mode,
  label,
  deck_hash: label ? `${label}-hash` : null,
  win,
});

/** A player on Golem beatdown for two weeks, then Hog Rider cycle. */
function history({ hogDays = [14, 14.1, 14.2], hogOpts = {} } = {}) {
  return [
    b(0, "Golem beatdown"),
    b(3, "Golem beatdown", { win: false }),
    b(6, "Golem beatdown"),
    b(10, "Golem beatdown"),
    ...hogDays.map((d) => b(d, "Hog Rider cycle", hogOpts)),
  ];
}

const run = (
  battles,
  { mark = T0 + 13 * DAY, earliest = T0 - 30 * DAY } = {},
) => findDeckSwitches(battles, { mark, earliest });

test("the rule's numbers are the ones DECISIONS names", () => {
  assert.deepEqual(
    { ...DECK_SWITCH_RULE },
    { lookbackDays: 14, runDays: 7, runBattles: 3, priorBattles: 3 },
  );
});

test("the third battle with a new label in a mode is the switch, stamped at it, counted from the first", () => {
  const out = run(history());
  assert.equal(out.length, 1);
  const [s] = out;
  assert.equal(s.mode_group, "ladder");
  assert.equal(s.label, "Hog Rider cycle");
  assert.equal(s.deck_hash, "Hog Rider cycle-hash");
  assert.equal(s.prior_label, "Golem beatdown");
  assert.equal(s.prior_deck_hash, "Golem beatdown-hash");
  assert.equal(s.battles, 3);
  assert.equal(s.wins, 3);
  assert.equal(s.battle_time, new Date(T0 + 14.2 * DAY).toISOString());
  assert.equal(s.first_battle_time, new Date(T0 + 14 * DAY).toISOString());
});

test("two battles are a try, not a switch", () => {
  assert.deepEqual(run(history({ hogDays: [14, 14.1] })), []);
});

test("a third battle more than seven days after the first is no switch", () => {
  assert.deepEqual(
    run(history({ hogDays: [14, 15, 22] }), { mark: T0 + 21 * DAY }),
    [],
  );
});

test("a label played in the fourteen days before is no switch: it is coming back to a deck", () => {
  const battles = [...history(), b(5, "Hog Rider cycle")];
  assert.deepEqual(run(battles), []);
});

test("without three battles on other decks first, there is nothing to switch from", () => {
  const battles = history().filter(
    (x) => !(x.label === "Golem beatdown" && x.t > T0 + 5 * DAY),
  );
  assert.deepEqual(run(battles), []);
});

test("a record that does not reach fourteen days back says nothing", () => {
  assert.deepEqual(run(history(), { earliest: T0 + DAY }), []);
  assert.deepEqual(run(history(), { earliest: null }), []);
});

test("only a third battle past the mark speaks: battles already recorded are silent", () => {
  assert.deepEqual(run(history(), { mark: T0 + 15 * DAY }), []);
});

test("a late capture never speaks", () => {
  const battles = history();
  battles[battles.length - 1].created += 3 * DAY;
  assert.deepEqual(run(battles), []);
});

test("modes are never pooled: two on Trophy Road and one in Ranked are no switch", () => {
  const battles = [
    ...history({ hogDays: [14, 14.1] }),
    b(14.2, "Hog Rider cycle", { mode: "ranked" }),
  ];
  assert.deepEqual(run(battles), []);
});

test("one switch a day per mode: two new decks on one evening are one moment, the first", () => {
  const battles = [
    ...history(),
    b(14.3, "X-Bow siege"),
    b(14.4, "X-Bow siege"),
    b(14.5, "X-Bow siege"),
  ];
  const out = run(battles);
  assert.equal(out.length, 1);
  assert.equal(out[0].label, "Hog Rider cycle");
});

test("a battle with no label (a bare family) is never a switch", () => {
  assert.deepEqual(
    run([
      ...history({ hogDays: [] }),
      b(14, null),
      b(14.1, null),
      b(14.2, null),
    ]),
    [],
  );
});

// --- the database half --------------------------------------------------

let ctx;
before(async () => {
  ctx = await scratchDb("deck_switch");
});
after(async () => ctx?.drop());

const PIP = "#0QYPJ8G2";
const FOE = "#00C298UC";

async function seed(battles) {
  for (const tag of [PIP, FOE])
    await ctx.db.query(
      `insert into player (player_tag, name) values ($1, 'Pip') on conflict do nothing`,
      [tag],
    );
  for (const x of battles) {
    if (x.deck_hash)
      await ctx.db.query(
        `insert into deck (deck_hash, card_count, first_seen_at, last_seen_at,
                           archetype_family, archetype_label, archetype_win_conditions)
         values ($1, 8, $2, $2, $3, $4, '{26000021}') on conflict do nothing`,
        [x.deck_hash, new Date(x.t), x.label.split(" ").at(-1), x.label],
      );
    const type = { ladder: "PvP", ranked: "pathOfLegend", war: "riverRacePvP" }[
      x.mode
    ];
    await ctx.db.query(
      `insert into battle (battle_id, battle_time, type, type_class, created_at)
       values ($1, $2, $3, 'pvp', $4)`,
      [x.battle_id, new Date(x.t), type, new Date(x.created)],
    );
    for (const [tag, side] of [
      [PIP, 0],
      [FOE, 1],
    ])
      await ctx.db.query(
        `insert into battle_participant (battle_id, player_tag, side, deck_hash, outcome,
                                         battle_time, type_class, type)
         values ($1, $2, $3, $4, $5, $6, 'pvp', $7)`,
        [
          x.battle_id,
          tag,
          side,
          tag === PIP ? x.deck_hash : null,
          (tag === PIP) === x.win ? "win" : "loss",
          new Date(x.t),
          type,
        ],
      );
  }
}

const switches = () =>
  playerEvents(ctx.db, "player_tag = $1 and event_type = 'deck_switched'", [
    PIP,
  ]);

test("database: battles recorded before the mark write nothing; a first log (no mark) writes nothing", async () => {
  // A record older than the lookback, so coverage holds.
  const battles = [b(-20, "Golem beatdown"), ...history()];
  await seed(battles);
  const iso = (ms) => new Date(ms).toISOString();
  assert.deepEqual(
    await detectDeckSwitches(ctx.db, { playerTag: PIP, mark: null }),
    { written: 0 },
  );
  // The deploy: the mark is past every battle already recorded.
  await detectDeckSwitches(ctx.db, {
    playerTag: PIP,
    mark: iso(T0 + 15 * DAY),
  });
  assert.deepEqual(await switches(), []);
});

test("database: a live poll past the mark writes the switch once, typed and stamped", async () => {
  const iso = (ms) => new Date(ms).toISOString();
  // The battles above with created_at an hour after play are live.
  // Read two days after the third battle: a pointer that passed the
  // battle meanwhile still learns it (Codex on #1110).
  const first = await detectDeckSwitches(ctx.db, {
    playerTag: PIP,
    mark: iso(T0 + 13 * DAY),
    observedAt: iso(T0 + 16.2 * DAY),
  });
  assert.equal(first.written, 1);
  const again = await detectDeckSwitches(ctx.db, {
    playerTag: PIP,
    mark: iso(T0 + 13 * DAY),
  });
  assert.equal(again.written, 0, "the same run never writes twice");
  const [row] = await switches();
  assert.equal(row.mode_group, "ladder");
  assert.equal(row.deck_hash, "Hog Rider cycle-hash");
  assert.equal(row.prior_deck_hash, "Golem beatdown-hash");
  assert.equal(row.battles, 3);
  assert.equal(row.wins, 3);
  assert.equal(row.timing, "exact");
  assert.equal(row.occurred_at.toISOString(), iso(T0 + 14.2 * DAY));
  assert.equal(row.window_start.toISOString(), iso(T0 + 14 * DAY));
  assert.equal(
    row.window_end.toISOString(),
    iso(T0 + 16.2 * DAY),
    "observed when the read delivered it, not at the battle",
  );
});
