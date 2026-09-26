/**
 * Deck sets over card sets (9.8.0) on a scratch database: a deck's Trophy
 * Road variant (with a tower troop) and its Clan Wars variant (without,
 * as the API sends every war battle) pool into one record; a war deck the
 * player plays only in duels is a candidate on its rounds; and the
 * arguments feedback #364 found wanting are settled before any search:
 * contradictions refused, locked decks echoed with their fit, a partial
 * set and the cards one short when no whole set exists.
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
const OPP = "#2PP";
const PLAYERS = ["#8QCV2Y", "#8QCV2L", "#8QCV2P"];
const TOWER = { id: 159000000, name: "Tower Princess" };
const call = (args = {}) =>
  registry.invoke(
    "battles_deck_sets",
    { db: scratch.db, account },
    {
      player_tag: TAG,
      season: "2026-08",
      min_battles: 10,
      min_players: 2,
      alternatives: 1,
      ...args,
    },
  );

const card = (i) => ({ id: 26000000 + i, name: `C${i}` });
const span = (a) => Array.from({ length: 8 }, (_, k) => a + k);
const DECKS = {
  A: { ids: span(0), rate: 0.7 },
  B: { ids: span(8), rate: 0.65 },
  C: { ids: span(16), rate: 0.6 },
  D: { ids: span(24), rate: 0.55 },
  K: { ids: span(40) }, // played only in the player's duels
  U: { ids: span(70), rate: 0.6 }, // not owned
  S: { ids: [62, 63, 64, 65, 66, 67, 68, 70], rate: 0.6 }, // one card short (C70)
  O: { ids: [0, 1, 48, 49, 50, 51, 52, 53], rate: 0.5 }, // shares C0 and C1 with A
};
const cardsOf = (k) => DECKS[k].ids.map(card);
const ladderHash = (k) => hashFor(cardsOf(k), TOWER.id);
const warHash = (k) => hashFor(cardsOf(k));

let n = 0;
const at = (day) =>
  `2026-08-${String(10 + (day % 15)).padStart(2, "0")}T12:00:00Z`;

async function battle({ deck, player, type, win, day, war = false }) {
  const id = `dc-${++n}`;
  const cards = cardsOf(deck).map((c) => ({ ...c, level: 14 }));
  const supportCards = war ? [] : [TOWER];
  await scratch.db.query(
    `insert into battle (battle_id, battle_time, type, type_class, game_mode_name)
     values ($1, $2::timestamptz, $3, 'pvp', 'Ladder')`,
    [id, at(day), type],
  );
  await seedDeck(scratch.db, { battle_time: at(day), cards, supportCards });
  await scratch.db.query(
    `insert into battle_participant
       (battle_id, player_tag, side, outcome, battle_time, crowns, deck_hash, type, type_class,
        deck_avg_level, opp_deck_avg_level)
     values ($1, $2, 0, $3, $4::timestamptz, 1, $5, $6, 'pvp', 14, 14)`,
    [
      id,
      player,
      win ? "win" : "loss",
      at(day),
      war ? warHash(deck) : ladderHash(deck),
      type,
    ],
  );
  await seedPlayedDeck(scratch.db, {
    battle_id: id,
    player_tag: player,
    battle_time: at(day),
    cards,
    supportCards,
  });
}

/** A duel: the player's rounds (deck, my crowns, their crowns) against
 *  one opponent, as ingest writes it: no deck_hash, the round decks in
 *  battle_participant_card, the round results beside them. */
