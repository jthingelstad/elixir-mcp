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

// --- 6.4.0: fit_for, the population's decks against one collection (#70) ----

test("6.4.0 fit_for: a row the player cannot field leaves decks[]; a fieldable row says what it would field at and the upgrade path", async () => {
  const FIT = "#2PPLUV0";
  await scratch.db.query("insert into player (player_tag) values ($1)", [FIT]);
  // Owns seven of the eight cards (no Cannon), the Witch without her
  // evolution, at mixed levels: 16,16,15,14,13,12,11.
  const levels = {
    26000007: [13, 0], // Witch, base only
    26000021: [16, 0],
    26000000: [16, 0],
    26000010: [15, 0],
    28000011: [14, 0],
    26000014: [12, 0],
    28000001: [11, 0],
  };
  for (const [id, [level, forms]] of Object.entries(levels))
    await scratch.db.query(
      `insert into player_card (player_tag, card_id, level, count, evolution_level, star_level, first_seen_at, observed_at)
       values ($1, $2, $3, 1, $4, 0, now(), '2026-09-20T06:42:49Z')`,
      [FIT, Number(id), level, forms],
    );
  const args = {
    segment: { player_tag: TAG },
    from: "2026-09-01",
    fit_for: FIT,
    min_battles: 1,
  };
  // Without a fielded level: both rows unfieldable, both name the Cannon.
  const res = await call("battles_meta_decks", args);
  assert.equal(res.applied.fit_for, FIT);
  assert.equal(res.fit_for.player_tag, FIT);
  assert.equal(res.fit_for.collection_as_of, "2026-09-20T06:42:49.000Z");
  assert.equal(res.fit_for.fielded_mean_level, null);
  assert.deepEqual(res.decks, []);
  assert.equal(res.unfieldable.length, 2);
  for (const row of res.unfieldable) {
    assert.equal(row.fit.fieldable, false);
    assert.ok(
      row.fit.missing.some(
        (m) => m.id === 27000000 && m.reason === "not_owned",
      ),
    );
    assert.equal(
      row.fit.own_mean_level,
      null,
      "a deck with an unowned card has no level",
    );
    assert.ok(row.cards.every((c) => "held_level" in c));
    assert.equal(row.cards.find((c) => c.id === 27000000).held_level, null);
  }
  const evoRow = res.unfieldable.find((r) =>
    r.cards.some((c) => c.id === 26000007 && c.form === "evolution"),
  );
  assert.ok(
    evoRow.fit.missing.some(
      (m) => m.id === 26000007 && m.reason === "form_not_unlocked",
    ),
  );
  assert.ok(res.notes[0].startsWith(`Checked against ${FIT}'s collection`));
  assert.match(res.notes[0], /0 of the top 2 rows are fieldable/);
  assert.ok(
    res.notes.some((n) =>
      /no decided pvp battles with a recorded deck in this window/.test(n),
    ),
  );

  // Give them the Cannon at 10 and a fielded history at 15.4 (three
  // battles: the benchmark). The base deck is fieldable; the Evo deck
  // still is not.
  await scratch.db.query(
    `insert into player_card (player_tag, card_id, level, count, evolution_level, star_level, first_seen_at, observed_at)
     values ($1, 27000000, 10, 1, 0, 0, now(), '2026-09-20T06:42:49Z')`,
    [FIT],
  );
  // Two days ago: inside the meta window and inside players_collection's
  // 30 days whenever the test runs.
  const recent = new Date(Date.now() - 2 * 86_400_000).toISOString();
  for (const [n, lvl] of [
    [1, 15.5],
    [2, 15.5],
    [3, 15.2],
  ]) {
    await scratch.db.query(
      `insert into battle (battle_id,battle_time,type,type_class,game_mode_name)
       values ($1,$2::timestamptz,'PvP','pvp','Ladder')`,
      [`fit-${n}`, recent],
    );
    await scratch.db.query(
      `insert into battle_participant (battle_id,player_tag,side,outcome,battle_time,crowns,deck_hash,type,type_class,deck_avg_level)
       values ($1,$2,0,'loss',$5::timestamptz,0,$3,'PvP','pvp',$4)`,
      [`fit-${n}`, FIT, hashFor(0), lvl, recent],
    );
  }
  const again = await call("battles_meta_decks", args);
  assert.equal(again.fit_for.fielded_mean_level, 15.4);
  assert.equal(again.fit_for.fielded_battles, 3);
  assert.equal(again.decks.length, 1);
  assert.equal(again.unfieldable.length, 1);
  const base = again.decks[0];
  assert.equal(base.fit.fieldable, true);
  assert.deepEqual(base.fit.missing, []);
  // (13+16+16+15+14+12+11+10)/8 = 13.375
  assert.equal(base.fit.own_mean_level, 13.375);
  assert.equal(base.fit.vs_fielded, -2.025);
  // Target is the fielded level rounded (15): five cards below it,
  // largest deficit first.
  assert.deepEqual(
    base.fit.upgrades.map((u) => [u.name, u.held_level, u.to_level, u.levels]),
    [
      ["Cannon", 10, 15, 5],
      ["Arrows", 11, 15, 4],
      ["Musketeer", 12, 15, 3],
      ["Witch", 13, 15, 2],
      ["The Log", 14, 15, 1],
    ],
  );
  // (15+16+16+15+15+15+15+15)/8 = 15.25
  assert.equal(base.fit.mean_level_after_upgrades, 15.25);
  assert.ok(
    again.notes.some((n) => /1 of the top 2 rows are fieldable/.test(n)),
  );
  assert.ok(
    again.notes.some((n) =>
      /fielded a mean card level of 15.4 over 3 decided battles/.test(n),
    ),
  );
  // The population's ranking is untouched: the rows themselves are the same.
  assert.equal(base.battles, 3);

  // Without fit_for the note says the population knows nothing of the caller.
  const plain = await call("battles_meta_decks", {
    segment: { player_tag: TAG },
    from: "2026-09-01",
    min_battles: 1,
  });
  assert.match(plain.notes[0], /nothing here checks what any one player holds/);
  assert.ok(!("unfieldable" in plain));
  assert.ok(!("fit" in plain.decks[0]));

  // The card meta carries held per row.
  const cards = await call("battles_meta_cards", {
    segment: { player_tag: TAG },
    from: "2026-09-01",
    min_battles: 1,
    fit_for: FIT,
  });
  const witchEvo = cards.cards.find(
    (c) => c.card_id === 26000007 && c.form === "evolution",
  );
  const witchBase = cards.cards.find(
    (c) => c.card_id === 26000007 && c.form === "base",
  );
  assert.deepEqual(witchEvo.held, {
    level: 13,
    forms_unlocked: [],
    has_form: false,
  });
  assert.deepEqual(witchBase.held, {
    level: 13,
    forms_unlocked: [],
    has_form: true,
  });
  assert.equal(cards.fit_for.fielded_mean_level, 15.4);
  assert.ok(cards.notes[0].startsWith(`held on each row is what ${FIT} holds`));

  // An unrecorded collection refuses rather than reading as "owns nothing".
  await assert.rejects(
    call("battles_meta_decks", { ...args, fit_for: "#2LLLL" }),
    (e) => e.code === "not_recorded",
  );

  // players_collection carries the same benchmark.
  const coll = await call("players_collection", { player_tag: FIT });
  assert.deepEqual(coll.fielded, { days: 30, mean_level: 15.4, battles: 3 });
});

