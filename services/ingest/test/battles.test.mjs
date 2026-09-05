import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { ingestBattlelog, canonicalizeBattle } from "../src/battles.mjs";
import { canonicalBattleTime } from "../src/battle-time.mjs";
import { fixture, fixtureMeta, scratchDb, seedReceipt } from "./helpers.mjs";

let ctx;
let receiptId;
let meta;

before(async () => {
  ctx = await scratchDb("battles");
  receiptId = await seedReceipt(ctx.db);
  meta = await fixtureMeta();
});

after(async () => ctx.drop());

test("canonical battle time is pinned", () => {
  assert.equal(
    canonicalBattleTime("20260903T081553.000Z"),
    "2026-09-03T08:15:53Z",
  );
  assert.throws(() => canonicalBattleTime("2026-09-03T08:15:53Z"));
});

test("boat + duel log ingests; duel is ONE battle with rounds", async () => {
  const log = await fixture("player_battlelog/with_boat_and_duel.json");
  const observer = meta["player_battlelog/with_boat_and_duel.json"].entity_key;
  const result = await ingestBattlelog(ctx.db, {
    observerTag: observer,
    receiptId,
    payload: log,
  });
  assert.equal(result.battlesSeen, log.length);
  assert.ok(result.battlesInserted > 0);

  const { rows: duels } = await ctx.db.query(
    `select bp.deck, bp.deck_hash from battle b
     join battle_participant bp on bp.battle_id = b.battle_id
     where b.type like 'riverRaceDuel%'`,
  );
  assert.ok(duels.length >= 2, "duel participants present");
  for (const d of duels) {
    assert.ok(Array.isArray(d.deck.rounds), "duel stores rounds");
    assert.equal(d.deck_hash, null, "duel has no single deck identity");
  }

  const { rows: boats } = await ctx.db.query(
    `select type_class from battle where type like 'boatBattle%'`,
  );
  assert.ok(boats.length > 0);
  assert.ok(boats.every((b) => b.type_class === "boat"));
});

test("re-ingest is idempotent", async () => {
  const log = await fixture("player_battlelog/with_boat_and_duel.json");
  const observer = meta["player_battlelog/with_boat_and_duel.json"].entity_key;
  const beforeCount = (await ctx.db.query("select count(*)::int n from battle"))
    .rows[0].n;
  const result = await ingestBattlelog(ctx.db, {
    observerTag: observer,
    receiptId,
    payload: log,
  });
  assert.equal(result.battlesInserted, 0);
  const afterCount = (await ctx.db.query("select count(*)::int n from battle"))
    .rows[0].n;
  assert.equal(afterCount, beforeCount);
});

test("second observer dedupes to the same battles, adds observations", async () => {
  const log = await fixture("player_battlelog/with_boat_and_duel.json");
  const beforeCount = (await ctx.db.query("select count(*)::int n from battle"))
    .rows[0].n;
  const result = await ingestBattlelog(ctx.db, {
    observerTag: "#2PP0V90Y",
    receiptId,
    payload: log,
  });
  assert.equal(result.battlesInserted, 0, "same battles, no new rows");
  const afterCount = (await ctx.db.query("select count(*)::int n from battle"))
    .rows[0].n;
  assert.equal(afterCount, beforeCount);
  const { rows } = await ctx.db.query(
    `select count(distinct observer_tag)::int n from battle_observation`,
  );
  assert.equal(rows[0].n, 2);
});

test("2v2 battles carry four participants, symmetrically", async () => {
  const log = await fixture("player_battlelog/with_clanmate_2v2.json");
  const observer = meta["player_battlelog/with_clanmate_2v2.json"].entity_key;
  await ingestBattlelog(ctx.db, {
    observerTag: observer,
    receiptId,
    payload: log,
  });
  const { rows } = await ctx.db.query(
    `select b.battle_id, count(*)::int participants,
            count(*) filter (where bp.side = 0)::int team,
            count(*) filter (where bp.side = 1)::int opp
     from battle b join battle_participant bp on bp.battle_id = b.battle_id
     where b.type = 'clanMate2v2' group by b.battle_id`,
  );
  assert.ok(rows.length > 0, "2v2 battles ingested");
  for (const r of rows) {
    assert.equal(r.participants, 4);
    assert.equal(r.team, 2);
    assert.equal(r.opp, 2);
  }
});

