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
  assert.ok(byHash[hashFor(0)] && byHash[hashFor(1)], "both hashes present");
  // The list says the form in each row's card names (9.12.0)...
  assert.match(byHash[hashFor(1)].card_names, /\bEvo Witch\b/);
  assert.doesNotMatch(byHash[hashFor(0)].card_names, /Evo /);
  // ...and one deck asked for by its hash carries the card objects.
  const one = async (h) =>
    (await call("battles_decks", { player_tag: TAG, deck_hash: h })).decks;
  const [base] = await one(hashFor(0));
  const [evo] = await one(hashFor(1));
  assert.ok(base && evo, "each deck answers alone");

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

test("5.0.0: the catalog says the type from the id range and when it last changed vs was fetched", async () => {
  // The rows here are battle stubs (seedDeck); cards_catalog lists only
  // what /cards lists (0191, #44), so the catalog lists these three.
  await scratch.db.query(
    `update card set in_catalog = true where card_id = any($1::int[])`,
    [[26000007, 27000000, 28000001]],
  );
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

test("5.0.0 cards_card: catalog facts and first played forms in a selected player history", async () => {
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
  assert.equal(mine.season, undefined);
  assert.equal(mine.history, undefined);
  assert.equal(mine.decks, undefined);
  assert.equal(mine.partners, undefined);
  assert.equal(mine.members, undefined);
  await scratch.db.query(
    `insert into card (card_id, name, kind) values (28000000, 'Fireball', 'card') on conflict do nothing`,
  );
  const never = await call("cards_card", {
    card_id: 28000000,
    segment: { player_tag: TAG },
  });
  assert.deepEqual(never.card.first_played, {
    base: null,
    evolution: null,
    hero: null,
  });
  // Exact names only.
  await assert.rejects(
    call("cards_card", { card: "Witc", segment: { player_tag: TAG } }),
    /not an exact card name|No card named/,
  );
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
  assert.deepEqual(res.members.played[0].modes, { ladder: 6 });
  assert.deepEqual(res.members.played[0].forms, ["base", "evolution"]);
  assert.equal(res.members.held.length, 1);
  assert.equal(res.members.held[0].level, 14);
  assert.deepEqual(res.members.held[0].forms_unlocked, ["evolution"]);
});

test("card facts retain player observation metadata and tower play", async () => {
  const player = await call("cards_card", {
    card_id: TOWER.id,
    segment: { player_tag: TAG },
  });
  assert.equal(player.card.first_played.base, "2026-09-02T12:00:00.000Z");
  assert.ok(player.meta.recorded_since);
  assert.ok("player_battlelog" in player.meta.source_polls);
  assert.equal(player.meta.source_polls.player_battlelog.observed_at, null);
  const clan = await call("cards_card", {
    card_id: TOWER.id,
    segment: { clan_tag: "#2CRPCL9V" },
    from: "2026-09-01",
  });
  assert.equal(clan.members.played[0].battles, 6);
  assert.deepEqual(clan.members.played[0].forms, ["base"]);
});

test("an activity clan's unrecorded opponent history is not member play", async () => {
  const db = scratch.db;
  await db.query("begin");
  try {
    await db.query(
      "update recording set scope='activity' where subject_tag='#2CRPCL9V'",
    );
    await db.query(
      "insert into player(player_tag,name) values ('#P0LYQ','Unrecorded member')",
    );
    await db.query(
      "insert into clan_membership(clan_tag,player_tag,joined_observed_at,role) values ('#2CRPCL9V','#P0LYQ','2026-09-01','member')",
    );
    await db.query(
      "insert into battle_participant(battle_id,player_tag,side,outcome,battle_time,crowns,deck_hash,type,type_class) select battle_id,'#P0LYQ',2,'loss',battle_time,0,deck_hash,type,type_class from battle_participant where player_tag=$1 and battle_id='df-base-1'",
      [TAG],
    );
    await seedPlayedDeck(db, {
      battle_id: "df-base-1",
      player_tag: "#P0LYQ",
      battle_time: "2026-09-02T12:00:00Z",
      cards: cards(0),
      supportCards: [TOWER],
    });
    await db.query(
      "update battle set event_tag='event-fixture' where battle_id='df-evo-1'",
    );
    const res = await call("cards_card", {
      card_id: 26000007,
      segment: { clan_tag: "#2CRPCL9V" },
      from: "2026-09-01",
    });
    assert.equal(res.members.members, 2);
    assert.deepEqual(res.members.played[0].modes, { ladder: 5, event: 1 });
    assert.deepEqual(
      res.members.played.map((x) => x.player_tag),
      [TAG],
    );
    assert.equal(res.members.members_with_collection, 1);
    assert.equal(res.members.held.length, 1);
  } finally {
    await db.query("rollback");
  }
});

test("scoped card history keeps earliest forms and each card-bearing duel round", async () => {
  const db = scratch.db;
  await db.query("begin");
  try {
    await db.query(
      `insert into battle(battle_id,battle_time,type,type_class)
       values ('df-card-duel','2026-09-01T12:00:00Z','riverRaceDuel','pvp')`,
    );
    await db.query(
      `insert into battle_participant(battle_id,player_tag,side,outcome,battle_time,type,type_class)
       values ('df-card-duel',$1,0,'win','2026-09-01T12:00:00Z','riverRaceDuel','pvp')`,
      [TAG],
    );
    const roundCards = [
      cards(0).map((c) => ({ ...c, level: 13 })),
      cards(1).map((c) => ({ ...c, level: 16 })),
      cards(0).map((c) =>
        c.id === 26000007 ? { id: 28000000, name: "Fireball", level: 14 } : c,
      ),
    ];
    for (const [i, deck] of roundCards.entries()) {
      const hash = await seedDeck(db, {
        battle_time: "2026-09-01T12:00:00Z",
        cards: deck,
        supportCards: [TOWER],
      });
      await db.query(
        `insert into battle_participant_round(battle_id,player_tag,round,crowns,deck_hash,outcome)
         values ('df-card-duel',$1,$2,$3,$4,$5)`,
        [TAG, i + 1, i === 1 ? 0 : 3, hash, i === 1 ? "loss" : "win"],
      );
      await db.query(
        `insert into battle_participant_card(battle_id,player_tag,round,card_id,form,slot,level)
         values ('df-card-duel',$1,$2,$3,0,0,14)`,
        [TAG, i + 1, TOWER.id],
      );
    }
    await seedPlayedDeck(db, {
      battle_id: "df-card-duel",
      player_tag: TAG,
      battle_time: "2026-09-01T12:00:00Z",
      rounds: roundCards,
    });
    const narrowed = await call("cards_card", {
      card_id: 26000007,
      segment: { clan_tag: "#2CRPCL9V" },
      from: "2026-09-02",
      to: "2026-09-03",
      mode: "ladder",
    });
    assert.deepEqual(narrowed.card.first_played, {
      base: "2026-09-01T12:00:00.000Z",
      evolution: "2026-09-01T12:00:00.000Z",
      hero: null,
    });
    assert.equal(narrowed.members.played[0].battles, 6);
    const war = await call("cards_card", {
      card_id: 26000007,
      segment: { clan_tag: "#2CRPCL9V" },
      from: "2026-09-01",
      to: "2026-09-02",
      mode: "war",
    });
    const [played] = war.members.played;
    assert.equal(
      played.battles,
      2,
      "the other-card round and whole duel do not count",
    );
    assert.equal(played.wins, 1);
    assert.equal(played.losses, 1);
    assert.equal(played.level_played, 14.5);
    assert.deepEqual(played.forms, ["base", "evolution"]);
    assert.deepEqual(played.modes, { war: 2 });
    const tower = await call("cards_card", {
      card_id: TOWER.id,
      segment: { clan_tag: "#2CRPCL9V" },
      from: "2026-09-01",
      to: "2026-09-02",
      mode: "war",
    });
    assert.equal(
      tower.members.played[0].battles,
      3,
      "tower identity includes every round",
    );
    assert.equal(tower.card.first_played.base, "2026-09-01T12:00:00.000Z");
  } finally {
    await db.query("rollback");
  }
});

test("card history keeps unknown types and own boat attacks, excluding both defense sides", async () => {
  const db = scratch.db;
  await db.query("begin");
  try {
    const cases = [
      ["df-defense-team", "2026-08-29T12:00:00Z", 0, 0, "defender"],
      ["df-defense-other", "2026-08-30T12:00:00Z", 1, 1, "attacker"],
      ["df-own-team", "2026-09-01T12:00:00Z", 0, 0, "attacker"],
      ["df-own-other", "2026-09-01T13:00:00Z", 0, 1, "defender"],
      ["df-unknown-type", "2026-08-31T12:00:00Z", 1, 0, null],
    ];
    for (const [id, at, evo, side, boatSide] of cases) {
      await db.query(
        `insert into battle(battle_id,battle_time,type,type_class,boat_battle_side)
         values ($1,$2,$3,'pvp',$4)`,
        [id, at, boatSide ? "boatBattle" : "fixtureUnknownMode", boatSide],
      );
      const hash = await seedDeck(db, {
        battle_time: at,
        cards: cards(evo),
        supportCards: [TOWER],
      });
      await db.query(
        `insert into battle_participant(battle_id,player_tag,side,outcome,battle_time,type,type_class,deck_hash)
         values ($1,$2,$3,'win',$4,$5,'pvp',$6)`,
        [
          id,
          TAG,
          side,
          at,
          boatSide ? "boatBattle" : "fixtureUnknownMode",
          hash,
        ],
      );
      await seedPlayedDeck(db, {
        battle_id: id,
        player_tag: TAG,
        battle_time: at,
        cards: cards(evo),
        supportCards: [TOWER],
      });
    }
    const result = await call("cards_card", {
      card_id: 26000007,
      segment: { clan_tag: "#2CRPCL9V" },
      from: "2026-08-29",
      to: "2026-09-03",
    });
    assert.deepEqual(result.card.first_played, {
      base: "2026-09-01T12:00:00.000Z",
      evolution: "2026-08-31T12:00:00.000Z",
      hero: null,
    });
    assert.equal(result.members.played[0].battles, 9);
    assert.equal(result.members.played[0].wins, 9);
    assert.deepEqual(result.members.played[0].forms, ["base", "evolution"]);
  } finally {
    await db.query("rollback");
  }
});

// --- 6.5.0: the archetype on every deck object, and the archetype filter --

test("6.5.0: every deck object carries its archetype once the vocabulary is imported; the filter reads it; a name that is nothing refuses", async () => {
  const { cardRolesImport } =
    await import("../../../services/migrate/src/ops-archetypes.mjs");
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
  // Before the import: named by cost, version null. The archetype
  // object rides the one deck asked for by its hash (9.12.0).
  const listed = await call("battles_decks", {
    player_tag: TAG,
    from: "2026-09-01",
  });
  const before = await call("battles_decks", {
    player_tag: TAG,
    from: "2026-09-01",
    deck_hash: listed.decks[0].deck_hash,
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
    assert.ok(res.decks.every((d) => d.archetype_label === "Hog Rider cycle"));
    for (const listed of res.decks) {
      const [d] = (
        await callFresh("battles_decks", {
          player_tag: TAG,
          from: "2026-09-01",
          deck_hash: listed.deck_hash,
        })
      ).decks;
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
  } finally {
    await fresh.end();
  }
});

// --- 6.6.0: the stamp, group_by archetype with members, plays_* -----------

test("6.6.0: decks are stamped (backfill and at insert), group_by folds by label or family with members, the filter reads the stamp, fit says what the player already plays", async () => {
  const { archetypeStamp } =
    await import("../../../services/migrate/src/ops-archetypes.mjs");
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
    assert.equal(alias.this_season, undefined);
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
    assert.equal(named.in_the_record, undefined);
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
    assert.equal(unplayed.in_the_record, undefined);
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
