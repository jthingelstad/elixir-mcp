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
import { seedPlayedDeck, seedDeck } from "./deck-rows.mjs";
import { rebuildSeason } from "../../jobs/src/meta-rollup.mjs";

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
  // The deck before the participant (0108), the card rows after it.
  await seedDeck(scratch.db, {
    battle_time: at,
    cards: cards(evo),
    supportCards: [TOWER],
  });
  await scratch.db.query(
    `insert into battle_participant
       (battle_id,player_tag,side,outcome,battle_time,crowns,deck_hash,type,type_class)
     values ($1,$2,0,'win',$3::timestamptz,3,$4,'PvP','pvp')`,
    [id, TAG, at, hashFor(evo)],
  );
  const hash = await seedPlayedDeck(scratch.db, {
    battle_id: id,
    player_tag: TAG,
    battle_time: at,
    cards: cards(evo),
    supportCards: [TOWER],
  });
  assert.equal(hash, hashFor(evo), "the helper and the test agree on identity");
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
  assert.equal(witch(base).form, "base", "base form says so (5.0.0)");
  assert.equal(witch(evo).form, "evolution", "the Evolution says so");

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
    segment: { player_tag: TAG },
    from: "2026-09-01",
    min_battles: 1,
  });
  const byHash = Object.fromEntries(res.decks.map((d) => [d.deck_hash, d]));
  const evo = byHash[hashFor(1)];
  assert.ok(evo, "the Evolution deck is present");
  assert.equal(
    evo.cards.find((c) => c.id === 26000007).form,
    "evolution",
    "meta decks must not erase the form either",
  );
  assert.deepEqual(evo.tower_troop, TOWER);
});

test("battles_cards splits the forms instead of merging them into one row", async () => {
  const res = await call("battles_cards", { player_tag: TAG });
  const witches = res.cards.filter((c) => c.id === 26000007);
  assert.equal(witches.length, 2, "an Evo and its base card are not one card");
  assert.deepEqual(
    witches.map((w) => w.form).sort(),
    ["base", "evolution"],
    "one base row and one Evolution row",
  );
  // A card played in only one form must not absorb the other's record.
  assert.ok(witches.every((w) => w.battles === 3));
  // Cards that never evolved stay single rows.
  assert.equal(res.cards.filter((c) => c.id === 26000021).length, 1);
});

test("5.0.0: containing narrows the deck meta to decks with ALL the cards; cards narrows the card meta; denominators stay the population's", async () => {
  const all = await call("battles_meta_decks", {
    segment: { player_tag: TAG },
    from: "2026-09-01",
    min_battles: 1,
  });
  const witch = await call("battles_meta_decks", {
    segment: { player_tag: TAG },
    from: "2026-09-01",
    min_battles: 1,
    containing: [26000007, 26000021],
  });
  assert.equal(witch.decks.length, 2, "both forms of the Witch deck qualify");
  assert.equal(
    witch.decided_battles,
    all.decided_battles,
    "the population is unchanged",
  );
  assert.deepEqual(witch.applied.containing, [26000007, 26000021]);
  const none = await call("battles_meta_decks", {
    segment: { player_tag: TAG },
    from: "2026-09-01",
    min_battles: 1,
    containing: [26000007, 28000000],
  });
  assert.equal(none.decks.length, 0, "Fireball is in no seeded deck");
  assert.equal(none.decided_battles, all.decided_battles);

  const cards = await call("battles_meta_cards", {
    segment: { player_tag: TAG },
    from: "2026-09-01",
    min_battles: 1,
    cards: [26000007],
  });
  assert.deepEqual(
    cards.cards.map((c) => c.form).sort(),
    ["base", "evolution"],
    "one card, every form of it, as separate rows",
  );
  assert.ok(cards.cards.every((c) => c.card_id === 26000007));
  assert.equal(cards.decided_battles, 6, "the denominator is the population's");
  assert.deepEqual(cards.applied.cards, [26000007]);
});

test("5.0.0: the catalog says the type from the id range and when it last changed vs was fetched", async () => {
  const res = await call("cards_catalog", {
    ids: [26000007, 27000000, 28000001],
  });
  assert.deepEqual(
    res.cards.map((c) => [c.id, c.type]),
    [
      [26000007, "troop"],
      [27000000, "building"],
      [28000001, "spell"],
    ],
  );
  assert.ok("fetched_at" in res);
  // fetched_at is the GLOBAL cards poll's admission stamp, not the last
  // row change: an unchanged catalog confirmed today says today.
  await scratch.db.query(
    `insert into poll_state (subject_tag, endpoint, last_admitted_at)
     values ('GLOBAL', 'cards', '2026-09-19T03:17:39Z')
     on conflict (subject_tag, endpoint) do update set last_admitted_at = excluded.last_admitted_at`,
  );
  const confirmed = await call("cards_catalog", { ids: [26000007] });
  assert.equal(confirmed.fetched_at, "2026-09-19T03:17:39.000Z");
  const compact = await call("cards_catalog", {
    ids: [26000007],
    verbosity: "compact",
  });
  assert.equal(compact.cards[0].type, "troop");
});

