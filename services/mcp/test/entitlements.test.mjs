import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { migrate } from '../../migrate/src/migrate.mjs';
import { resolveSubject, requireLeadership, resolveEntitledClan } from '../src/entitlements.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const ADMIN_URL = process.env.PG_ADMIN_URL ?? 'postgres://otto@localhost:5432/postgres';
const NAME = `elixir_mcp_test_ent_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);
const CLAN = '#J2RGCRVG';

let db;
const accounts = {};

async function mkAccount(key, { owner = false } = {}) {
  const { rows } = await db.query(
    `insert into account (email_hash, status, is_owner) values ($1, 'approved', $2)
     returning account_id, is_owner`,
    [`ent-${key}`, owner],
  );
  accounts[key] = { accountId: rows[0].account_id, isOwner: rows[0].is_owner };
  return accounts[key];
}

async function mkMember(key, tag, { role = 'member', primary = true } = {}) {
  await db.query(`insert into player (player_tag) values ($1) on conflict do nothing`, [tag]);
  await db.query(
    `insert into claim (account_id, player_tag, status, is_primary) values ($1, $2, 'unverified', $3)`,
    [accounts[key].accountId, tag, primary],
  );
  await db.query(
    `insert into clan_membership (clan_tag, player_tag, joined_observed_at, role)
     values ($1, $2, now(), $3)`,
    [CLAN, tag, role],
  );
}

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.query(`create database ${NAME}`);
  await admin.end();
  await migrate({ databaseUrl: DB_URL, migrationsDir: path.join(repoRoot, 'db/migrations') });
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  await db.query(`insert into clan (clan_tag) values ($1)`, [CLAN]);
  const owner = await mkAccount('owner', { owner: true });
  await mkAccount('alice');
  await mkAccount('bob');
  await mkAccount('carol');
  await db.query(
    `insert into recording (subject_type, subject_tag, requested_by) values ('clan', $1, $2)`,
    [CLAN, owner.accountId],
  );
  await mkMember('alice', '#YYYYYYYY', { role: 'member' });
  await mkMember('bob', '#RRRRRRRR', { role: 'elder' });
  // carol: approved account, claims a tag OUTSIDE the clan
  await db.query(`insert into player (player_tag) values ('#22222222')`);
  await db.query(
    `insert into claim (account_id, player_tag, status, is_primary) values ($1, '#22222222', 'unverified', true)`,
    [accounts.carol.accountId],
  );
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

test('rule 1: own claim is full scope', async () => {
  const s = await resolveSubject(db, accounts.alice, '#YYYYYYYY', 'full');
  assert.deepEqual(s, { tag: '#YYYYYYYY', scope: 'own', battles: 'all' });
});

test('rule 2: fellow member gets summary; battle-level is war-only without consent', async () => {
  const s = await resolveSubject(db, accounts.alice, '#RRRRRRRR', 'summary');
  assert.deepEqual(s, { tag: '#RRRRRRRR', scope: 'clanmate', battles: 'war_only' });
  await assert.rejects(
    () => resolveSubject(db, accounts.alice, '#RRRRRRRR', 'full'),
    (e) => e.code === 'not_entitled',
  );
  // Bob consents: battle-level opens.
  await db.query(`update claim set share_battles_with_clan = true where player_tag = '#RRRRRRRR'`);
  const s2 = await resolveSubject(db, accounts.alice, '#RRRRRRRR', 'battles');
  assert.equal(s2.battles, 'all');
});

test('non-members stay out; unclaimed clanmates are summary-readable, war-only battles', async () => {
  await assert.rejects(
    () => resolveSubject(db, accounts.carol, '#YYYYYYYY', 'summary'),
    (e) => e.code === 'not_entitled',
  );
  // An unclaimed member (no account) is still a clanmate to alice.
  await db.query(`insert into player (player_tag) values ('#2C0PY22')`);
  await db.query(
    `insert into clan_membership (clan_tag, player_tag, joined_observed_at, role) values ($1, '#2C0PY22', now(), 'member')`,
    [CLAN],
  );
  const s = await resolveSubject(db, accounts.alice, '#2C0PY22', 'summary');
  assert.deepEqual(s, { tag: '#2C0PY22', scope: 'clanmate', battles: 'war_only' });
});

test('rule 4: leadership needs elder+; member refused, elder passes, owner passes', async () => {
  await assert.rejects(() => requireLeadership(db, accounts.alice, CLAN), (e) => e.code === 'not_entitled');
  assert.equal(await requireLeadership(db, accounts.bob, CLAN), 'elder');
  assert.equal(await requireLeadership(db, accounts.owner, CLAN), 'leader');
});

test('owner administers recorded clans without membership; default clan resolves', async () => {
  const s = await resolveSubject(db, accounts.owner, '#YYYYYYYY', 'summary');
  assert.equal(s.scope, 'clanmate');
  assert.equal(s.battles, 'war_only', 'consent applies to the owner too');
  assert.equal(await resolveEntitledClan(db, accounts.alice), CLAN);
  assert.equal(await resolveEntitledClan(db, accounts.owner), CLAN);
  await assert.rejects(() => resolveEntitledClan(db, accounts.carol), (e) => e.code === 'not_entitled');
});
