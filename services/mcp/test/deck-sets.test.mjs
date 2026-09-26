/**
 * battles_deck_sets end to end on a scratch database: the season's
 * rollup, a collection that owns some cards and forms and not others, a
 * card under the level gate, a strong deck that collides with every
 * other, locks, excludes, requires, alternatives and compact.
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
    "battles_deck_sets",
    { db: scratch.db, account },
    {
      player_tag: TAG,
      season: "2026-08",
      min_battles: 10,
      min_players: 2,
      ...args,
    },
  );

const card = (i, evo = 0) => ({
  id: 26000000 + i,
  name: `C${i}`,
  ...(evo ? { evolutionLevel: evo } : {}),
});
const cardsOf = (ids, evo = {}) => ids.map((i) => card(i, evo[i] ?? 0));
const span = (a) => Array.from({ length: 8 }, (_, k) => a + k);

/** The decks and the win rate each is seeded at. */
const DECKS = {
  A: { ids: span(0), evo: { 5: 1 }, rate: 0.7 }, // fieldable: Evo C5 unlocked
  B: { ids: span(8), rate: 0.65 },
  C: { ids: span(16), rate: 0.6 },
  D: { ids: span(24), rate: 0.55 },
  E: { ids: span(32), rate: 0.52 },
  F: { ids: span(48), rate: 0.5 },
  G: { ids: span(56), rate: 0.48 },
  L: { ids: span(40), rate: 0.75 }, // C40-C44 held five levels under
  U: { ids: span(70), rate: 0.8 }, // not owned
  V: { ids: [6, ...span(32).slice(0, 7)], evo: { 6: 1 }, rate: 0.78 }, // Evo C6 not unlocked: played as base
  W: { ids: [6, 64, 65, 66, 67, 68, 69, 70], rate: 0.4 }, // base C6, so its Evolution's edge is measured; C70 not owned
  S: { ids: [0, 8, 16, 24, 32, 48, 56, 64], rate: 0.85 }, // collides with every deck
};
const hashOf = (k) =>
  hashFor(cardsOf(DECKS[k].ids, DECKS[k].evo ?? {}), TOWER.id);

