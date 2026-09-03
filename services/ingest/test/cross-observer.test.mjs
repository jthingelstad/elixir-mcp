import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ingestBattlelog } from '../src/battles.mjs';
import { fixture, fixtureMeta, scratchDb, seedReceipt } from './helpers.mjs';

/**
 * The core dedup claim, proven with REAL data: two players who battled each
 * other were both recorded; each log contains the same battle from opposite
 * perspectives. Ingesting both must produce ONE battle row, symmetric
 * participants, and two observations. (Jamie's reminder, 2026-09-03.)
 */

const SHARED_BATTLE_TIME = '2026-08-28T19:06:19Z';

let ctx;
let receiptId;
let meta;

before(async () => {
  ctx = await scratchDb('xobs');
  receiptId = await seedReceipt(ctx.db);
  meta = await fixtureMeta();
});

after(async () => ctx.drop());

test('real cross-observer logs dedupe to one battle with two observations', async () => {
  const logA = await fixture('player_battlelog/with_clanmate_2v2.json');
  const logB = await fixture('player_battlelog/counterpart_2v2_teammate.json');
  const obsA = meta['player_battlelog/with_clanmate_2v2.json'].entity_key;
  const obsB = meta['player_battlelog/counterpart_2v2_teammate.json'].entity_key;

  await ingestBattlelog(ctx.db, { observerTag: obsA, receiptId, payload: logA });
  await ingestBattlelog(ctx.db, { observerTag: obsB, receiptId, payload: logB });

  const { rows: battles } = await ctx.db.query(
    `select battle_id from battle where battle_time = $1 and type = 'clanMate2v2'`,
    [SHARED_BATTLE_TIME],
  );
  assert.equal(battles.length, 1, 'both perspectives collapse to one battle row');
  const battleId = battles[0].battle_id;

  const { rows: participants } = await ctx.db.query(
    `select count(*)::int n,
            count(*) filter (where side = 0)::int side0,
            count(*) filter (where side = 1)::int side1
     from battle_participant where battle_id = $1`,
    [battleId],
  );
  assert.equal(participants[0].n, 4, 'four symmetric participants, no duplicates');
  assert.equal(participants[0].side0, 2, 'team partition intact');
  assert.equal(participants[0].side1, 2);

  const { rows: observations } = await ctx.db.query(
    `select observer_tag from battle_observation where battle_id = $1 order by observer_tag`,
    [battleId],
  );
  assert.deepEqual(
    observations.map((o) => o.observer_tag),
    [obsA, obsB].sort(),
    'one observation per observer',
  );

  // Outcomes are per-participant facts and must be consistent regardless of
  // which perspective landed first: teammates share a fate in 2v2.
  const { rows: outcomes } = await ctx.db.query(
    `select side, array_agg(distinct outcome) outcomes
     from battle_participant where battle_id = $1 group by side`,
    [battleId],
  );
  for (const r of outcomes) {
    assert.equal(r.outcomes.length, 1, `side ${r.side} teammates share one outcome`);
  }
});
