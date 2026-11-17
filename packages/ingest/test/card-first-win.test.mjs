/**
 * The first win with a new card (0289, the owner 2026-11-17). Each rule
 * has a case that fails without it: a card, a form or a tower troop the
 * previous profile read did not show; a win with it in the player's own
 * deck, played as that form; the first since that read, once; from
 * either read, whichever comes second; never a new follow, a loss, a
 * drawn deck or a late capture.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { heldIn, detectFirstWins } from "../src/card-first-win.mjs";
import { projectPlayerCards } from "../src/cards.mjs";
import { playerEvents } from "./event-rows.mjs";
import { scratchDb } from "./helpers.mjs";

let ctx;
before(async () => {
  ctx = await scratchDb("card_first_win");
});
after(async () => ctx?.drop());

// Invented tags (docs/invented-tags.json).
const PIP = "#0QYPJ8G2";
const ASH = "#0LCRV2PQ";
const ROWAN = "#0GUJ9RY8";
const SAGE = "#0RJ2QC9P";
const FOE = "#00C298UC";

const KNIGHT = 26000000;
const MUSKETEER = 26000014;
const GIANT = 26000003;
const PRINCESS_TOWER = 159000000;
const CANNONEER = 159000001;

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const T0 = Date.parse("2026-11-10T12:00:00Z");
const iso = (ms) => new Date(ms).toISOString();

test("held: a card in any form, a form by its bit, a tower troop in its slot", () => {
  const row = {
    cards: [KNIGHT, MUSKETEER, GIANT],
    card_forms: [0, 1, null],
    tower_troop_id: CANNONEER,
    tower_form: null,
  };
  assert.equal(heldIn(row, { card_id: MUSKETEER, bit: null }), true);
  assert.equal(heldIn(row, { card_id: MUSKETEER, bit: 1 }), true);
  assert.equal(heldIn(row, { card_id: MUSKETEER, bit: 2 }), false);
  assert.equal(heldIn(row, { card_id: KNIGHT, bit: 1 }), false, "played plain");
  assert.equal(heldIn(row, { card_id: CANNONEER, bit: null }), true);
  assert.equal(heldIn(row, { card_id: PRINCESS_TOWER, bit: null }), false);
});

const card = (id, name, { evo = 0, level = 11 } = {}) => ({
  id,
  name,
  level,
  maxLevel: 14,
  evolutionLevel: evo || undefined,
});

/** A profile read: the snapshot day's read time, then the collection. */
async function profile(tag, at, cards, supportCards = []) {
  await ctx.db.query(
    `insert into player (player_tag, name) values ($1, 'Pip') on conflict do nothing`,
    [tag],
  );
  await ctx.db.query(
    `insert into player_snapshot_daily (player_tag, snapshot_date, profile_observed_at)
     values ($1, $2::timestamptz::date, $2)
     on conflict (player_tag, snapshot_date, snapshot_kind)
       do update set profile_observed_at = excluded.profile_observed_at`,
    [tag, iso(at)],
  );
  await projectPlayerCards(ctx.db, {
    playerTag: tag,
    payload: { cards, supportCards },
    fetchedAt: iso(at),
  });
}

let seq = 0;
/** One battle for `tag` at `at`: its own deck, the outcome, how late. */
async function battle(
  tag,
  at,
  {
    cards = [KNIGHT, MUSKETEER, GIANT],
    forms = [0, 0, 0],
    tower = PRINCESS_TOWER,
    win = true,
    late = false,
    drawn = false,
  } = {},
) {
  const id = `fw${(seq += 1)}`;
  await ctx.db.query(
    `insert into player (player_tag, name) values ($1, 'Foe') on conflict do nothing`,
    [FOE],
  );
  await ctx.db.query(
    `insert into battle (battle_id, battle_time, type, type_class, created_at, deck_selection)
     values ($1, $2, 'PvP', 'pvp', $3, $4)`,
    [id, iso(at), iso(at + (late ? 3 * DAY : 60_000)), drawn ? "draft" : null],
  );
  await ctx.db.query(
    `insert into battle_participant (battle_id, player_tag, side, outcome, battle_time,
                                     type_class, type, cards, card_forms, tower_troop_id)
     values ($1, $2, 0, $3, $4, 'pvp', 'PvP', $5, $6, $7)`,
    [id, tag, win ? "win" : "loss", iso(at), cards, forms, tower],
  );
  return id;
}

const firstWins = (tag) =>
  playerEvents(ctx.db, "player_tag = $1 and event_type = 'card_first_win'", [
    tag,
  ]);

const BASE = [card(KNIGHT, "Knight"), card(GIANT, "Giant")];