let n = 0;
async function battle({ deck, player, type, win, day, level = 14 }) {
  const id = `ds-${++n}`;
  const at = `2026-08-${String(10 + (day % 15)).padStart(2, "0")}T12:00:00Z`;
  const d = DECKS[deck];
  const cards = cardsOf(d.ids, d.evo ?? {}).map((c) => ({ ...c, level }));
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
  scratch = await scratchDb("deck_sets");
  await scratch.db.query("set timezone to 'UTC'");
  const {
    rows: [row],
  } = await scratch.db.query(
    "insert into account (email_hash,status) values ('deck-sets','approved') returning account_id",
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
  // The catalog first (the collection references it), then the
  // collection: C0-C69 at level 14 except C40-C44 at 9 (under the floor,
  // 14 - 4); Evo C5 unlocked, Evo C6 not; C70 and up not owned.
  for (let i = 0; i < 78; i++)
    await scratch.db.query(
      `insert into card (card_id, name, kind) values ($1, $2, 'card') on conflict (card_id) do nothing`,
      [26000000 + i, `C${i}`],
    );
  for (let i = 0; i < 70; i++)
    await scratch.db.query(
      `insert into player_card (player_tag, card_id, level, count, evolution_level, star_level, first_seen_at, observed_at)
       values ($1, $2, $3, 0, $4, 0, now(), now())`,
      [TAG, 26000000 + i, i >= 40 && i <= 44 ? 9 : 14, i === 5 ? 1 : 0],
    );
  // Every deck: three players, twenty battles each over three modes, at
  // the deck's rate.
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
  // The player's own: six on deck A (a deck they know), at level 14.
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

const keysOf = (set) =>
  set.decks
    .map((d) => Object.keys(DECKS).find((k) => hashOf(k) === d.deck_hash))
    .sort();

test("the best set: four fieldable decks, 32 distinct cards, the weakest named", async () => {
  const res = await call();
  assert.deepEqual(keysOf(res.sets[0]), ["A", "B", "C", "D"]);
  assert.equal(res.sets[0].distinct_cards, 32);
  assert.equal(res.sets[0].card_slots, 32);
  assert.equal(res.sets[0].weakest_deck, hashOf("D"));
  assert.equal(res.search.exhausted, true);
  // Every deck says what it is and why it is there.
  const a = res.sets[0].decks.find((d) => d.deck_hash === hashOf("A"));
  assert.equal(a.record.battles, 66, "60 corpus battles plus the player's 6");
  assert.deepEqual(Object.keys(a.modes).sort(), ["ladder", "ranked", "war"]);
  assert.equal(a.your_battles, 6);
  assert.equal(a.value.familiarity_term, 0.05, "a deck they know");
  assert.equal(a.fit.own_mean_level, 14);
  assert.equal(
    a.cards.find((c) => c.id === 26000005).form,
    "evolution",
    "the Evolution the player holds is part of the deck",
  );
});

test("the reductions: unowned cards and cards under the level floor never reach a set", async () => {
  const res = await call();
  assert.equal(res.fit_for.target_level, 14);
  assert.equal(res.fit_for.min_card_level, 10);
  assert.equal(res.candidates.not_owned, 2, "U and W");
  assert.equal(res.candidates.below_level, 1, "L");
  assert.equal(
    res.candidates.forms_substituted,
    1,
    "V stays, played as base C6",
  );
  const chosen = new Set(
    res.sets.flatMap((s) => s.decks.map((d) => d.deck_hash)),
  );
  for (const k of ["U", "W", "L"]) assert.ok(!chosen.has(hashOf(k)), k);
});

test("a deck with a form not unlocked is played with the base card, priced by the form's measured edge", async () => {
  // Everything but E and V excluded: one deck per set, E first, V second.
  const res = await call({
    count: 1,
    alternatives: 2,
    exclude_cards: [
      26000000, 26000008, 26000016, 26000024, 26000048, 26000056, 26000064,
    ],
  });
  const v = res.sets
    .flatMap((s) => s.decks)
    .find((d) => d.deck_hash === hashOf("V"));
  assert.ok(v, "V is a candidate, not refused");
  assert.equal(v.forms_substituted.length, 1);
  const [swap] = v.forms_substituted;
  assert.equal(swap.id, 26000006);
  assert.equal(swap.form, "evolution");
  assert.equal(swap.plays_as, "base");
  assert.equal(swap.measured, true, "W's base C6 battles measure it");
  assert.ok(v.value.form_term < 0);
  assert.equal(v.value.form_term, -swap.form_advantage);
  assert.equal(
    v.fit.fieldable,
    true,
    "the base card is owned: it can be built",
  );
  assert.equal(v.fit.exact_form, false);
});

test("the strongest deck that collides with everything is a near miss, with the cards it lost", async () => {
  const res = await call();
  const s = res.near_misses.find((m) => m.deck_hash === hashOf("S"));
  assert.ok(s, "S is named");
  const withA = s.conflicts.find((c) => c.with_deck === hashOf("A"));
  assert.deepEqual(
    withA.cards.map((c) => c.id),
    [26000000],
  );
});

test("alternatives share at most two decks with every earlier set", async () => {
  const res = await call({ alternatives: 3 });
  assert.ok(res.sets.length >= 2);
  for (let i = 0; i < res.sets.length; i++)
    for (let j = i + 1; j < res.sets.length; j++) {
      const a = res.sets[i].decks.map((d) => d.deck_hash);
      const shared = res.sets[j].decks.filter((d) => a.includes(d.deck_hash));
      assert.ok(shared.length <= 2);
    }
});

test("a locked deck stays and the rest share none of its cards; exclude and require shape the set", async () => {
  const locked = await call({ lock_decks: [hashOf("E")] });
  for (const set of locked.sets) {
    const e = set.decks.find((d) => d.deck_hash === hashOf("E"));
    assert.ok(e?.locked, "E kept in every set");
    assert.equal(set.decks.length, 4);
    assert.equal(set.distinct_cards, 32);
  }
  const noA = await call({ exclude_cards: [26000000] });
  assert.ok(!keysOf(noA.sets[0]).includes("A"));
  const withG = await call({ require_cards: [26000060] });
  assert.ok(keysOf(withG.sets[0]).includes("G"));
  await assert.rejects(
    call({ lock_decks: ["not-a-hash"] }),
    /deck_hash values/,
  );
  await assert.rejects(
    call({ lock_decks: ["0".repeat(64)] }),
    /No recorded deck/,
  );
});

test("compact keeps the set and drops the detail", async () => {
  const res = await call({ verbosity: "compact" });
  const row = res.sets[0].decks[0];
  assert.equal(typeof row.card_names, "string");
  assert.equal(row.cards, undefined);
  assert.equal(row.modes, undefined);
  assert.equal(res.objective, undefined);
});

test("when the defaults pack nothing, one wider pass drops the level floor and says so", async () => {
  // A, B, C and D excluded: E, F and G are left, V shares E's cards, and
  // the only fourth deck is L, whose C40-C44 sit under the floor (9 < 10).
  const res = await registry.invoke(
    "battles_deck_sets",
    { db: scratch.db, account },
    {
      player_tag: TAG,
      season: "2026-08",
      exclude_cards: [26000000, 26000008, 26000016, 26000024],
    },
  );
  assert.equal(res.applied.min_battles, 5, "the wider pass answered");
  assert.equal(res.fit_for.min_card_level, null, "no floor on it");
  assert.ok(res.sets.length >= 1);
  const l = res.sets[0].decks.find((d) => d.deck_hash === hashOf("L"));
  assert.ok(l, "L is in the set, its gap priced");
  assert.equal(l.fit.lowest_card.level, 9);
  assert.ok(l.value.level_term < 0);
  assert.ok(res.notes.some((n) => /widened once/.test(n)));
});
