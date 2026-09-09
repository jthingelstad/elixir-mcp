/**
 * Deck responses show the discriminators that deck_hash is built from.
 *
 * packages/contracts/src/deck.ts hashes sorted "cardId:evolutionLevel"
 * pairs plus the tower troop id, and says outright that form
 * discriminators are part of identity. But battles_decks,
 * battles_meta_decks and battles_cards rendered {id, name} only, so two
 * decks whose visible cards were identical could carry different
 * deck_hash values with nothing in the payload explaining the split. A
 * tester nearly filed that as data corruption, and spent a session
 * believing it played base cards when it ran an Evolution (playtest
 * round, 2026-09-09).
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { deckHash } from "@elixir-mcp/contracts";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import { makeRegistry } from "../src/tools.mjs";

let scratch;
let account;
const registry = makeRegistry();
const TAG = "#9GQLV20";
const call = (name, args = {}) =>
  registry.invoke(name, { db: scratch.db, account }, args);

const NAMES = {
  26000007: "Witch",
  26000021: "Hog Rider",
  26000000: "Knight",
  26000010: "Skeletons",
  28000011: "The Log",
  26000014: "Musketeer",
  27000000: "Cannon",
  28000001: "Arrows",
};
const IDS = Object.keys(NAMES).map(Number);
const TOWER = { id: 159000000, name: "Tower Princess" };

/** The same eight cards; only the Witch's form differs. */
const cards = (evo) =>
  IDS.map((id) => ({
    id,
    name: NAMES[id],
    level: 14,
    ...(id === 26000007 && evo ? { evolutionLevel: evo } : {}),
  }));

const hashFor = (evo) =>
  deckHash({
    cards: IDS.map((id) => ({
      id,
      ...(id === 26000007 && evo ? { evolutionLevel: evo } : {}),
    })),
    towerTroopId: TOWER.id,
  });

async function seed({ id, evo, day }) {
  const at = `2026-09-0${day}T12:00:00Z`;
  await scratch.db.query(
    `insert into battle (battle_id,battle_time,type,type_class,game_mode_name)
     values ($1,$2::timestamptz,'PvP','pvp','Ladder')`,
    [id, at],
  );
  await scratch.db.query(
    `insert into battle_participant
       (battle_id,player_tag,side,outcome,battle_time,crowns,deck,deck_hash)
     values ($1,$2,0,'win',$3::timestamptz,3,$4::jsonb,$5)`,
    [
      id,
      TAG,
      at,
      JSON.stringify({ norm: 1, cards: cards(evo), supportCards: [TOWER] }),
      hashFor(evo),
    ],
  );
}

before(async () => {
  scratch = await scratchDb("deck_form_identity");
  await scratch.db.query("set timezone to 'UTC'");
  const {
    rows: [row],
  } = await scratch.db.query(
    "insert into account (email_hash,status) values ('deck-form','approved') returning account_id",
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
  // Three of each: battles_cards drops cards under three battles, and
  // splitting a merged card in two halves each row's count - a real
  // consequence of this change, so the fixture has to clear the floor
  // per FORM rather than per card.
  for (const n of [1, 2, 3]) {
    await seed({ id: `df-base-${n}`, evo: 0, day: 2 });
    await seed({ id: `df-evo-${n}`, evo: 1, day: 2 });
  }
});
after(async () => scratch.drop());

test("the two decks really are different identities", () => {
  assert.notEqual(hashFor(0), hashFor(1), "evolutionLevel is part of the hash");
});

test("battles_decks distinguishes the forms visibly, not only by hash", async () => {
  const res = await call("battles_decks", { player_tag: TAG });
  assert.equal(res.decks.length, 2, "two identities");
  assert.ok(res.decks.every((d) => d.battles === 3));

  const byHash = Object.fromEntries(res.decks.map((d) => [d.deck_hash, d]));
  const base = byHash[hashFor(0)];
  const evo = byHash[hashFor(1)];
  assert.ok(base && evo, "both hashes present");

  const witch = (d) => d.cards.find((c) => c.id === 26000007);
  assert.equal(witch(base).evolution, undefined, "base form carries no marker");
  assert.equal(witch(evo).evolution, 1, "the Evolution says so");

  // The whole point: the payloads must not be indistinguishable.
  assert.notDeepEqual(
    base.cards,
    evo.cards,
    "different deck_hash must mean visibly different cards",
  );

  // The other half of identity.
  assert.deepEqual(base.tower_troop, TOWER);
});

test("battles_meta_decks renders forms the same way", async () => {
  const res = await call("battles_meta_decks", {
    player_tag: TAG,
    from: "2026-09-01",
    min_battles: 1,
  });
  const byHash = Object.fromEntries(res.decks.map((d) => [d.deck_hash, d]));
  const evo = byHash[hashFor(1)];
  assert.ok(evo, "the Evolution deck is present");
  assert.equal(
    evo.cards.find((c) => c.id === 26000007).evolution,
    1,
    "meta decks must not erase the form either",
  );
  assert.deepEqual(evo.tower_troop, TOWER);
});

test("battles_cards splits the forms instead of merging them into one row", async () => {
  const res = await call("battles_cards", { player_tag: TAG });
  const witches = res.cards.filter((c) => c.id === 26000007);
  assert.equal(witches.length, 2, "an Evo and its base card are not one card");
  assert.deepEqual(
    witches.map((w) => w.evolution ?? 0).sort(),
    [0, 1],
    "one base row and one Evolution row",
  );
  // A card played in only one form must not absorb the other's record.
  assert.ok(witches.every((w) => w.battles === 3));
  // Cards that never evolved stay single rows.
  assert.equal(res.cards.filter((c) => c.id === 26000021).length, 1);
});
