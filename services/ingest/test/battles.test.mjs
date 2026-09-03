import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ingestBattlelog, canonicalizeBattle } from '../src/battles.mjs';
import { canonicalBattleTime } from '../src/battle-time.mjs';
import { fixture, fixtureMeta, scratchDb, seedReceipt } from './helpers.mjs';

let ctx;
let receiptId;
let meta;

before(async () => {
  ctx = await scratchDb('battles');
  receiptId = await seedReceipt(ctx.db);
  meta = await fixtureMeta();
});

after(async () => ctx.drop());

test('canonical battle time is pinned', () => {
  assert.equal(canonicalBattleTime('20260903T081553.000Z'), '2026-09-03T08:15:53Z');
  assert.throws(() => canonicalBattleTime('2026-09-03T08:15:53Z'));
});

test('boat + duel log ingests; duel is ONE battle with rounds', async () => {
  const log = await fixture('player_battlelog/with_boat_and_duel.json');
  const observer = meta['player_battlelog/with_boat_and_duel.json'].entity_key;
  const result = await ingestBattlelog(ctx.db, { observerTag: observer, receiptId, payload: log });
  assert.equal(result.battlesSeen, log.length);
  assert.ok(result.battlesInserted > 0);

  const { rows: duels } = await ctx.db.query(
    `select bp.deck, bp.deck_hash from battle b
     join battle_participant bp on bp.battle_id = b.battle_id
     where b.type like 'riverRaceDuel%'`,
  );
  assert.ok(duels.length >= 2, 'duel participants present');
  for (const d of duels) {
    assert.ok(Array.isArray(d.deck.rounds), 'duel stores rounds');
    assert.equal(d.deck_hash, null, 'duel has no single deck identity');
  }

  const { rows: boats } = await ctx.db.query(
    `select type_class from battle where type like 'boatBattle%'`,
  );
  assert.ok(boats.length > 0);
  assert.ok(boats.every((b) => b.type_class === 'boat'));
});

test('re-ingest is idempotent', async () => {
  const log = await fixture('player_battlelog/with_boat_and_duel.json');
  const observer = meta['player_battlelog/with_boat_and_duel.json'].entity_key;
  const beforeCount = (await ctx.db.query('select count(*)::int n from battle')).rows[0].n;
  const result = await ingestBattlelog(ctx.db, { observerTag: observer, receiptId, payload: log });
  assert.equal(result.battlesInserted, 0);
  const afterCount = (await ctx.db.query('select count(*)::int n from battle')).rows[0].n;
  assert.equal(afterCount, beforeCount);
});

test('second observer dedupes to the same battles, adds observations', async () => {
  const log = await fixture('player_battlelog/with_boat_and_duel.json');
  const beforeCount = (await ctx.db.query('select count(*)::int n from battle')).rows[0].n;
  const result = await ingestBattlelog(ctx.db, {
    observerTag: '#2PP0V90Y',
    receiptId,
    payload: log,
  });
  assert.equal(result.battlesInserted, 0, 'same battles, no new rows');
  const afterCount = (await ctx.db.query('select count(*)::int n from battle')).rows[0].n;
  assert.equal(afterCount, beforeCount);
  const { rows } = await ctx.db.query(
    `select count(distinct observer_tag)::int n from battle_observation`,
  );
  assert.equal(rows[0].n, 2);
});

test('2v2 battles carry four participants, symmetrically', async () => {
  const log = await fixture('player_battlelog/with_clanmate_2v2.json');
  const observer = meta['player_battlelog/with_clanmate_2v2.json'].entity_key;
  await ingestBattlelog(ctx.db, { observerTag: observer, receiptId, payload: log });
  const { rows } = await ctx.db.query(
    `select b.battle_id, count(*)::int participants,
            count(*) filter (where bp.side = 0)::int team,
            count(*) filter (where bp.side = 1)::int opp
     from battle b join battle_participant bp on bp.battle_id = b.battle_id
     where b.type = 'clanMate2v2' group by b.battle_id`,
  );
  assert.ok(rows.length > 0, '2v2 battles ingested');
  for (const r of rows) {
    assert.equal(r.participants, 4);
    assert.equal(r.team, 2);
    assert.equal(r.opp, 2);
  }
});

test('outcome precedence invariants hold across every ingested row', async () => {
  const { rows } = await ctx.db.query(
    `select b.type_class, bp.trophy_change, bp.outcome from battle_participant bp
     join battle b on b.battle_id = bp.battle_id`,
  );
  assert.ok(rows.length > 50);
  for (const r of rows) {
    assert.ok(['win', 'loss', 'draw', 'unresolved'].includes(r.outcome));
    if (r.type_class === 'pvp' && r.trophy_change !== null && r.trophy_change !== 0) {
      assert.equal(r.outcome, r.trophy_change > 0 ? 'win' : 'loss');
    }
  }
});

test('enrich-on-dedup fills missing fields and never overwrites', async () => {
  const log = await fixture('player_battlelog/with_path_of_legend.json');
  const observer = meta['player_battlelog/with_path_of_legend.json'].entity_key;
  const entry = structuredClone(log.find((b) => b.type === 'PvP') ?? log[0]);

  // First observation arrives thin: no elixirLeaked anywhere.
  const thin = structuredClone(entry);
  for (const p of [...(thin.team ?? []), ...(thin.opponent ?? [])]) delete p.elixirLeaked;
  await ingestBattlelog(ctx.db, { observerTag: observer, receiptId, payload: [thin] });

  const { battle } = canonicalizeBattle(entry);
  const q = `select elixir_leaked from battle_participant where battle_id = $1 and elixir_leaked is not null`;
  assert.equal((await ctx.db.query(q, [battle.battle_id])).rows.length, 0, 'thin first');

  // Full observation enriches the missing field.
  await ingestBattlelog(ctx.db, { observerTag: '#2PP0V90Y', receiptId, payload: [entry] });
  const enriched = (await ctx.db.query(q, [battle.battle_id])).rows.length;
  const hasLeak = [...(entry.team ?? []), ...(entry.opponent ?? [])].filter(
    (p) => p.elixirLeaked !== undefined,
  ).length;
  assert.equal(enriched, hasLeak, 'missing fields filled by second observer');
});

test('empty battlelog is a clean no-op', async () => {
  const result = await ingestBattlelog(ctx.db, {
    observerTag: '#9JQ0U989',
    receiptId,
    payload: await fixture('player_battlelog/empty.json'),
  });
  assert.deepEqual(result, { battlesSeen: 0, battlesInserted: 0 });
});