test("a card the last read did not show, won with after the read that showed it: said once, at the win", async () => {
  await profile(PIP, T0 - DAY, BASE, [card(PRINCESS_TOWER, "Tower Princess")]);
  await profile(
    PIP,
    T0,
    [...BASE, card(MUSKETEER, "Musketeer")],
    [card(PRINCESS_TOWER, "Tower Princess")],
  );
  await battle(PIP, T0 + HOUR, { win: false });
  const won = await battle(PIP, T0 + 2 * HOUR);
  await battle(PIP, T0 + 3 * HOUR);
  const read = iso(T0 + 4 * HOUR);
  const r = await detectFirstWins(ctx.db, {
    playerTag: PIP,
    mark: iso(T0),
    observedAt: read,
  });
  assert.equal(
    r.written,
    1,
    "the loss is not a win; the later win is not the first",
  );
  const again = await detectFirstWins(ctx.db, {
    playerTag: PIP,
    mark: iso(T0),
    observedAt: read,
  });
  assert.equal(again.written, 0, "once");
  const [row] = await firstWins(PIP);
  assert.deepEqual(row.payload, {
    card_id: MUSKETEER,
    name: "Musketeer",
    rarity: null,
    tower_troop: false,
    form: null,
    battle_id: won,
  });
  assert.equal(row.timing, "exact");
  assert.equal(row.occurred_at.toISOString(), iso(T0 + 2 * HOUR));
  assert.equal(row.window_end.toISOString(), read, "observed at the read");
});

test("a win the log delivered before the profile showed the new Evo: the profile read writes it", async () => {
  await profile(ASH, T0 - DAY, [...BASE, card(MUSKETEER, "Musketeer")]);
  // Before the read that shows the Evo: played as Evo, won.
  const won = await battle(ASH, T0 - 3 * HOUR, { forms: [0, 1, 0] });
  await profile(ASH, T0, [...BASE, card(MUSKETEER, "Musketeer", { evo: 1 })]);
  const [row] = await firstWins(ASH);
  assert.equal(row.payload.form, "evolution");
  assert.equal(row.payload.battle_id, won);
  assert.equal(row.occurred_at.toISOString(), iso(T0 - 3 * HOUR));
  assert.equal(row.window_end.toISOString(), iso(T0));
});

test("a new tower troop is a first win in the tower slot", async () => {
  await profile(SAGE, T0 - DAY, BASE, [card(PRINCESS_TOWER, "Tower Princess")]);
  await profile(SAGE, T0, BASE, [
    card(PRINCESS_TOWER, "Tower Princess"),
    card(CANNONEER, "Cannoneer"),
  ]);
  await battle(SAGE, T0 + HOUR, {
    cards: [KNIGHT, GIANT],
    forms: [0, 0],
    tower: CANNONEER,
  });
  await detectFirstWins(ctx.db, {
    playerTag: SAGE,
    mark: iso(T0),
    observedAt: iso(T0 + 2 * HOUR),
  });
  const rows = await firstWins(SAGE);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].payload.card_id, CANNONEER);
  assert.equal(rows[0].payload.name, "Cannoneer");
});

test("never: a new follow's first read, a drawn deck, a late capture, or a win the record held before", async () => {
  // A first profile read already holding the card: no unlock, so no win.
  await profile(ROWAN, T0, [...BASE, card(MUSKETEER, "Musketeer")]);
  await battle(ROWAN, T0 + HOUR);
  await detectFirstWins(ctx.db, {
    playerTag: ROWAN,
    mark: iso(T0),
    observedAt: iso(T0 + 2 * HOUR),
  });
  assert.deepEqual(await firstWins(ROWAN), [], "a new follow says nothing");

  const OTHER = "#0GRJCUV";
  await profile(OTHER, T0 - DAY, BASE);
  await profile(OTHER, T0, [...BASE, card(MUSKETEER, "Musketeer")]);
  await battle(OTHER, T0 + HOUR, { drawn: true });
  await battle(OTHER, T0 + 2 * HOUR, { late: true });
  await detectFirstWins(ctx.db, {
    playerTag: OTHER,
    mark: iso(T0),
    observedAt: iso(T0 + 3 * DAY),
  });
  assert.deepEqual(
    await firstWins(OTHER),
    [],
    "a drawn deck is not theirs; the first own win is a late capture, so silent",
  );
  // A later live win is not the first either: the record held one.
  await battle(OTHER, T0 + 4 * DAY);
  await detectFirstWins(ctx.db, {
    playerTag: OTHER,
    mark: iso(T0 + 3 * DAY),
    observedAt: iso(T0 + 4 * DAY + HOUR),
  });
  assert.deepEqual(await firstWins(OTHER), []);
});
