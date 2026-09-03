import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { migrate } from '../../migrate/src/migrate.mjs';
import {
  emailHash,
  startMagicLogin,
  redeemMagicToken,
  verifyMagicCode,
  MAX_CODE_ATTEMPTS,
  createSessionToken,
  verifySessionToken,
  createSession,
  resolveSession,
  revokeSession,
  checkRateLimit,
  requestAccess,
  decideAccess,
  approvedAccount,
  pendingRequests,
} from '../src/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const ADMIN_URL = process.env.PG_ADMIN_URL ?? 'postgres://otto@localhost:5432/postgres';
const NAME = `elixir_mcp_test_auth_${process.pid}`;
const URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);
const SECRET = 'test-session-secret';

let db;
const JAMIE = emailHash('Owner.Test@example.com ');

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.query(`create database ${NAME}`);
  await admin.end();
  await migrate({ databaseUrl: URL, migrationsDir: path.join(repoRoot, 'db/migrations') });
  db = new pg.Client({ connectionString: URL });
  await db.connect();
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

test('email hashing normalizes case and whitespace', () => {
  assert.equal(JAMIE, emailHash('owner-test@example.com'));
});

test('access gate: request -> pending -> approve; duplicates are quiet', async () => {
  const first = await requestAccess(db, { emailHash: JAMIE, playerTag: '#20JJJ2CCRU', note: 'owner' });
  assert.equal(first.created, true);
  const dup = await requestAccess(db, { emailHash: JAMIE });
  assert.equal(dup.created, false, 'repeat request is a quiet no-op');
  assert.equal(await approvedAccount(db, JAMIE), null, 'pending is not approved');
  const pending = await pendingRequests(db);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].requested_player_tag, '#20JJJ2CCRU');
  const decided = await decideAccess(db, { emailHash: JAMIE, decision: 'approved' });
  assert.equal(decided.status, 'approved');
  assert.ok(await approvedAccount(db, JAMIE));
});

test('magic link: single-use, races lose the second redemption', async () => {
  const { token } = await startMagicLogin(db, { emailHash: JAMIE });
  const first = await redeemMagicToken(db, token);
  assert.equal(first.email_hash, JAMIE);
  assert.equal(await redeemMagicToken(db, token), null, 'burned rows stay burned');
});

test('magic code: wrong guesses count, cap locks, right code burns the shared row', async () => {
  const { token, code } = await startMagicLogin(db, { emailHash: JAMIE });
  for (let i = 0; i < 3; i += 1) {
    assert.equal(await verifyMagicCode(db, { emailHash: JAMIE, code: '000000' }), null);
  }
  const ok = await verifyMagicCode(db, { emailHash: JAMIE, code });
  assert.equal(ok.email_hash, JAMIE);
  assert.equal(await redeemMagicToken(db, token), null, 'code burned the same row the link uses');
});

test('magic code: attempt cap is enforced before comparison', async () => {
  const { code } = await startMagicLogin(db, { emailHash: JAMIE });
  for (let i = 0; i < MAX_CODE_ATTEMPTS; i += 1) {
    await verifyMagicCode(db, { emailHash: JAMIE, code: '999999' });
  }
  assert.equal(
    await verifyMagicCode(db, { emailHash: JAMIE, code }),
    null,
    'even the correct code fails once the cap is hit',
  );
});

test('session tokens: sign/verify round-trip, tamper and expiry rejected', () => {
  const { token } = createSessionToken({ secret: SECRET, sub: JAMIE });
  const claims = verifySessionToken({ secret: SECRET, token });
  assert.equal(claims.sub, JAMIE);
  assert.equal(verifySessionToken({ secret: 'wrong', token }), null);
  const [encoded, sig] = token.split('.');
  assert.equal(verifySessionToken({ secret: SECRET, token: `${encoded}x.${sig}` }), null);
  const expired = createSessionToken({ secret: SECRET, sub: JAMIE, now: Date.now() - 10 * 24 * 3600 * 1000 });
  assert.equal(verifySessionToken({ secret: SECRET, token: expired.token }), null);
});

test('session rows: resolve enforces the access gate and revocation', async () => {
  const account = await approvedAccount(db, JAMIE);
  const minted = await createSession(db, { secret: SECRET, accountId: account.account_id, emailHash: JAMIE });
  const resolved = await resolveSession(db, { secret: SECRET, token: minted.token });
  assert.equal(resolved.accountId, account.account_id);
  assert.equal(resolved.isOwner, false);

  await revokeSession(db, minted.sessionId);
  assert.equal(await resolveSession(db, { secret: SECRET, token: minted.token }), null, 'sign-out revokes');

  // Gate: a valid session for a non-approved account resolves to nothing.
  const minted2 = await createSession(db, { secret: SECRET, accountId: account.account_id, emailHash: JAMIE });
  await db.query(`update account set status = 'disabled' where email_hash = $1`, [JAMIE]);
  assert.equal(await resolveSession(db, { secret: SECRET, token: minted2.token }), null, 'gate on every request');
  await db.query(`update account set status = 'approved' where email_hash = $1`, [JAMIE]);
});

test('rate limit: counts within the hourly window', async () => {
  for (let i = 0; i < 3; i += 1) {
    assert.equal(await checkRateLimit(db, { bucket: 'ip#1.2.3.4', max: 3 }), true);
  }
  assert.equal(await checkRateLimit(db, { bucket: 'ip#1.2.3.4', max: 3 }), false);
  assert.equal(await checkRateLimit(db, { bucket: 'ip#5.6.7.8', max: 3 }), true, 'buckets are independent');
});