async function duel(day, rounds) {
  const id = `duel-${++n}`;
  const wonRounds = rounds.filter(([, m, t]) => m > t).length;
  await scratch.db.query(
    `insert into battle (battle_id, battle_time, type, type_class, game_mode_name)
     values ($1, $2::timestamptz, 'riverRaceDuel', 'pvp', 'CW_Duel_1v1')`,
    [id, at(day)],
  );
  for (const [tag, side, outcome] of [
    [TAG, 0, wonRounds * 2 > rounds.length ? "win" : "loss"],
    [OPP, 1, wonRounds * 2 > rounds.length ? "loss" : "win"],
  ])
    await scratch.db.query(
      `insert into battle_participant
         (battle_id, player_tag, side, outcome, battle_time, crowns, deck_hash, type, type_class,
          deck_avg_level, opp_deck_avg_level)
       values ($1, $2, $3, $4, $5::timestamptz, 1, null, 'riverRaceDuel', 'pvp', 14, 14)`,
      [id, tag, side, outcome, at(day)],
    );
  await seedPlayedDeck(scratch.db, {
    battle_id: id,
    player_tag: TAG,
    battle_time: at(day),
    rounds: rounds.map(([deck]) =>
      cardsOf(deck).map((c) => ({ ...c, level: 14 })),
    ),
  });
  for (const [i, [, mine, theirs]] of rounds.entries())
    await scratch.db.query(
      `insert into battle_participant_round (battle_id, player_tag, round, crowns)
       values ($1, $2, $3, $4), ($1, $5, $3, $6)`,
      [id, TAG, i + 1, mine, OPP, theirs],
    );
}

before(async () => {
  scratch = await scratchDb("deck_sets_cards");
  await scratch.db.query("set timezone to 'UTC'");
  const {
    rows: [row],
  } = await scratch.db.query(
    "insert into account (email_hash,status) values ('deck-sets-cards','approved') returning account_id",
  );
  account = {
    accountId: row.account_id,
    timezone: "UTC",
    kind: "person",
    role: "member",
  };
  for (const tag of [TAG, OPP, ...PLAYERS])
    await scratch.db.query("insert into player (player_tag) values ($1)", [
      tag,
    ]);
  await scratch.db.query(
    "insert into recording (subject_type,subject_tag,requested_by) values ('player',$1,$2)",
    [TAG, account.accountId],
  );
  for (let i = 0; i < 80; i++)
    await scratch.db.query(
      `insert into card (card_id, name, kind) values ($1, $2, 'card') on conflict (card_id) do nothing`,
      [26000000 + i, `C${i}`],
    );
  await scratch.db.query(
    `insert into card (card_id, name, kind) values ($1, $2, 'support') on conflict (card_id) do nothing`,
    [TOWER.id, TOWER.name],
  );
  // C0-C69 owned at 14; C70 and up not.
  for (let i = 0; i < 70; i++)
    await scratch.db.query(
      `insert into player_card (player_tag, card_id, level, count, evolution_level, star_level, first_seen_at, observed_at)
       values ($1, $2, 14, 0, 0, 0, now(), now())`,
      [TAG, 26000000 + i],
    );
  // Every recorded deck: three players, twelve Trophy Road and Path of
  // Legends battles each with a tower troop, and eight Clan Wars battles
  // each without one.
  for (const [key, d] of Object.entries(DECKS)) {
    if (!d.rate) continue;
    for (const player of PLAYERS) {
      for (let b = 0; b < 12; b++)
        await battle({
          deck: key,
          player,
          type: b % 2 ? "PvP" : "pathOfLegend",
          win: b < Math.round(12 * d.rate),
          day: b,
        });
      for (let b = 0; b < 8; b++)
        await battle({
          deck: key,
          player,
          type: "riverRacePvP",
          win: b < Math.round(8 * d.rate),
          day: b,
          war: true,
        });
    }
  }
  // The player's duels: K in round one every time (won four of six), A in
  // round two.
  for (let i = 0; i < 6; i++)
    await duel(i, [
      ["K", i < 4 ? 3 : 0, i < 4 ? 0 : 1],
      ["A", 1, 2],
    ]);
  const {
    rows: [season],
  } = await scratch.db.query(
    `select * from season where season_month = '2026-08'`,
  );
  await rebuildSeason(scratch.db, season, { final: true });
});
after(async () => scratch.drop());

test("a deck's Trophy Road and Clan Wars variants pool under its eight cards", async () => {
  const res = await call({ count: 1, require_cards: [26000000] });
  const a = res.sets[0].decks[0];
  assert.equal(
    a.deck_hash,
    ladderHash("A"),
    "the most played variant names it",
  );
  assert.deepEqual(
    a.variants.map((v) => v.deck_hash).sort(),
    [ladderHash("A"), warHash("A")].sort(),
  );
  assert.equal(
    a.modes.war.battles,
    24 + 6,
    "24 recorded war battles and the player's 6 duel rounds",
  );
  assert.equal(a.modes.war.your_duel_rounds, 6);
  assert.equal(a.record.battles, 36 + 30);
});