test("outcome precedence invariants hold across every ingested row", async () => {
  const { rows } = await ctx.db.query(
    `select b.type_class, bp.trophy_change, bp.outcome from battle_participant bp
     join battle b on b.battle_id = bp.battle_id`,
  );
  assert.ok(rows.length > 50);
  for (const r of rows) {
    assert.ok(["win", "loss", "draw", "unresolved"].includes(r.outcome));
    if (
      r.type_class === "pvp" &&
      r.trophy_change !== null &&
      r.trophy_change !== 0
    ) {
      assert.equal(r.outcome, r.trophy_change > 0 ? "win" : "loss");
    }
  }
});

test("enrich-on-dedup fills missing fields and never overwrites", async () => {
  const log = await fixture("player_battlelog/with_path_of_legend.json");
  const observer = meta["player_battlelog/with_path_of_legend.json"].entity_key;
  const entry = structuredClone(log.find((b) => b.type === "PvP") ?? log[0]);

  // First observation arrives thin: no elixirLeaked anywhere.
  const thin = structuredClone(entry);
  for (const p of [...(thin.team ?? []), ...(thin.opponent ?? [])])
    delete p.elixirLeaked;
  await ingestBattlelog(ctx.db, {
    observerTag: observer,
    receiptId,
    payload: [thin],
  });

  const { battle } = canonicalizeBattle(entry);
  const q = `select elixir_leaked from battle_participant where battle_id = $1 and elixir_leaked is not null`;
  assert.equal(
    (await ctx.db.query(q, [battle.battle_id])).rows.length,
    0,
    "thin first",
  );

  // Full observation enriches the missing field.
  await ingestBattlelog(ctx.db, {
    observerTag: "#2PP0V90Y",
    receiptId,
    payload: [entry],
  });
  const enriched = (await ctx.db.query(q, [battle.battle_id])).rows.length;
  const hasLeak = [...(entry.team ?? []), ...(entry.opponent ?? [])].filter(
    (p) => p.elixirLeaked !== undefined,
  ).length;
  assert.equal(enriched, hasLeak, "missing fields filled by second observer");
});

test("empty battlelog is a clean no-op", async () => {
  const result = await ingestBattlelog(ctx.db, {
    observerTag: "#9JQ0U989",
    receiptId,
    payload: await fixture("player_battlelog/empty.json"),
  });
  assert.deepEqual(result, {
    battlesSeen: 0,
    battlesInserted: 0,
    captureAudit: { audited: false, gap: false },
    affectedPairs: [],
  });
});