test("5.0.0 cards_card: one card in one call on a player segment (raw path) and on the corpus (rollup path)", async () => {
  // The fixture catalog has no form bits; give the Witch her Evolution.
  await scratch.db.query(
    `update card set max_evolution_level = 1, rarity = 'epic', elixir_cost = 5 where card_id = 26000007`,
  );
  // Raw path: the seeded player, every form of the Witch.
  const mine = await call("cards_card", {
    card: "Witch",
    segment: { player_tag: TAG },
    from: "2026-09-01",
  });
  assert.equal(mine.card.id, 26000007);
  assert.equal(mine.card.type, "troop");
  assert.deepEqual(mine.card.forms_available, ["evolution"]);
  assert.ok(mine.card.first_played.base && mine.card.first_played.evolution);
  assert.equal(mine.card.first_played.hero, null);
  assert.equal(mine.season.mode_group, "all");
  assert.equal(mine.season.decided_battles, 6);
  assert.equal(mine.season.all.battles, 6, "all forms merged");
  assert.equal(mine.season.all.usage_share, 1);
  assert.equal(mine.season.all.players, 1);
  assert.deepEqual(
    mine.season.forms.map((f) => [f.form, f.battles]),
    [
      ["base", 3],
      ["evolution", 3],
    ],
  );
  assert.equal(mine.history, undefined, "history is a corpus series");
  assert.equal(mine.by_band, undefined);
  assert.equal(mine.decks.length, 2, "both identities carry the Witch");
  assert.ok(mine.decks.every((d) => d.cards.some((c) => c.id === 26000007)));
  assert.ok(mine.decks[0].cards.every((c) => typeof c.form === "string"));
  assert.equal(mine.members, undefined, "members is a clan block");
  assert.ok(mine.notes.some((n) => /history/.test(n)));
  assert.equal(mine.docs, "cards#one-card-in-one-call");

  // A card the player never played reads as zero, not as an error.
  await scratch.db.query(
    `insert into card (card_id, name, kind) values (28000000, 'Fireball', 'card') on conflict do nothing`,
  );
  const never = await call("cards_card", {
    card_id: 28000000,
    segment: { player_tag: TAG },
    from: "2026-09-01",
  });
  assert.equal(never.season.all.battles, 0);
  assert.equal(never.season.decided_battles, 6);
  assert.deepEqual(never.season.forms, []);
  assert.deepEqual(never.decks, []);

  // Exact names only.
  await assert.rejects(
    call("cards_card", { card: "Witc", segment: { player_tag: TAG } }),
    /not an exact card name|No card named/,
  );

  // Corpus rollup path: rebuild the season the fixtures sit in.
  const {
    rows: [season],
  } = await scratch.db.query(
    `select * from season where season_month = '2026-08'`,
  );
  await rebuildSeason(scratch.db, season, { final: false });
  const corpus = await call("cards_card", {
    card_id: 26000007,
    segment: "corpus",
    season: "2026-08",
  });
  assert.equal(corpus.season.all.battles, 6);
  assert.equal(corpus.season.decided_battles, 6);
  assert.ok(
    Array.isArray(corpus.season.by_mode),
    "mode split when mode is omitted",
  );
  assert.equal(corpus.season.by_mode[0].mode_group, "ladder");
  assert.equal(corpus.history.length, 1, "one recorded season");
  assert.equal(corpus.history[0].season.month, "2026-08");
  assert.equal(corpus.history[0].battles, 6);
  assert.ok(Array.isArray(corpus.by_band));
  assert.ok(Array.isArray(corpus.partners));
  assert.ok(
    corpus.partners.every(
      (p) => typeof p.form === "string" && p.card_id !== 26000007,
    ),
  );
  assert.equal(corpus.decks.length, 2);
  assert.ok(corpus.population, "a corpus read names its population");

  const compact = await call("cards_card", {
    card_id: 26000007,
    segment: "corpus",
    season: "2026-08",
    verbosity: "compact",
  });
  assert.equal(compact.decks, undefined);
  assert.equal(compact.partners, undefined);
  assert.ok(compact.history);
});

test("5.0.0 cards_card: a clan segment says who played the card and who holds it", async () => {
  await scratch.db.query(
    `insert into clan (clan_tag, name) values ('#2CRPCL9V', 'Card Clan') on conflict do nothing`,
  );
  await scratch.db.query(
    `insert into clan_membership (clan_tag, player_tag, joined_observed_at, role)
     values ('#2CRPCL9V', $1, '2026-09-01T00:00:00Z', 'member')`,
    [TAG],
  );
  await scratch.db.query(
    `insert into recording (subject_type, subject_tag, requested_by, scope)
     values ('clan', '#2CRPCL9V', $1, 'comprehensive')`,
    [account.accountId],
  );
  await scratch.db.query(
    `insert into player_card (player_tag, card_id, level, count, evolution_level, star_level, first_seen_at, observed_at)
     values ($1, 26000007, 14, 120, 1, 2, now(), now())`,
    [TAG],
  );
  const res = await call("cards_card", {
    card_id: 26000007,
    segment: { clan_tag: "#2CRPCL9V" },
    from: "2026-09-01",
  });
  assert.equal(res.members.members, 1);
  assert.equal(res.members.members_with_collection, 1);
  assert.equal(res.members.played.length, 1);
  assert.equal(res.members.played[0].player_tag, TAG);
  assert.equal(res.members.played[0].battles, 6);
  assert.equal(res.members.played[0].level_played, 14);
  assert.deepEqual(res.members.played[0].forms, ["base", "evolution"]);
  assert.equal(res.members.held.length, 1);
  assert.equal(res.members.held[0].level, 14);
  assert.deepEqual(res.members.held[0].forms_unlocked, ["evolution"]);
});
