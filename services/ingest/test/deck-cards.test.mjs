import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { ingestBattlelog } from "../src/battles.mjs";
import { projectCardCatalog, projectPlayerCards } from "../src/cards.mjs";
import { participantCardRows } from "../src/deck-cards.mjs";
import { fixture, fixtureMeta, scratchDb, seedReceipt } from "./helpers.mjs";

let ctx;
let receiptId;
let meta;

before(async () => {
  ctx = await scratchDb("deckcards");
  receiptId = await seedReceipt(ctx.db);
  meta = await fixtureMeta();
});

after(async () => ctx.drop());

/** The JSON-derived card list for every participant, keyed by
 *  battle|tag, to compare against the rows. */
async function jsonCards(db) {
  const { rows } = await db.query(
    `select battle_id, player_tag, deck, deck_hash from battle_participant`,
  );
  const out = new Map();
  for (const r of rows)
    out.set(`${r.battle_id}|${r.player_tag}`, {
      deck_hash: r.deck_hash,
      cards: participantCardRows(r.deck),
    });
  return out;
}

test("played cards land as rows that agree with the deck JSON, before the catalog knows the cards", async () => {
  // 0091 is a stub-only world here: the catalog fixture is NOT loaded,
  // so every card in every battle is unknown - ingest must not pause.
  for (const name of [
    "player_battlelog/with_boat_and_duel.json",
    "player_battlelog/with_clanmate_2v2.json",
  ]) {
    const result = await ingestBattlelog(ctx.db, {
      observerTag: meta[name].entity_key,
      receiptId,
      payload: await fixture(name),
    });
    assert.ok(result.battlesInserted > 0);
  }

  const expected = await jsonCards(ctx.db);
  const { rows: played } = await ctx.db.query(
    `select battle_id, player_tag, round, card_id, form, slot, level, star_level
     from battle_participant_card order by battle_id, player_tag, round, slot`,
  );
  const byKey = new Map();
  for (const r of played) {
    const k = `${r.battle_id}|${r.player_tag}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r);
  }
  let participants = 0;
  for (const [k, { cards }] of expected) {
    if (cards.length === 0) {
      assert.equal(byKey.get(k), undefined, `${k} has no cards, no rows`);
      continue;
    }
    participants += 1;
    const rows = byKey.get(k) ?? [];
    assert.equal(rows.length, cards.length, `${k} row count`);
    const want = cards
      .map(
        (c) =>
          `${c.round}:${c.slot}:${c.card_id}:${c.form}:${c.level}:${c.star_level}`,
      )
      .sort();
    const got = rows
      .map(
        (r) =>
          `${r.round}:${r.slot}:${r.card_id}:${r.form}:${r.level}:${r.star_level}`,
      )
      .sort();
    assert.deepEqual(got, want, `${k} cards`);
  }
  assert.ok(participants > 4, "several participants compared");

  // Every deck_hash a participant carries has its deck row, with the
  // identity's cards - eight of them, plus the tower troop as a FK.
  // A pvp deck is eight cards; a boat defense lists twelve. card_count
  // records what was played, deck_card holds exactly those.
  const { rows: decks } = await ctx.db.query(
    `select distinct bp.deck_hash, b.type_class, d.card_count, d.tower_troop_id,
            (select count(*)::int from deck_card dc where dc.deck_hash = d.deck_hash) as cards
     from battle_participant bp
     join battle b on b.battle_id = bp.battle_id
     join deck d on d.deck_hash = bp.deck_hash
     where bp.deck_hash is not null`,
  );
  assert.ok(decks.length > 0);
  for (const d of decks) {
    assert.equal(d.cards, d.card_count, `${d.deck_hash} deck_card rows`);
    if (d.type_class === "pvp")
      assert.equal(d.card_count, 8, `${d.deck_hash} pvp card_count`);
  }
  assert.ok(
    decks.some((d) => d.type_class === "pvp" && d.tower_troop_id !== null),
    "a pvp deck carries its tower troop",
  );
  const {
    rows: [orphans],
  } = await ctx.db.query(
    `select count(*)::int as n from battle_participant bp
     where bp.deck_hash is not null and not exists (select 1 from deck d where d.deck_hash = bp.deck_hash)`,
  );
  assert.equal(orphans.n, 0, "no participant without its deck row");

  // Duels: rows per round, no deck identity.
  const { rows: duel } = await ctx.db.query(
    `select count(distinct c.round)::int as rounds
     from battle_participant_card c join battle b on b.battle_id = c.battle_id
     where b.type like 'riverRaceDuel%'`,
  );
  assert.ok(duel[0].rounds >= 2, "duel rounds are distinct decks");

  // Every card is a stub until /cards confirms it, and the stub queued
  // one live catalog fetch.
  const {
    rows: [cards],
  } = await ctx.db.query(
    `select count(*)::int as total,
            count(*) filter (where catalog_seen_at is null)::int as stubs,
            count(*) filter (where kind = 'support')::int as support
     from card`,
  );
  assert.ok(cards.total > 20);
  assert.equal(cards.stubs, cards.total, "all stubs before the catalog");
  assert.ok(cards.support > 0, "tower troops stubbed with their kind");
  const { rows: jobs } = await ctx.db.query(
    `select lane, status from job where endpoint = 'cards' and entity_key = 'GLOBAL'`,
  );
  assert.deepEqual(jobs, [{ lane: "live", status: "queued" }]);
});

test("an empty cards array is captured but has no deck identity (0093)", async () => {
  const { canonicalizeBattle } = await import("../src/battles.mjs");
  const log = await fixture("player_battlelog/with_clanmate_2v2.json");
  const entry = structuredClone(log[0]);
  for (const side of ["team", "opponent"])
    for (const p of entry[side]) p.cards = [];
  const { participants } = canonicalizeBattle(entry);
  assert.ok(participants.length >= 2);
  for (const p of participants) {
    assert.deepEqual(p.deck.cards, []);
    assert.equal(p.deck_hash, null);
  }
});

test("re-ingest writes nothing to the projections", async () => {
  const name = "player_battlelog/with_boat_and_duel.json";
  const versions = async () =>
    (
      await ctx.db.query(`
        select 'd' as t, deck_hash as k, xmin::text as v from deck
        union all
        select 'dc', deck_hash || '|' || card_id || '|' || form, xmin::text from deck_card
        union all
        select 'pc', battle_id || '|' || player_tag || '|' || round || '|' || card_id || '|' || form, xmin::text
          from battle_participant_card
        union all
        select 'c', card_id::text, xmin::text from card
        order by 1, 2`)
    ).rows;
  const before = await versions();
  await ingestBattlelog(ctx.db, {
    observerTag: meta[name].entity_key,
    receiptId,
    payload: await fixture(name),
  });
  assert.deepEqual(await versions(), before, "no row version moved");
  const { rows: jobs } = await ctx.db.query(
    `select count(*)::int as n from job where endpoint = 'cards'`,
  );
  assert.equal(jobs[0].n, 1, "still one queued catalog job");
});

test("the catalog heals stubs: catalog_seen_at stamped, fields filled, nothing else rewritten", async () => {
  const catalog = await fixture("cards/catalog.json");
  const fetchedAt = "2026-09-15T02:00:00Z";
  const { rows: stubsBefore } = await ctx.db.query(
    `select card_id from card where catalog_seen_at is null order by card_id`,
  );
  const catalogIds = new Set(
    [...(catalog.items ?? []), ...(catalog.supportItems ?? [])].map(
      (c) => c.id,
    ),
  );
  const healable = stubsBefore.filter((r) => catalogIds.has(r.card_id));
  assert.ok(healable.length > 0, "fixture catalog covers fixture battles");

  const first = await projectCardCatalog(ctx.db, {
    payload: catalog,
    fetchedAt,
  });
  assert.ok(first.changed >= healable.length);
  const { rows: healed } = await ctx.db.query(
    `select card_id, rarity, max_level from card
     where card_id = any($1) and catalog_seen_at is not null`,
    [healable.map((r) => r.card_id)],
  );
  assert.equal(healed.length, healable.length, "every covered stub healed");
  assert.ok(
    healed.every((c) => c.rarity !== null && c.max_level !== null),
    "healed rows carry catalog fields",
  );

  // A stub keeps its id and the battle-observed name until then; the
  // catalog's name wins on heal.
  const again = await projectCardCatalog(ctx.db, {
    payload: catalog,
    fetchedAt: "2026-09-15T03:00:00Z",
  });
  assert.equal(
    again.changed,
    0,
    "a re-fetch of the same catalog writes nothing",
  );
});

test("a collection naming a card the catalog lacks stubs it instead of failing the FK", async () => {
  await ctx.db.query(
    `insert into player (player_tag) values ('#PPQQ0289') on conflict do nothing`,
  );
  const unknownId = 26000999;
  const result = await projectPlayerCards(ctx.db, {
    playerTag: "#PPQQ0289",
    payload: {
      cards: [
        { id: unknownId, name: "Brand New", level: 3, maxLevel: 14, count: 1 },
      ],
      supportCards: [],
    },
    fetchedAt: "2026-09-15T04:00:00Z",
  });
  assert.equal(result.changed, 1);
  const {
    rows: [stub],
  } = await ctx.db.query(
    `select name, kind, catalog_seen_at from card where card_id = $1`,
    [unknownId],
  );
  assert.deepEqual(stub, {
    name: "Brand New",
    kind: "card",
    catalog_seen_at: null,
  });
});

test("the table aggregate equals the JSON-explode aggregate the readers used to run (old vs new pin)", async () => {
  // battles_meta_cards' old shape: one row per (card, form) over decided
  // pvp participants, from jsonb_array_elements(deck->'cards'). The new
  // shape reads battle_participant_card at round 0, slot > 0. Same rows.
  const oldRows = (
    await ctx.db.query(
      `select (c.value->>'id')::int as card_id,
              coalesce((c.value->>'evolutionLevel')::int, 0) as form,
              count(*)::int as n,
              count(*) filter (where c.ordinality = 1)::int as firsts
       from battle_participant bp
       cross join lateral jsonb_array_elements(bp.deck->'cards') with ordinality as c(value, ordinality)
       where bp.deck ? 'cards' and jsonb_array_length(bp.deck->'cards') > 0
       group by 1, 2 order by 1, 2`,
    )
  ).rows;
  const newRows = (
    await ctx.db.query(
      `select pc.card_id, pc.form::int as form, count(*)::int as n,
              count(*) filter (where pc.slot = 1)::int as firsts
       from battle_participant bp
       join battle_participant_card pc
         on pc.battle_id = bp.battle_id and pc.player_tag = bp.player_tag
        and pc.round = 0 and pc.slot > 0
       where bp.deck_hash is not null
       group by 1, 2 order by 1, 2`,
    )
  ).rows;
  assert.ok(oldRows.length > 30, "enough cards to mean something");
  assert.deepEqual(newRows, oldRows);

  // And the with_card filter: JSON containment vs the index probe.
  const anyCard = oldRows[0].card_id;
  const oldMatch = (
    await ctx.db.query(
      `select count(*)::int as n from battle_participant bp
       where bp.deck->'cards' @> $1::jsonb`,
      [JSON.stringify([{ id: anyCard }])],
    )
  ).rows[0].n;
  const newMatch = (
    await ctx.db.query(
      `select count(*)::int as n from battle_participant bp
       where exists (select 1 from battle_participant_card c
                     where c.battle_id = bp.battle_id and c.player_tag = bp.player_tag
                       and c.round = 0 and c.slot > 0 and c.card_id = $1)`,
      [anyCard],
    )
  ).rows[0].n;
  assert.ok(oldMatch > 0);
  assert.equal(newMatch, oldMatch);
});