test("deck levels are stored on the display scale, norm-stamped; 0011 backfill converts raw rows once", async () => {
  const { rows } = await ctx.db.query(
    `select bp.deck from battle_participant bp where bp.deck ? 'cards' limit 5`,
  );
  assert.ok(rows.length > 0);
  for (const r of rows) {
    assert.equal(r.deck.norm, 1, "ingest stamps norm");
    assert.ok(
      r.deck.cards.every((c) => c.level >= 9 || c.level === undefined),
      "legendary-and-up floors imply the shift happened (no raw 1-8 levels in real decks)",
    );
  }

  // Backfill: seed one raw, unstamped deck + a catalog, run 0011's SQL,
  // and prove conversion + idempotency (the norm guard).
  const { readFile } = await import("node:fs/promises");
  const sql = await readFile(
    new URL(
      "../../../db/migrations/0011_normalize_deck_levels.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await ctx.db.query(
    `insert into api_payload (endpoint, entity_key, payload_hash, payload_json)
     values ('cards', 'GLOBAL', 'norm-test',
             '{"items": [{"id": 26000035, "maxLevel": 8}], "supportItems": []}')
     on conflict do nothing`,
  );
  await ctx.db.query(`insert into player (player_tag) values ('#20UU99Y')`);
  await ctx.db.query(
    `insert into battle (battle_id, battle_time, type, type_class)
     values ('norm-test-battle', now(), 'PvP', 'pvp')`,
  );
  await ctx.db.query(
    `insert into battle_participant (battle_id, player_tag, side, deck)
     values ('norm-test-battle', '#20UU99Y', 0,
             '{"cards": [{"id": 26000035, "name": "Lumberjack", "level": 6}]}')`,
  );
  await ctx.db.query(sql);
  const first = (
    await ctx.db.query(
      `select deck from battle_participant where battle_id = 'norm-test-battle'`,
    )
  ).rows[0].deck;
  assert.equal(first.cards[0].level, 14, "raw 6/8 legendary displays as 14");
  assert.equal(first.norm, 1, "backfill stamps norm");
  await ctx.db.query(sql);
  const second = (
    await ctx.db.query(
      `select deck from battle_participant where battle_id = 'norm-test-battle'`,
    )
  ).rows[0].deck;
  assert.equal(second.cards[0].level, 14, "norm guard prevents double-shift");
});

test("0012 repair: pre-cutoff raw decks convert once; post-cutoff display decks untouched", async () => {
  const { readFile } = await import("node:fs/promises");
  const sql = await readFile(
    new URL(
      "../../../db/migrations/0012_repair_deck_levels.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await ctx.db.query(
    `insert into api_payload (endpoint, entity_key, payload_hash, payload_json)
     values ('cards', 'GLOBAL', 'repair-test',
             '{"items": [{"id": 26000035, "maxLevel": 8}], "supportItems": []}')
     on conflict do nothing`,
  );
  await ctx.db.query(
    `insert into player (player_tag) values ('#20UU99G'), ('#20UU99R')`,
  );
  // One battle first observed BEFORE the cutoff (old-code raw deck, the
  // 0011 stamp included), one after (new-code display deck).
  for (const [id, tag, seen, deck] of [
    [
      "repair-old",
      "#20UU99G",
      "2026-09-03T20:00:00Z",
      '{"norm": 1, "cards": [{"id": 26000035, "name": "Lumberjack", "level": 6}]}',
    ],
    [
      "repair-new",
      "#20UU99R",
      "2026-09-03T23:00:00Z",
      '{"norm": 1, "cards": [{"id": 26000035, "name": "Lumberjack", "level": 14}]}',
    ],
  ]) {
    await ctx.db.query(
      `insert into battle (battle_id, battle_time, type, type_class)
       values ($1, now(), 'PvP', 'pvp')`,
      [id],
    );
    await ctx.db.query(
      `insert into battle_participant (battle_id, player_tag, side, deck)
       values ($1, $2, 0, $3::jsonb)`,
      [id, tag, deck],
    );
    const { rows: rec } = await ctx.db.query(
      `insert into api_receipt (endpoint, entity_key, fetched_at, payload_hash, gateway_id, admission)
       select 'player_battlelog', $2, $3, 'ph-' || $1, g.gateway_id, 'admitted'
       from gateway g limit 1
       returning receipt_id`,
      [id, tag, seen],
    );
    await ctx.db.query(
      `insert into battle_observation (battle_id, observer_tag, receipt_id)
       values ($1, $2, $3)`,
      [id, tag, rec[0].receipt_id],
    );
  }

  await ctx.db.query(sql);
  await ctx.db.query(sql); // idempotent: norm=2 guard

  const deckOf = async (id) =>
    (
      await ctx.db.query(
        `select deck from battle_participant where battle_id = $1`,
        [id],
      )
    ).rows[0].deck;
  const oldDeck = await deckOf("repair-old");
  assert.equal(oldDeck.cards[0].level, 14, "raw 6/8 repaired to display 14");
  assert.equal(oldDeck.norm, 2);
  const newDeck = await deckOf("repair-new");
  assert.equal(newDeck.cards[0].level, 14, "display deck left alone");
  assert.equal(newDeck.norm, 1, "post-cutoff rows never touched");
});

test("battlelog participants stamp player names (fill nulls, never overwrite)", async () => {
  const payload = await fixture("player_battlelog/with_path_of_legend.json");
  const observer = meta["player_battlelog/with_path_of_legend.json"].entity_key;
  const named = payload
    .flatMap((e) => [...(e.team ?? []), ...(e.opponent ?? [])])
    .find(
      (p) =>
        p.tag &&
        p.name &&
        p.tag.toUpperCase().replace("O", "0") !== observer.toUpperCase(),
    );
  assert.ok(named, "fixture has a named participant");
  const namedTag = named.tag.toUpperCase().replace("O", "0");

  // Pre-set a DIFFERENT name for the observer: battlelog must not clobber it.
  await ctx.db.query(
    `insert into player (player_tag, name) values ($1, 'Authoritative Name')
     on conflict (player_tag) do update set name = 'Authoritative Name'`,
    [observer],
  );
  await ingestBattlelog(ctx.db, {
    observerTag: observer,
    receiptId,
    payload,
  });
  const { rows } = await ctx.db.query(
    `select name from player where player_tag = $1`,
    [namedTag],
  );
  assert.equal(rows[0].name, named.name, "opponent name filled from battlelog");
  const { rows: obs } = await ctx.db.query(
    `select name from player where player_tag = $1`,
    [observer],
  );
  assert.equal(
    obs[0].name,
    "Authoritative Name",
    "existing name never overwritten",
  );
});
