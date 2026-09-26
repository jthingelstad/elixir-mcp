/**
 * battles_deck_upgrades end to end on a scratch database: a strong deck
 * held two levels under (within reach, never one card's option), a deck
 * in the set with one card a level under, a strong deck behind an
 * Evolution not unlocked, and each priced by re-packing the best set.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import { makeRegistry } from "../src/tools.mjs";
import { hashFor, seedDeck, seedPlayedDeck } from "./deck-rows.mjs";
import { rebuildSeason } from "../../jobs/src/meta-rollup.mjs";

let scratch;
let account;
const registry = makeRegistry();
const TAG = "#9GQLV20";
const PLAYERS = ["#8QCV2Y", "#8QCV2L", "#8QCV2P"];
const TOWER = { id: 159000000, name: "Tower Princess" };
const call = (args = {}) =>
  registry.invoke(
    "battles_deck_upgrades",
    { db: scratch.db, account },
    { player_tag: TAG, season: "2026-08", ...args },
  );

const card = (i, evo = 0) => ({
  id: 26000000 + i,
  name: `C${i}`,
  ...(evo ? { evolutionLevel: evo } : {}),
});
const span = (a) => Array.from({ length: 8 }, (_, k) => a + k);
const DECKS = {
  A: { ids: span(0), rate: 0.6 },
  B: { ids: span(8), rate: 0.72 }, // C8-C15 held at 12, two under
  C: { ids: span(16), rate: 0.55 },
  D: { ids: span(24), rate: 0.52 },
  E: { ids: span(32), rate: 0.5 },
  V: { ids: [6, ...span(40).slice(0, 7)], evo: { 6: 1 }, rate: 0.8 }, // Evo C6 not unlocked
  W: { ids: [6, ...span(48).slice(0, 7)], rate: 0.45 }, // base C6: its Evolution's edge is measured
};
const cardsOf = (k) => DECKS[k].ids.map((i) => card(i, DECKS[k].evo?.[i] ?? 0));
const hashOf = (k) => hashFor(cardsOf(k), TOWER.id);

let n = 0;
async function battle({ deck, player, type, win, day, level = 14 }) {
  const id = `du-${++n}`;
  const at = `2026-08-${String(10 + (day % 15)).padStart(2, "0")}T12:00:00Z`;
  const cards = cardsOf(deck).map((c) => ({ ...c, level }));
  await scratch.db.query(
    `insert into battle (battle_id, battle_time, type, type_class, game_mode_name)
     values ($1, $2::timestamptz, $3, 'pvp', 'Ladder')`,
    [id, at, type],
  );
  await seedDeck(scratch.db, { battle_time: at, cards, supportCards: [TOWER] });
  await scratch.db.query(
    `insert into battle_participant
       (battle_id, player_tag, side, outcome, battle_time, crowns, deck_hash, type, type_class,
        deck_avg_level, opp_deck_avg_level)
     values ($1, $2, 0, $3, $4::timestamptz, 1, $5, $6, 'pvp', $7, $7)`,
    [id, player, win ? "win" : "loss", at, hashOf(deck), type, level],
  );
  await seedPlayedDeck(scratch.db, {
    battle_id: id,
    player_tag: player,
    battle_time: at,
    cards,
    supportCards: [TOWER],
  });
}

before(async () => {
  scratch = await scratchDb("deck_upgrades");
  await scratch.db.query("set timezone to 'UTC'");
  const {
    rows: [row],
  } = await scratch.db.query(
    "insert into account (email_hash,status) values ('deck-upgrades','approved') returning account_id",
  );
  account = {
    accountId: row.account_id,
    timezone: "UTC",
    kind: "person",
    role: "member",
  };
  for (const tag of [TAG, ...PLAYERS])
    await scratch.db.query("insert into player (player_tag) values ($1)", [
      tag,
    ]);
  await scratch.db.query(
    "insert into recording (subject_type,subject_tag,requested_by) values ('player',$1,$2)",
    [TAG, account.accountId],
  );
  for (let i = 0; i < 60; i++)
    await scratch.db.query(
      `insert into card (card_id, name, kind) values ($1, $2, 'card') on conflict (card_id) do nothing`,
      [26000000 + i, `C${i}`],
    );
  // C0-C59 owned at 14, except C8-C15 at 12 and C16 at 13; no Evolution.
  for (let i = 0; i < 60; i++)
    await scratch.db.query(
      `insert into player_card (player_tag, card_id, level, count, evolution_level, star_level, first_seen_at, observed_at)
       values ($1, $2, $3, 7, 0, 0, now(), now())`,
      [TAG, 26000000 + i, i >= 8 && i <= 15 ? 12 : i === 16 ? 13 : 14],
    );
  const types = ["PvP", "pathOfLegend", "riverRacePvP"];
  for (const [key, d] of Object.entries(DECKS))
    for (const [p, player] of PLAYERS.entries())
      for (let b = 0; b < 20; b++)
        await battle({
          deck: key,
          player,
          type: types[(b + p) % 3],
          win: b < Math.round(20 * d.rate),
          day: b,
        });
  // The player fields level 14 (their own battles on A).
  for (let b = 0; b < 6; b++)
    await battle({
      deck: "A",
      player: TAG,
      type: "riverRacePvP",
      win: b < 3,
      day: b,
    });
  const {
    rows: [season],
  } = await scratch.db.query(
    `select * from season where season_month = '2026-08'`,
  );
  await rebuildSeason(scratch.db, season, { final: true });
});
after(async () => scratch.drop());

test("each option re-packs the best set; the Evolution that opens a strong deck comes first", async () => {
  const res = await call({ min_battles: undefined });
  assert.ok(res.baseline, "a set exists today");
  assert.equal(res.baseline.decks.length, 4);
  assert.equal(res.fit_for.target_level, 14);
  console.log(
    JSON.stringify(
      {
        baseline: res.baseline,
        options: res.options,
        notes: res.notes,
        search: res.search,
        fit: res.fit_for,
      },
      null,
      1,
    ),
  );
  assert.ok(res.options.length >= 2);
  const [top] = res.options;
  assert.equal(top.kind, "form");
  assert.equal(top.card.id, 26000006);
  assert.equal(top.form, "evolution");
  assert.equal(top.set_changes, true, "V joins the set");
  assert.ok(top.set_after.some((d) => d.deck_hash === hashOf("V")));
  assert.deepEqual(
    top.lifts.map((d) => d.deck_hash),
    [hashOf("V")],
    "the Evolution lifts V; W plays the base card and the rest are unmoved",
  );
  // Sorted by gain, every gain positive and equal to after minus before.
  for (let i = 0; i < res.options.length; i++) {
    const o = res.options[i];
    assert.ok(o.gain > 0);
    assert.ok(Math.abs(o.value_after - o.value_before - o.gain) < 0.002);
    if (i > 0) assert.ok(res.options[i - 1].gain >= o.gain);
  }
});

test("a card in the set held under the fielded level is raised toward it", async () => {
  const res = await call();
  const lift = res.options.find((o) => o.kind === "level");
  assert.ok(lift, "C16, in deck C of the set, is an option");
  assert.equal(lift.card.id, 26000016);
  assert.equal(lift.held_level, 13);
  assert.equal(lift.to_level, 14);
  assert.equal(lift.levels, 1);
  assert.equal(lift.card.cards_held, 7);
  assert.equal(lift.set_changes, false);
  assert.equal(lift.lifts.length, 1);
  assert.equal(lift.lifts[0].deck_hash, hashOf("C"));
  assert.ok(lift.lifts[0].value_after > lift.lifts[0].value_before);
  assert.ok(
    !res.options.some((o) => o.card.id >= 26000008 && o.card.id <= 26000015),
    "one of B's cards alone lifts nothing",
  );
});

test("a deck held two levels under is within reach, whole, and out of reach at max_levels 1", async () => {
  const res = await call();
  const b = res.within_reach.find((w) => w.deck.deck_hash === hashOf("B"));
  assert.ok(b, "B joins the set raised");
  assert.equal(b.raises.length, 8);
  assert.ok(b.raises.every((r) => r.held_level === 12 && r.to_level === 14));
  assert.equal(b.levels, 16);
  assert.deepEqual(b.forms, []);
  assert.ok(b.gain > 0);
  assert.ok(b.set_after.some((d) => d.deck_hash === hashOf("B")));
  const one = await call({ max_levels: 1 });
  assert.ok(!one.within_reach.some((w) => w.deck.deck_hash === hashOf("B")));
});

test("compact keeps the options and drops the sets' detail", async () => {
  const res = await call({ verbosity: "compact" });
  assert.equal(res.objective, undefined);
  assert.equal(res.options[0].set_after, undefined);
  assert.equal(res.within_reach[0].set_after, undefined);
  assert.equal(res.baseline.decks[0].card_names, undefined);
});
