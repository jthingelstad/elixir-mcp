import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { processResult } from '../src/pipeline.mjs';
import { refreshCompleteness } from '../src/rollups.mjs';
import { fixture, fixtureMeta, scratchDb } from './helpers.mjs';

let ctx;
let gatewayId;
let meta;

function message({ endpoint, entityKey, payload, fetchedAt }) {
  return {
    v: 1,
    job: { endpoint, entity_key: entityKey, lane: 'bulk' },
    gateway_id: gatewayId,
    fetched_at: fetchedAt,
    status: 'ok',
    body_gzip_b64: gzipSync(Buffer.from(JSON.stringify(payload))).toString('base64'),
  };
}

before(async () => {
  ctx = await scratchDb('projectors');
  const {
    rows: [account],
  } = await ctx.db.query(
    `insert into account (email_hash, status, is_owner) values ('proj-owner', 'approved', true)
     returning account_id`,
  );
  const {
    rows: [gw],
  } = await ctx.db.query(
    `insert into gateway (owner_account_id, name, static_ip, status)
     values ($1, 'proj-gw', '127.0.0.1', 'active') returning gateway_id`,
    [account.account_id],
  );
  gatewayId = gw.gateway_id;
  meta = await fixtureMeta();
});

after(async () => ctx.drop());

test('profile message writes the daily snapshot; day is UTC', async () => {
  const profile = await fixture('player/profile.json');
  const tag = meta['player/profile.json'].entity_key;
  const result = await processResult(
    ctx.db,
    message({ endpoint: 'player', entityKey: tag, payload: profile, fetchedAt: '2026-09-01T23:59:00Z' }),
  );
  assert.equal(result.outcome, 'admitted');
  const { rows } = await ctx.db.query(
    `select trophies, donations, lifetime, collection_hash from player_snapshot_daily
     where player_tag = $1 and snapshot_date = '2026-09-01' and snapshot_kind = 'daily'`,
    [tag],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].trophies, profile.trophies);
  assert.equal(rows[0].donations, profile.donations);
  assert.equal(rows[0].lifetime.battleCount, profile.battleCount);
  assert.ok(rows[0].collection_hash, 'collection hash recorded (stored-on-change basis)');
});

test('later poll the same day overwrites; first sight emitted no events', async () => {
  const profile = structuredClone(await fixture('player/profile.json'));
  const tag = meta['player/profile.json'].entity_key;
  profile.trophies += 30;
  await processResult(
    ctx.db,
    message({ endpoint: 'player', entityKey: tag, payload: profile, fetchedAt: '2026-09-01T23:59:30Z' }),
  );
  const { rows } = await ctx.db.query(
    `select trophies from player_snapshot_daily where player_tag = $1 and snapshot_date = '2026-09-01'`,
    [tag],
  );
  assert.equal(rows.length, 1, 'still one daily row');
  assert.equal(rows[0].trophies, profile.trophies);
  const events = (await ctx.db.query('select count(*)::int n from player_event')).rows[0].n;
  assert.equal(events, 0, 'no diff events on first-sight day');
});

test('donation decrease across snapshots emits donation_reset with evidence', async () => {
  const profile = structuredClone(await fixture('player/profile.json'));
  const tag = meta['player/profile.json'].entity_key;
  const donationsBefore = profile.donations;
  profile.donations = 3; // weekly reset happened
  await processResult(
    ctx.db,
    message({ endpoint: 'player', entityKey: tag, payload: profile, fetchedAt: '2026-09-02T08:00:00Z' }),
  );
  const { rows } = await ctx.db.query(
    `select event_type, timing, payload from player_event where player_tag = $1`,
    [tag],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].event_type, 'donation_reset');
  assert.equal(rows[0].timing, 'estimated');
  assert.equal(rows[0].payload.donations_before, donationsBefore);
  assert.equal(rows[0].payload.donations_after, 3);
});

