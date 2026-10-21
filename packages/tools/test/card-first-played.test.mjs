/**
 * cards_card's first play by form reads the card's decks once and joins
 * them to the decks played (2026-10-21, platform review §2). The answer
 * must be the one the per-deck probe gave: the old statement is kept here
 * as the reference and both run over the same record.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../ingest/test/helpers.mjs";
// The registry first: the tool modules import each other through it.
import "../src/tools.mjs";
import { firstPlayedSql } from "../src/tools/card-profile.mjs";
import { seedDeck, seedPlayedDeck, hashFor } from "./deck-rows.mjs";

let scratch;
const PLAYERS = ["#2PYLQ0", "#2PYLQ2", "#2PYLQ8"];
const IDLE = "#2PYLQ9"; // recorded, never played
const POOL = [
  26000000, 26000001, 26000003, 26000007, 26000010, 26000014, 26000021,
  26000030, 27000000, 27000006, 28000000, 28000001, 28000011, 26000042,
];
const EVOLVES = new Set([26000000, 26000007, 26000010, 28000011]);
const HERO = 26000021;
const TOWERS = [159000000, 159000001];
const NEVER = 26000099; // in a deck nobody selected played

const served = firstPlayedSql("bp.player_tag = any($1::text[])", "$2", false);
const reference =
  served.slice(0, served.indexOf(", card_decks as materialized")) +
  `select dc.form, min(g.at) as at from first_deck_play g
   join deck_card dc on dc.deck_hash = g.deck_hash and dc.card_id = $2
   group by dc.form`;

before(async () => {
  scratch = await scratchDb("card_first_played");
  const { db } = scratch;
  for (const tag of [...PLAYERS, IDLE])
    await db.query("insert into player (player_tag) values ($1)", [tag]);
  // A fixed sequence, so a failure reproduces.
  let seed = 7;
  const next = (n) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return Math.floor(seed / 65536) % n; // the high bits: the low ones cycle
  };
  for (let i = 0; i < 180; i++) {
    const player = PLAYERS[next(PLAYERS.length)];
    const picked = new Set();
    while (picked.size < 8) picked.add(POOL[next(POOL.length)]);
    const cards = [...picked].map((id) => {
      const roll = next(4);
      const evolutionLevel =
        id === HERO && roll === 0
          ? 2
          : EVOLVES.has(id) && roll === 1
            ? 1
            : undefined;
      return { id, level: 14, ...(evolutionLevel ? { evolutionLevel } : {}) };
    });
    const supportCards = [{ id: TOWERS[next(TOWERS.length)] }];
    const at = new Date(
      Date.UTC(2026, 8, 1) + i * 3_600_000 + next(60) * 60_000,
    ).toISOString();
    const battle_id = `fp-${i}`;
    await db.query(
      `insert into battle (battle_id, battle_time, type, type_class, game_mode_name)
       values ($1, $2, 'PvP', 'pvp', 'Ladder')`,
      [battle_id, at],
    );
    await seedDeck(db, { battle_time: at, cards, supportCards });
    await db.query(
      `insert into battle_participant
         (battle_id, player_tag, side, outcome, battle_time, crowns, deck_hash, type, type_class)
       values ($1, $2, 0, 'win', $3, 1, $4, 'PvP', 'pvp')`,
      [battle_id, player, at, hashFor(cards, supportCards[0].id)],
    );
    await seedPlayedDeck(db, {
      battle_id,
      player_tag: player,
      battle_time: at,
      cards,
      supportCards,
    });
  }
  // A recorded deck holding a card no selected game played.
  await seedDeck(db, {
    cards: [{ id: NEVER }, ...POOL.slice(0, 7).map((id) => ({ id }))],
  });
  await db.query("analyze");
});
after(async () => scratch?.drop());

const rows = async (sql, tags, card) =>
  (await scratch.db.query(sql, [tags, card])).rows
    .map((r) => ({ form: r.form, at: r.at?.toISOString() ?? null }))
    .sort((a, b) => a.form - b.form);

test("the card's decks joined to the decks played answer what the per-deck probe did", async () => {
  const { rows: decks } = await scratch.db.query(
    "select count(*)::int as n from deck",
  );
  assert.ok(decks[0].n > 150, "enough decks that a probe per deck is a walk");
  let compared = 0;
  for (const tags of [PLAYERS, [PLAYERS[0]], [IDLE]])
    for (const card of [...POOL, NEVER, 26000098]) {
      const expected = await rows(reference, tags, card);
      assert.deepEqual(
        await rows(served, tags, card),
        expected,
        `${tags.join(",")} card ${card}`,
      );
      compared += expected.length;
    }
  // Every pool card's base form and the evolved forms, for two of the
  // three selections.
  assert.ok(compared >= 30, `${compared} first plays compared`);
  // Every form appears somewhere, so the grouping is exercised.
  const forms = await rows(served, PLAYERS, HERO);
  assert.deepEqual(
    forms.map((r) => r.form),
    [0, 2],
  );
});

// The plan with hash and merge joins off: what production's planner
// chose for the old statement (its estimate of the decks played was far
// under the 10,192 it met), reproduced on a small record.
const deckCardScans = async (sql) => {
  const { db } = scratch;
  await db.query("begin");
  let plan;
  try {
    await db.query("set local enable_hashjoin = off");
    await db.query("set local enable_mergejoin = off");
    ({
      rows: [{ "QUERY PLAN": plan }],
    } = await db.query(
      `explain (analyze, format json) ${sql
        .replaceAll("$1::text[]", `'{${PLAYERS.join(",")}}'::text[]`)
        .replaceAll("$2", "26000007")}`,
    ));
  } finally {
    await db.query("rollback");
  }
  const scans = [];
  const walk = (node) => {
    if (node["Relation Name"] === "deck_card") scans.push(node);
    for (const child of node.Plans ?? []) walk(child);
  };
  walk(plan[0].Plan);
  return scans;
};

test("deck_card is read once for the card, never probed per deck played", async () => {
  const old = await deckCardScans(reference);
  assert.ok(
    old.some((n) => n["Actual Loops"] > 100),
    "the old statement walks deck_card once per deck played",
  );
  const scans = await deckCardScans(served);
  assert.equal(scans.length, 1, "one read of deck_card");
  assert.equal(scans[0]["Actual Loops"], 1, "not once per deck");
});