test("a war deck played only in duels is a candidate on its rounds, and can be locked", async () => {
  const res = await call({ count: 1, require_cards: [26000040] });
  const k = res.sets[0].decks[0];
  assert.equal(k.deck_hash, warHash("K"), "its tower-less identity");
  assert.equal(k.your_duel_rounds, 6);
  assert.equal(k.your_battles, 6);
  assert.equal(k.record.battles, 6);
  assert.equal(k.record.wins, 4);
  assert.equal(k.value.familiarity_term, 0.05);
  const locked = await call({ count: 2, lock_decks: [warHash("K")] });
  assert.ok(
    locked.sets[0].decks.some((d) => d.locked && d.deck_hash === warHash("K")),
  );
});

test("contradictions are refused before any search", async () => {
  await assert.rejects(
    call({ require_cards: [26000001], exclude_cards: [26000001] }),
    /C1 \(26000001\) is in both require_cards and exclude_cards/,
  );
  await assert.rejects(
    call({ require_cards: [26000075] }),
    /not in .* collection/,
  );
  await assert.rejects(
    call({ count: 2, lock_decks: [ladderHash("A"), ladderHash("O")] }),
    /share C0 \(26000000\) and C1 \(26000001\)/,
  );
});

test("a locked deck the player cannot field is kept, echoed with what they lack, and said", async () => {
  const res = await call({ count: 2, lock_decks: [ladderHash("U")] });
  assert.equal(res.locked_decks.length, 1);
  assert.equal(res.locked_decks[0].fit.fieldable, false);
  assert.equal(res.locked_decks[0].fit.unowned.length, 8);
  assert.ok(res.notes.some((x) => /cannot field it today/.test(x)));
});

test("the set's value counts its locked decks, the weakest twice", async () => {
  const res = await call({ count: 3, lock_decks: [ladderHash("D")] });
  const values = res.sets[0].decks.map((d) => d.value.total);
  const expected = values.reduce((s, v) => s + v, 0) + Math.min(...values);
  assert.ok(
    Math.abs(res.sets[0].value - expected) < 0.01,
    `${res.sets[0].value} vs ${expected}`,
  );
});

test("with no whole set, the best partial set and the cards one short of the most decks", async () => {
  // A and B excluded: C, D and K are what is left.
  const res = await call({ count: 4, exclude_cards: [26000000, 26000008] });
  assert.deepEqual(res.sets, []);
  assert.equal(res.partial_set.decks_found, 3);
  assert.equal(res.partial_set.decks_asked, 4);
  assert.equal(res.candidates.one_card_short[0].id, 26000070);
  assert.ok(res.notes.some((x) => /partial_set is the best set of 3/.test(x)));
});

test("a deck played with a form's base card is fieldable, not exact", async () => {
  // Every candidate here is exact; the flag rides every deck.
  const res = await call({ count: 1, require_cards: [26000016] });
  assert.equal(res.sets[0].decks[0].fit.fieldable, true);
  assert.equal(res.sets[0].decks[0].fit.exact_form, true);
});

test("a different last deck: the other three locked, the current fourth excluded", async () => {
  const locks = [ladderHash("A"), ladderHash("B"), ladderHash("C")];
  const same = await call({ lock_decks: locks });
  const fourth = same.sets[0].decks.find((d) => !d.locked);
  const other = await call({
    lock_decks: locks,
    exclude_decks: [fourth.deck_hash],
  });
  const next = other.sets[0]?.decks.find((d) => !d.locked) ?? null;
  assert.notEqual(
    next?.deck_hash,
    fourth.deck_hash,
    "never the deck they have",
  );
  assert.equal(other.candidates.excluded_decks, 1);
  await assert.rejects(
    call({ lock_decks: [ladderHash("A")], exclude_decks: [warHash("A")] }),
    /both lock_decks and exclude_decks/,
  );
});
