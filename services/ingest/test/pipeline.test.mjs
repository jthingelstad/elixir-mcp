import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { processResult } from '../src/pipeline.mjs';
import { fixture, fixtureMeta, scratchDb } from './helpers.mjs';

let ctx;
let gatewayId;
let meta;

function message({ endpoint, entityKey, payload, fetchedAt, status = 'ok', lane = 'bulk' }) {
  const m = {
    v: 1,
    job: { endpoint, entity_key: entityKey, lane },
    gateway_id: gatewayId,
    fetched_at: fetchedAt,
    status,
  };
  if (status === 'ok') {
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    m.body_gzip_b64 = gzipSync(Buffer.from(body)).toString('base64');
  }
  return m;
}

before(async () => {
  ctx = await scratchDb('pipeline');
  const {
    rows: [account],
  } = await ctx.db.query(
    `insert into account (email_hash, status, is_owner) values ('pipeline-owner', 'approved', true)
     returning account_id`,
  );
  const {
    rows: [gw],
  } = await ctx.db.query(
    `insert into gateway (owner_account_id, name, static_ip, status)
     values ($1, 'pipeline-gw', '127.0.0.1', 'active') returning gateway_id`,
    [account.account_id],
  );
  gatewayId = gw.gateway_id;
  meta = await fixtureMeta();
});

after(async () => ctx.drop());

test('battlelog message flows end to end: payload, receipt, battles, freshness, heat', async () => {
  const file = 'player_battlelog/with_boat_and_duel.json';
  const observer = meta[file].entity_key;
  const payload = await fixture(file);
  await ctx.db.query(
    `insert into poll_state (subject_tag, endpoint, heat) values ($1, 'player_battlelog', 0)`,
    [observer],
  );

  const result = await processResult(
    ctx.db,
    message({
      endpoint: 'player_battlelog',
      entityKey: observer,
      payload,
      fetchedAt: '2026-09-02T08:00:49Z',
    }),
  );
  assert.equal(result.outcome, 'admitted');
  assert.equal(result.projection.battlesSeen, payload.length);

  const payloads = (await ctx.db.query(`select count(*)::int n from api_payload`)).rows[0].n;
  assert.equal(payloads, 1, 'content-addressed payload stored once');
  const { rows: receipts } = await ctx.db.query(
    `select admission from api_receipt where endpoint = 'player_battlelog'`,
  );
  assert.deepEqual(receipts, [{ admission: 'admitted' }]);
  const battles = (await ctx.db.query(`select count(*)::int n from battle`)).rows[0].n;
  assert.ok(battles > 0);

  const { rows: ps } = await ctx.db.query(
    `select heat, last_admitted_at from poll_state where subject_tag = $1 and endpoint = 'player_battlelog'`,
    [observer],
  );
  assert.equal(ps[0].heat, 3, 'new battles re-heat the subject');
  assert.equal(ps[0].last_admitted_at.toISOString(), '2026-09-02T08:00:49.000Z');
});

test('SQS redelivery is a duplicate: no second receipt, no double ingest', async () => {
  const file = 'player_battlelog/with_boat_and_duel.json';
  const payload = await fixture(file);
  const result = await processResult(
    ctx.db,
    message({
      endpoint: 'player_battlelog',
      entityKey: meta[file].entity_key,
      payload,
      fetchedAt: '2026-09-02T08:00:49Z',
    }),
  );
  assert.equal(result.outcome, 'duplicate');
  const receipts = (await ctx.db.query(`select count(*)::int n from api_receipt`)).rows[0].n;
  assert.equal(receipts, 1);
});

test('rejected payload gets a receipt with errors; no projection; freshness NOT advanced', async () => {
  const clan = structuredClone(await fixture('clan/roster.json'));
  clan.members += 1; // corrupt: count mismatch
  const result = await processResult(
    ctx.db,
    message({
      endpoint: 'clan',
      entityKey: '#J2RGCRVG',
      payload: clan,
      fetchedAt: '2026-09-03T15:00:00Z',
    }),
  );
  assert.equal(result.outcome, 'rejected');
  assert.ok(result.errors.includes('members:count-mismatch'));
  const { rows } = await ctx.db.query(
    `select admission, admission_errors from api_receipt where endpoint = 'clan'`,
  );
  assert.equal(rows[0].admission, 'rejected');
  assert.ok(rows[0].admission_errors.length > 0);
  const memberships = (await ctx.db.query(`select count(*)::int n from clan_membership`)).rows[0].n;
  assert.equal(memberships, 0, 'rejected payload mutated nothing');
  const ps = await ctx.db.query(
    `select 1 from poll_state where subject_tag = '#J2RGCRVG' and endpoint = 'clan'`,
  );
  assert.equal(ps.rows.length, 0, 'freshness advances on admission only');
});

test('valid clan payload projects roster and advances freshness', async () => {
  const clan = await fixture('clan/roster.json');
  const result = await processResult(
    ctx.db,
    message({
      endpoint: 'clan',
      entityKey: '#J2RGCRVG',
      payload: clan,
      fetchedAt: '2026-09-03T15:10:00Z',
    }),
  );
  assert.equal(result.outcome, 'admitted');
  assert.equal(result.projection.members, 49);
  const ps = await ctx.db.query(
    `select 1 from poll_state where subject_tag = '#J2RGCRVG' and endpoint = 'clan'`,
  );
  assert.equal(ps.rows.length, 1);
});

test('unparseable body: rejected receipt, no payload row', async () => {
  const before = (await ctx.db.query(`select count(*)::int n from api_payload`)).rows[0].n;
  const result = await processResult(
    ctx.db,
    message({
      endpoint: 'player',
      entityKey: '#20JJJ2CCRU',
      payload: 'not json {{{',
      fetchedAt: '2026-09-03T15:20:00Z',
    }),
  );
  assert.equal(result.outcome, 'rejected');
  assert.ok(result.errors.includes('body:unparseable'));
  const after = (await ctx.db.query(`select count(*)::int n from api_payload`)).rows[0].n;
  assert.equal(after, before, 'no payload row for unparseable bodies');
});

test('fetch_error writes nothing durable', async () => {
  const receiptsBefore = (await ctx.db.query(`select count(*)::int n from api_receipt`)).rows[0].n;
  const result = await processResult(ctx.db, {
    v: 1,
    job: { endpoint: 'player', entity_key: '#20JJJ2CCRU', lane: 'bulk' },
    gateway_id: gatewayId,
    fetched_at: '2026-09-03T15:30:00Z',
    status: 'error',
    error: { kind: 'transport' },
  });
  assert.equal(result.outcome, 'fetch_error');
  const receiptsAfter = (await ctx.db.query(`select count(*)::int n from api_receipt`)).rows[0].n;
  assert.equal(receiptsAfter, receiptsBefore);
});

test('malformed message is bad_message (handler routes it to the DLQ path)', async () => {
  const result = await processResult(ctx.db, { v: 1, status: 'ok' });
  assert.equal(result.outcome, 'bad_message');
  assert.ok(result.errors.length > 0);
});

test('player profile message projects the v0 identity refresh', async () => {
  const profile = await fixture('player/profile.json');
  const result = await processResult(
    ctx.db,
    message({
      endpoint: 'player',
      entityKey: meta['player/profile.json'].entity_key,
      payload: profile,
      fetchedAt: '2026-09-03T15:40:00Z',
    }),
  );
  assert.equal(result.outcome, 'admitted');
  const { rows } = await ctx.db.query(`select name from player where player_tag = $1`, [
    meta['player/profile.json'].entity_key,
  ]);
  assert.equal(rows[0].name, profile.name);
});
