import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { migrate } from '../../migrate/src/migrate.mjs';
import { planTick, CADENCE } from '../src/plan.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const ADMIN_URL = process.env.PG_ADMIN_URL ?? 'postgres://otto@localhost:5432/postgres';
const NAME = `elixir_mcp_test_sched_${process.pid}`;
const URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);

const NOW = new Date('2026-09-03T12:00:00Z');
const min = (n) => new Date(NOW.getTime() - n * 60_000);

let db;
let accountId;

async function addPlayer(tag, { clan = null } = {}) {
  await db.query(
    `insert into player (player_tag, last_known_clan_tag) values ($1, $2)
     on conflict (player_tag) do update set last_known_clan_tag = excluded.last_known_clan_tag`,
    [tag, clan],
  );
  if (clan) await db.query(`insert into clan (clan_tag) values ($1) on conflict do nothing`, [clan]);
  await db.query(
    `insert into recording (subject_type, subject_tag, requested_by) values ('player', $1, $2)`,
    [tag, accountId],
  );
}

async function setState(tag, endpoint, { heat, admitted, planned, heatUpdated } = {}) {
  await db.query(
    `insert into poll_state (subject_tag, endpoint, heat, last_admitted_at, last_planned_at, heat_updated_at)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (subject_tag, endpoint) do update set
       heat = excluded.heat, last_admitted_at = excluded.last_admitted_at,
       last_planned_at = excluded.last_planned_at, heat_updated_at = excluded.heat_updated_at`,
    [tag, endpoint, heat ?? 2, admitted ?? null, planned ?? null, heatUpdated ?? NOW],
  );
}

async function setTokens(tokens) {
  await db.query('update budget_state set tokens = $1, settled_at = $2', [tokens, NOW]);
}

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.query(`create database ${NAME}`);
  await admin.end();
  await migrate({ databaseUrl: URL, migrationsDir: path.join(repoRoot, 'db/migrations') });
  db = new pg.Client({ connectionString: URL });
  await db.connect();
  const {
    rows: [a],
  } = await db.query(
    `insert into account (email_hash, status) values ('sched-owner', 'approved') returning account_id`,
  );
  accountId = a.account_id;
});

beforeEach(async () => {
  await db.query('delete from poll_state');
  await db.query('delete from recording');
  await db.query(`update budget_state set tokens = 0, settled_at = $1`, [NOW]);
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

test('new subject seeds warm and gets both player endpoints plus the followed clan', async () => {
  await addPlayer('#20JJJ2CCRU', { clan: '#J2RGCRVG' });
  await setTokens(100);
  const { jobs } = await planTick(db, NOW);
  const keys = jobs.map((j) => `${j.endpoint}:${j.entity_key}`).sort();
  assert.deepEqual(keys, [
    'clan:#J2RGCRVG',
    'player:#20JJJ2CCRU',
    'player_battlelog:#20JJJ2CCRU',
  ]);
  assert.ok(jobs.every((j) => j.lane === 'bulk'));
  const { rows } = await db.query(`select heat from poll_state where subject_tag = '#20JJJ2CCRU'`);
  assert.ok(rows.every((r) => r.heat === 2), 'seeded warm');
});

test('budget caps selection and starved subjects strictly dominate hot ones', async () => {
  await addPlayer('#YYYYYYYY');
  await addPlayer('#RRRRRRRR');
  // Hot and merely due:
  await setState('#YYYYYYYY', 'player_battlelog', { heat: 3, admitted: min(20), planned: min(20) });
  // Cold and starved past the 24h floor:
  await setState('#RRRRRRRR', 'player_battlelog', {
    heat: 0,
    admitted: min(CADENCE.player_battlelog.floor + 60),
    planned: min(CADENCE.player_battlelog.floor + 60),
  });
  // Make profiles ineligible so the comparison is clean:
  await setState('#YYYYYYYY', 'player', { heat: 2, admitted: min(1), planned: min(1) });
  await setState('#RRRRRRRR', 'player', { heat: 2, admitted: min(1), planned: min(1) });

  await setTokens(1);
  const { jobs } = await planTick(db, NOW);
  assert.equal(jobs.length, 0, 'live reserve holds back the last token');

  await setTokens(2); // floor(2 * 0.9) = 1 job
  const { jobs: jobs2 } = await planTick(db, NOW);
  assert.equal(jobs2.length, 1);
  assert.equal(jobs2[0].entity_key, '#RRRRRRRR', 'starvation floor beats heat');
});

test('heat decays one tier per epoch, before planning', async () => {
  await addPlayer('#YYYYYYYY');
  await setState('#YYYYYYYY', 'player_battlelog', {
    heat: 3,
    admitted: min(20),
    planned: min(20),
    heatUpdated: min(90),
  });
  await setState('#YYYYYYYY', 'player', { heat: 2, admitted: min(1), planned: min(1) });
  await setTokens(100);
  // heat 3 -> 2 (warm, cadence 60m); 20m since reference -> NOT due.
  const { jobs } = await planTick(db, NOW);
  assert.equal(jobs.filter((j) => j.endpoint === 'player_battlelog').length, 0);
  const { rows } = await db.query(
    `select heat from poll_state where subject_tag = '#YYYYYYYY' and endpoint = 'player_battlelog'`,
  );
  assert.equal(rows[0].heat, 2);
});

test('tokens are consumed and an immediate second tick has no budget', async () => {
  await addPlayer('#YYYYYYYY');
  await setTokens(3); // floor(3*0.9) = 2 jobs
  const first = await planTick(db, NOW);
  assert.equal(first.jobs.length, 2);
  const second = await planTick(db, NOW);
  assert.equal(second.jobs.length, 0, 'bucket exhausted; accrual needs elapsed time');
});

test('a planned job is not re-enqueued while in flight', async () => {
  await addPlayer('#YYYYYYYY');
  await setTokens(100);
  const first = await planTick(db, NOW);
  assert.ok(first.jobs.length > 0);
  await setTokens(100);
  const second = await planTick(db, new Date(NOW.getTime() + 60_000));
  assert.equal(second.jobs.length, 0, 'last_planned_at suppresses replanning');
});

test('clan heartbeat respects its 15-minute cadence', async () => {
  await addPlayer('#20JJJ2CCRU', { clan: '#J2RGCRVG' });
  await setState('#20JJJ2CCRU', 'player_battlelog', { heat: 2, admitted: min(1), planned: min(1) });
  await setState('#20JJJ2CCRU', 'player', { heat: 2, admitted: min(1), planned: min(1) });
  await setState('#J2RGCRVG', 'clan', { heat: 2, admitted: min(10), planned: min(10) });
  await setTokens(100);
  const { jobs } = await planTick(db, NOW);
  assert.equal(jobs.length, 0, '10 minutes since clan poll: not yet due');

  await setState('#J2RGCRVG', 'clan', { heat: 2, admitted: min(16), planned: min(16) });
  const { jobs: jobs2 } = await planTick(db, NOW);
  assert.deepEqual(jobs2.map((j) => `${j.endpoint}:${j.entity_key}`), ['clan:#J2RGCRVG']);
});

test('budget accrues with elapsed time and caps at the carryover ceiling', async () => {
  await db.query(`update budget_state set tokens = 0, settled_at = $1, rate_per_sec = 1`, [
    min(60),
  ]);
  const result = await planTick(db, NOW);
  assert.equal(result.tokens, 300, '1 rps for an hour caps at 300 (5-minute carryover), never 3600');
});