// --- 6.5.0: the archetype on every deck object, and the archetype filter --

test("6.5.0: every deck object carries its archetype once the vocabulary is imported; the filter reads it; a name that is nothing refuses", async () => {
  const { cardRolesImport, archetypeCensus } =
    await import("../../migrate/src/ops-archetypes.mjs");
  const { readFileSync } = await import("node:fs");
  const snapshot = JSON.parse(
    readFileSync(
      new URL("../../../fixtures/card-roles.snapshot.json", import.meta.url),
      "utf8",
    ),
  );
  // The catalog stub has only the eight fixture cards: the import refuses
  // ids the catalog has not seen, so the vocabulary is narrowed to them.
  const { rows: catalog } = await scratch.db.query(`select card_id from card`);
  const known = new Set(catalog.map((r) => r.card_id));
  const roles = snapshot.roles.filter((r) => known.has(r.id));
  const aliases = snapshot.aliases.filter((a) =>
    a.cards.every((id) => known.has(id)),
  );
  assert.ok(
    roles.some((r) => r.id === 26000021),
    "Hog Rider is in the fixture",
  );
  // The fixture's catalog stubs carry no cost; give them the catalog's.
  for (const [id, cost] of [
    [26000007, 5],
    [26000021, 4],
    [26000000, 3],
    [26000010, 1],
    [28000011, 2],
    [26000014, 4],
    [27000000, 3],
    [28000001, 3],
  ])
    await scratch.db.query(
      `update card set elixir_cost = $2 where card_id = $1`,
      [id, cost],
    );
  // Before the import: named by cost, version null.
  const before = await call("battles_decks", {
    player_tag: TAG,
    from: "2026-09-01",
  });
  assert.equal(before.decks[0].archetype.win_conditions.length, 0);
  assert.equal(before.decks[0].archetype.roles_version, null);

  const imported = await cardRolesImport(scratch.url, {
    roles,
    aliases,
    roles_version: snapshot.roles_version,
    source_commit: snapshot.source_commit,
  });
  assert.equal(imported.roles, roles.length);
  // The reader caches the vocabulary for five minutes; a fresh client sees the import.
  const { default: pg } = await import("pg");
  const fresh = new pg.Client({ connectionString: scratch.url });
  await fresh.connect();
  try {
    const callFresh = (name, args) =>
      registry.invoke(name, { db: fresh, account }, args);
    // Hog Rider, Witch, Knight, Skeletons, The Log, Musketeer, Cannon, Arrows: 25/8 = 3.13 -> cycle.
    const res = await callFresh("battles_decks", {
      player_tag: TAG,
      from: "2026-09-01",
    });
    for (const d of res.decks) {
      assert.equal(d.archetype.family, "cycle");
      assert.equal(d.archetype.label, "Hog Rider cycle");
      assert.deepEqual(d.archetype.win_conditions, [
        { id: 26000021, name: "Hog Rider", form: "base" },
      ]);
      assert.equal(d.archetype.average_elixir, 3.13);
      assert.equal(d.archetype.roles_version, snapshot.roles_version);
      assert.equal(typeof d.archetype.grammar_version, "string");
    }
    assert.ok(
      res.notes.some((n) => /archetype is Elixir's descriptive name/.test(n)),
    );

    // battles_query rows carry it on the rendered deck.
    const q = await callFresh("battles_query", {
      player_tag: TAG,
      from: "2026-09-01",
      limit: 1,
    });
    assert.equal(q.battles[0].me.deck.archetype.label, "Hog Rider cycle");
    // players_summary's top deck carries it (its window is the last 30 days;
    // the fixture's battles are on 2026-09-02, so only while that holds).
    const sum = await callFresh("players_summary", { player_tag: TAG });
    if (sum.top_deck) assert.equal(sum.top_deck.archetype.family, "cycle");
    // The meta reader, and the filter by family, label and alias.
    const meta = await callFresh("battles_meta_decks", {
      segment: { player_tag: TAG },
      from: "2026-09-01",
      min_battles: 1,
    });
    assert.equal(meta.decks.length, 2);
    assert.ok(meta.decks.every((d) => d.archetype.label === "Hog Rider cycle"));
    const byFamily = await callFresh("battles_meta_decks", {
      segment: { player_tag: TAG },
      from: "2026-09-01",
      min_battles: 1,
      archetype: "cycle",
    });
    assert.equal(byFamily.decks.length, 2);
    assert.equal(byFamily.applied.archetype.family, "cycle");
    assert.equal(byFamily.applied.archetype.resolved_from, "family");
    const byLabel = await callFresh("battles_meta_decks", {
      segment: { player_tag: TAG },
      from: "2026-09-01",
      min_battles: 1,
      archetype: "hog rider cycle",
    });
    assert.equal(byLabel.decks.length, 2);
    assert.equal(byLabel.applied.archetype.resolved_from, "label");
    const byAlias = await callFresh("battles_meta_decks", {
      segment: { player_tag: TAG },
      from: "2026-09-01",
      min_battles: 1,
      archetype: "2.6 Hog",
    });
    assert.equal(byAlias.applied.archetype.resolved_from, "alias");
    assert.equal(byAlias.decks.length, 2);
    const none = await callFresh("battles_meta_decks", {
      segment: { player_tag: TAG },
      from: "2026-09-01",
      min_battles: 1,
      archetype: "beatdown",
    });
    assert.deepEqual(none.decks, []);
    assert.ok(none.notes.some((n) => /resolved to beatdown/.test(n)));
    const decksByArchetype = await callFresh("battles_decks", {
      player_tag: TAG,
      from: "2026-09-01",
      archetype: "Hog Rider cycle",
    });
    assert.equal(decksByArchetype.decks.length, 2);
    assert.equal(
      decksByArchetype.applied.archetype.requested,
      "Hog Rider cycle",
    );
    await assert.rejects(
      callFresh("battles_decks", {
        player_tag: TAG,
        from: "2026-09-01",
        archetype: "purple monkey",
      }),
      (e) => e.code === "bad_request" && /LavaLoon/.test(e.hint),
    );
    // The census runs over the scratch corpus.
    const census = await archetypeCensus(scratch.url, {});
    assert.equal(census.decks, 2);
    assert.equal(census.families.cycle.decks, 2);
    assert.ok(census.histograms["26000021"], "Hog Rider has a histogram");
  } finally {
    await fresh.end();
  }
});

// --- 6.6.0: the stamp, group_by archetype with members, plays_* -----------

test("6.6.0: decks are stamped (backfill and at insert), group_by folds by label or family with members, the filter reads the stamp, fit says what the player already plays", async () => {
  const { archetypeStamp } =
    await import("../../migrate/src/ops-archetypes.mjs");
  const { default: pg } = await import("pg");
  // The vocabulary was imported by the 6.5.0 test above; the two fixture
  // decks pre-date it, so they are unstamped until the backfill.
  const { rows: before } = await scratch.db.query(
    `select count(*) filter (where archetype_label is null)::int as unstamped from deck`,
  );
  assert.ok(before[0].unstamped >= 2);
  const stamped = await archetypeStamp(scratch.url);
  assert.ok(stamped.written >= 2);
  assert.match(stamped.version, /^2026-09\|/);
  const { rows: after } = await scratch.db.query(
    `select archetype_family, archetype_label, archetype_win_conditions, archetype_version from deck where archetype_label is not null`,
  );
  assert.ok(after.length >= 2);
  for (const r of after) {
    assert.equal(r.archetype_family, "cycle");
    assert.equal(r.archetype_label, "Hog Rider cycle");
    assert.deepEqual(r.archetype_win_conditions, [26000021]);
    assert.equal(r.archetype_version, stamped.version);
  }
  // A second run writes nothing: the stamp is current.
  const again = await archetypeStamp(scratch.url);
  assert.equal(again.written, 0);

  // A deck inserted now is stamped at insert (deck-cards.mjs
  // projectDecks): a new tower troop makes a new identity.
  const { projectDecks } = await import("../../ingest/src/deck-cards.mjs");
  const NEW_TOWER = { id: 159000001, name: "Cannoneer" };
  const newHash = deckHash({
    cards: IDS.map((id) => ({ id })),
    towerTroopId: NEW_TOWER.id,
  });
  // (A fresh client: the vocabulary cache on scratch.db predates the import.)
  const ingestClient = new pg.Client({ connectionString: scratch.url });
  await ingestClient.connect();
  await projectDecks(ingestClient, [
    {
      battle_id: "df-stamp-1",
      player_tag: TAG,
      battle_time: "2026-09-04T12:00:00Z",
      deck_hash: newHash,
      deck: { cards: cards(0), supportCards: [NEW_TOWER] },
    },
  ]);
  await ingestClient.end();
  const { rows: fresh } = await scratch.db.query(
    `select archetype_label, archetype_version from deck where deck_hash = $1`,
    [newHash],
  );
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].archetype_label, "Hog Rider cycle");
  assert.equal(fresh[0].archetype_version, stamped.version);

  const client = new pg.Client({ connectionString: scratch.url });
  await client.connect();
  try {
    const callFresh = (name, args) =>
      registry.invoke(name, { db: client, account }, args);
    // group_by archetype on the player segment: one row, with members.
    const byLabel = await callFresh("battles_meta_decks", {
      segment: { player_tag: TAG },
      from: "2026-09-01",
      min_battles: 1,
      group_by: "archetype",
    });
    assert.deepEqual(byLabel.decks, []);
    assert.equal(byLabel.applied.group_by, "archetype");
    assert.equal(byLabel.archetypes.length, 1);
    const row = byLabel.archetypes[0];
    assert.equal(row.label, "Hog Rider cycle");
    assert.equal(row.family, "cycle");
    assert.deepEqual(row.win_condition_ids, [26000021]);
    assert.equal(row.decks, 2);
    assert.equal(row.battles, 6);
    assert.equal(row.wins, 6);
    assert.equal(row.players, 1, "exact: one member");
    assert.equal(row.share, 1);
    assert.equal(row.members.length, 1);
    assert.equal(row.members[0].player_tag, TAG);
    assert.equal(row.members[0].battles, 6);
    assert.ok(row.members[0].deck_hash, "their most-played deck of the shape");
    assert.ok(!("shrunk_win_rate" in row), "never a tier list");
    assert.match(byLabel.notes[0], /Folded 2 decks .* into 1 archetypes/);
    assert.match(byLabel.notes[0], /players is exact/);
    // By family: the same one row under family.
    const byFamily = await callFresh("battles_meta_decks", {
      segment: { player_tag: TAG },
      from: "2026-09-01",
      min_battles: 1,
      group_by: "family",
    });
    assert.equal(byFamily.archetypes.length, 1);
    assert.equal(byFamily.archetypes[0].family, "cycle");
    assert.ok(!("label" in byFamily.archetypes[0]));
    // The filter now reads the stamp over every candidate.
    const filtered = await callFresh("battles_meta_decks", {
      segment: { player_tag: TAG },
      from: "2026-09-01",
      min_battles: 1,
      archetype: "hog cycle",
    });
    assert.equal(filtered.decks.length, 2);
    assert.ok(filtered.notes.some((n) => /ran over all 2 decks/.test(n)));
    // fit_for on a player who fields these decks: plays_family true.
    await scratch.db.query(
      `insert into player_card (player_tag, card_id, level, count, evolution_level, star_level, first_seen_at, observed_at)
       select $1, card_id, 14, 1, 1, 0, now(), now() from card where card_id in (26000007,26000021,26000000,26000010,28000011,26000014,27000000,28000001)
       on conflict do nothing`,
      [TAG],
    );
    const fitted = await callFresh("battles_meta_decks", {
      segment: { player_tag: TAG },
      from: "2026-09-01",
      min_battles: 1,
      fit_for: TAG,
    });
    assert.deepEqual(fitted.fit_for.plays, {
      families: ["cycle"],
      win_conditions: ["Hog Rider"],
      archetypes: ["Hog Rider cycle"],
    });
    for (const d of fitted.decks) {
      assert.equal(d.fit.plays_family, true);
      // 6.13.0: the middle rung - the win condition, form included.
      assert.equal(d.fit.plays_win_condition, true);
      assert.equal(d.fit.plays_archetype, true);
    }
    assert.ok(fitted.notes.some((n) => /costs the least/.test(n)));
    assert.ok(
      fitted.notes.some((n) => /plays_win_condition/.test(n)),
      "the note names the rung",
    );
    assert.ok(
      fitted.notes.some((n) => /Evo Royal Hogs is not Royal Hogs/.test(n)),
      "the form rule is said",
    );
    // cards_card.decks takes the same filter.
    const cc = await callFresh("cards_card", {
      card_id: 26000007,
      segment: { player_tag: TAG },
      from: "2026-09-01",
      archetype: "cycle",
    });
    assert.equal(cc.applied.archetype.family, "cycle");
    assert.equal(cc.decks.length, 2);
    const ccNone = await callFresh("cards_card", {
      card_id: 26000007,
      segment: { player_tag: TAG },
      from: "2026-09-01",
      archetype: "siege",
    });
    assert.deepEqual(ccNone.decks, []);
    await assert.rejects(
      callFresh("battles_meta_decks", {
        segment: { player_tag: TAG },
        group_by: "colour",
      }),
      (e) => e.code === "bad_request",
    );
  } finally {
    await client.end();
  }
});