test('battlelog ingest refreshes rollups; totals reconcile with battles', async () => {
  const file = 'player_battlelog/with_path_of_legend.json';
  const tag = meta[file].entity_key;
  const payload = await fixture(file);
  await processResult(
    ctx.db,
    message({ endpoint: 'player_battlelog', entityKey: tag, payload, fetchedAt: '2026-09-03T14:00:34Z' }),
  );
  const { rows } = await ctx.db.query(
    `select sum(wins + losses + draws)::int as decided, sum(battles_captured)::int as captured,
            sum(trophy_delta)::int as delta
     from player_daily_battle_rollup where player_tag = $1`,
    [tag],
  );
  const { rows: truth } = await ctx.db.query(
    `select count(*)::int as n, coalesce(sum(bp.trophy_change), 0)::int as delta
     from battle_participant bp where bp.player_tag = $1`,
    [tag],
  );
  assert.equal(rows[0].captured, truth[0].n, 'every battle lands in exactly one rollup bucket');
  assert.equal(rows[0].delta, truth[0].delta, 'trophy delta reconciles');
  assert.ok(rows[0].decided <= rows[0].captured, 'unresolved outcomes are not W/L/D');
  const groups = await ctx.db.query(
    `select distinct mode_group from player_daily_battle_rollup where player_tag = $1 order by 1`,
    [tag],
  );
  assert.ok(groups.rows.some((g) => g.mode_group === 'ranked'), 'pathOfLegend maps to ranked');
});

test('completeness fills when bracketing snapshots exist', async () => {
  const tag = '#2C0PY22';
  await ctx.db.query(`insert into player (player_tag) values ($1)`, [tag]);
  await ctx.db.query(
    `insert into player_snapshot_daily (player_tag, snapshot_date, snapshot_kind, lifetime)
     values ($1, '2026-09-01', 'daily', '{"battleCount": 100}'),
            ($1, '2026-09-02', 'daily', '{"battleCount": 110}')`,
    [tag],
  );
  await ctx.db.query(
    `insert into player_daily_battle_rollup
       (player_tag, day, mode_group, game_mode_id, wins, losses, draws, battles_captured)
     values ($1, '2026-09-02', 'ladder', 0, 4, 3, 0, 7)`,
    [tag],
  );
  const { expected } = await refreshCompleteness(ctx.db, { playerTag: tag, day: '2026-09-02' });
  assert.equal(expected, 10);
  const { rows } = await ctx.db.query(
    `select expected_battle_delta, completeness_ratio, is_complete
     from player_daily_battle_rollup where player_tag = $1`,
    [tag],
  );
  assert.equal(rows[0].expected_battle_delta, 10);
  assert.equal(Number(rows[0].completeness_ratio), 0.7);
  assert.equal(rows[0].is_complete, false);
});

test('roster diffs emit clan events with evidence; first sight was silent', async () => {
  const clan = await fixture('clan/roster.json');
  await processResult(
    ctx.db,
    message({ endpoint: 'clan', entityKey: '#J2RGCRVG', payload: clan, fetchedAt: '2026-09-03T14:40:34Z' }),
  );
  const events = (await ctx.db.query('select count(*)::int n from clan_event')).rows[0].n;
  assert.equal(events, 0, 'first roster observation is silent');

  const changed = structuredClone(clan);
  const departed = changed.memberList.pop();
  const promoted = changed.memberList.find((m) => m.role === 'member');
  promoted.role = 'elder';
  changed.members = changed.memberList.length;
  await processResult(
    ctx.db,
    message({ endpoint: 'clan', entityKey: '#J2RGCRVG', payload: changed, fetchedAt: '2026-09-03T14:55:34Z' }),
  );
  const { rows } = await ctx.db.query(
    `select event_type, timing, window_start, window_end, payload from clan_event order by event_id`,
  );
  assert.deepEqual(rows.map((r) => r.event_type).sort(), ['member_left', 'role_changed']);
  for (const r of rows) {
    assert.equal(r.timing, 'estimated');
    assert.equal(r.window_start.toISOString(), '2026-09-03T14:40:34.000Z', 'window = previous admitted poll');
    assert.equal(r.window_end.toISOString(), '2026-09-03T14:55:34.000Z');
    assert.equal(r.payload.roster_size_before, 49, 'evidence, not conclusions');
  }
  const left = rows.find((r) => r.event_type === 'member_left');
  assert.equal(left.payload.player_tag, departed.tag);
  assert.ok(left.payload.joined_observed_at, 'tenure evidence rides the event');
});

test('pre-reset window pins an extra season_roll snapshot', async () => {
  const profile = structuredClone(await fixture('player/profile.json'));
  const tag = meta['player/profile.json'].entity_key;
  // Sunday 23:30Z: inside the final hour before the Monday 00:10Z reset.
  await processResult(
    ctx.db,
    message({ endpoint: 'player', entityKey: tag, payload: profile, fetchedAt: '2026-09-06T23:30:00Z' }),
  );
  const { rows } = await ctx.db.query(
    `select snapshot_kind from player_snapshot_daily
     where player_tag = $1 and snapshot_date = '2026-09-06' order by snapshot_kind`,
    [tag],
  );
  assert.deepEqual(rows.map((r) => r.snapshot_kind), ['daily', 'season_roll']);
});