// --- 6.8.0: cards_archetype, the resolver ----------------------------------

test("6.8.0 cards_archetype: a name to its shape and this season's corpus; eight cards to a name with or without a record; the vocabulary; nonsense refuses", async () => {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: scratch.url });
  await client.connect();
  try {
    const callFresh = (name, args) =>
      registry.invoke(name, { db: client, account }, args);
    // name: the alias, the family word, the composed label.
    const alias = await callFresh("cards_archetype", { name: "2.6 hog" });
    assert.equal(alias.resolved.family, "cycle");
    assert.equal(alias.resolved.resolved_from, "alias");
    assert.deepEqual(
      alias.resolved.win_conditions.map((w) => w.id),
      [26000021],
    );
    assert.equal(alias.resolved.label, "Hog Rider cycle");
    assert.ok(alias.resolved.aliases.includes("2.6 Hog"));
    assert.equal(typeof alias.this_season.decks, "number");
    assert.equal(alias.version.cycle_max, 3.4);
    assert.ok(alias.notes[0].includes("resolved by a community alias"));
    const fam = await callFresh("cards_archetype", { name: "Bridge Spam" });
    assert.equal(fam.resolved.family, "bridge_spam");
    assert.deepEqual(fam.resolved.win_conditions, []);
    assert.equal(fam.resolved.label, "Bridge spam");
    const label = await callFresh("cards_archetype", {
      name: "hog rider cycle",
    });
    assert.equal(label.resolved.resolved_from, "label");
    await assert.rejects(
      callFresh("cards_archetype", { name: "purple monkey dishwasher" }),
      (e) => e.code === "bad_request" && /LavaLoon/.test(e.hint),
    );

    // cards: the fixture deck by names, with a form prefix; and a set
    // nobody recorded has played.
    const named = await callFresh("cards_archetype", {
      cards: [
        "Evo Hog Rider",
        "Witch",
        "knight",
        "Skeletons",
        "The Log",
        "Musketeer",
        "Cannon",
        "Arrows",
      ],
    });
    assert.equal(named.archetype.label, "Evo Hog Rider cycle");
    assert.equal(named.archetype.family, "cycle");
    assert.equal(named.archetype.average_elixir, 3.13);
    assert.deepEqual(named.archetype.win_conditions, [
      { id: 26000021, name: "Hog Rider", form: "evolution" },
    ]);
    assert.ok(
      named.in_the_record.identities >= 2,
      "the fixture's identities share this card set",
    );
    assert.equal(named.applied.cards.find((c) => c.id === 26000021).form, 1);
    const byId = await callFresh("cards_archetype", {
      cards: [
        26000021, 26000007, 26000000, 26000010, 28000011, 26000014, 27000000,
        28000001,
      ],
    });
    assert.equal(byId.archetype.label, "Hog Rider cycle");
    const unplayed = await callFresh("cards_archetype", {
      cards: [
        "Hog Rider",
        "Witch",
        "Knight",
        "Skeletons",
        "The Log",
        "Musketeer",
        "Cannon",
      ],
    });
    assert.equal(unplayed.in_the_record.identities, 0);
    assert.equal(unplayed.archetype.family, "cycle");
    assert.ok(unplayed.notes.some((n) => /7 cards named, not eight/.test(n)));
    await assert.rejects(
      callFresh("cards_archetype", { cards: ["Hog Rider", "Purple Monkey"] }),
      (e) => e.code === "not_found" && /Purple Monkey/.test(e.message),
    );
    await assert.rejects(
      callFresh("cards_archetype", { name: "cycle", cards: [26000021] }),
      (e) => e.code === "bad_request",
    );

    // the vocabulary
    const vocab = await callFresh("cards_archetype", {});
    assert.equal(vocab.families.length, 7);
    assert.ok(
      vocab.win_conditions.some(
        (w) => w.name === "Hog Rider" && w.at_cycle_cost === "cycle",
      ),
    );
    assert.ok(vocab.aliases.some((a) => a.alias === "2.6 Hog"));
    assert.match(vocab.grammar, /highest-priority win condition/);
    assert.equal(vocab.version.grammar_version, "2026-09");
  } finally {
    await client.end();
  }
});
