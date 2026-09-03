import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { migrate } from '../../migrate/src/migrate.mjs';
import { emailHash } from '../../auth/src/index.mjs';
import { makeHandler } from '../src/handler.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const ADMIN_URL = process.env.PG_ADMIN_URL ?? 'postgres://otto@localhost:5432/postgres';
const NAME = `elixir_mcp_test_webapi_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);
const SECRET = 'web-secret';
const JAMIE = 'jamie-web@example.com';
const NEWCOMER = 'newcomer@example.com';

let db;
let handler;
const sentEmails = [];
const ownerNotes = [];
let liveProfile = null;

function event({ method = 'POST', path: p, body, cookie, contractHeader = true, ip = '8.8.4.4' }) {
  return {
    rawPath: p,
    requestContext: { http: { method, sourceIp: ip } },
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(contractHeader ? { 'x-elixir-client': 'web' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

const parse = (res) => JSON.parse(res.body);

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.query(`create database ${NAME}`);
  await admin.end();
  await migrate({ databaseUrl: DB_URL, migrationsDir: path.join(repoRoot, 'db/migrations') });
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  // Jamie pre-approved as owner (bootstrap seed in real life).
  await db.query(`insert into account (email_hash, status, is_owner) values ($1, 'approved', true)`, [
    emailHash(JAMIE),
  ]);
  handler = makeHandler({
    databaseUrl: DB_URL,
    secret: SECRET,
    sendLoginEmail: async (m) => sentEmails.push(m),
    notifyOwner: async (n) => ownerNotes.push(n),
    liveFetch: async () => (liveProfile ? { ok: true, payload: liveProfile } : { ok: false, reason: 'timeout' }),
  });
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

async function signIn(email) {
  await handler(event({ path: '/api/auth', body: { email } }));
  const { code } = sentEmails.at(-1);
  const res = await handler(event({ path: '/api/auth/code', body: { email, code } }));
  assert.equal(res.statusCode, 200);
  return res.headers['set-cookie'].split(';')[0];
}

// The per-email send limit (5/hour) is a product value the tests respect:
// sign in once per identity and share the cookie across tests.
let newcomerCookie;

test('the full journey: request -> approve -> sign in -> claim -> record', async () => {
  // 1. A newcomer requests access; the owner is notified; response is neutral.
  const req = await handler(
    event({ path: '/api/request-access', body: { email: NEWCOMER, player_tag: '2ppOv90y', note: 'hi' } }),
  );
  assert.equal(req.statusCode, 200);
  assert.match(parse(req).message, /If your request is approved/);
  assert.equal(ownerNotes.length, 1);

  // 2. Before approval: sign-in mails nothing, same neutral answer.
  const preAuth = await handler(event({ path: '/api/auth', body: { email: NEWCOMER } }));
  assert.equal(parse(preAuth).ok, true);
  assert.equal(sentEmails.length, 0, 'pending accounts get no magic link');

  // 3. Owner signs in and approves from the admin queue.
  const ownerCookie = await signIn(JAMIE);
  const list = await handler(
    event({ method: 'GET', path: '/api/admin/requests', cookie: ownerCookie, body: undefined }),
  );
  const pending = parse(list).requests;
  assert.equal(pending.length, 1);
  assert.equal(pending[0].requested_player_tag, '#2PP0V90Y', 'tag normalized at the door');
  const decide = await handler(
    event({ path: '/api/admin/decide', cookie: ownerCookie, body: { email_hash: pending[0].email_hash, decision: 'approved' } }),
  );
  assert.equal(parse(decide).status, 'approved');

  // 4. Newcomer signs in with the emailed code and lands a __Host- cookie.
  const cookie = await signIn(NEWCOMER);
  newcomerCookie = cookie;
  assert.match(cookie, /^__Host-elixir_session=/);

  // 5. Dashboard, claim, recording opt-in.
  const me = await handler(event({ method: 'GET', path: '/api/me', cookie, body: undefined }));
  assert.equal(parse(me).authenticated, true);
  assert.equal(parse(me).is_owner, false);

  const claim = await handler(event({ path: '/api/claims', cookie, body: { player_tag: '#2PP0V90Y' } }));
  assert.equal(parse(claim).ok, true);
  const rec = await handler(
    event({ path: '/api/recordings', cookie, body: { player_tag: '#2PP0V90Y', action: 'start' } }),
  );
  assert.equal(parse(rec).ok, true);

  const me2 = parse(await handler(event({ method: 'GET', path: '/api/me', cookie, body: undefined })));
  assert.equal(me2.claims.length, 1);
  assert.equal(me2.claims[0].is_primary, true, 'first claim becomes primary');
  assert.equal(me2.recordings.length, 1);
  assert.equal(me2.recordings[0].status, 'active');
});

test('recording opt-in requires a claim on the tag', async () => {
  const cookie = newcomerCookie;
  const res = await handler(
    event({ path: '/api/recordings', cookie, body: { player_tag: '#J2RGCRVG', action: 'start' } }),
  );
  assert.equal(res.statusCode, 403);
});

test('cookie-authed state changes require the contract header (CSRF)', async () => {
  const cookie = newcomerCookie;
  const res = await handler(
    event({ path: '/api/me/timezone', cookie, contractHeader: false, body: { timezone: 'America/Chicago' } }),
  );
  assert.equal(res.statusCode, 401);
  const ok = await handler(event({ path: '/api/me/timezone', cookie, body: { timezone: 'America/Chicago' } }));
  assert.equal(parse(ok).timezone, 'America/Chicago');
  const bad = await handler(event({ path: '/api/me/timezone', cookie, body: { timezone: 'Central Time' } }));
  assert.equal(bad.statusCode, 400);
});

test('admin routes refuse non-owners', async () => {
  const cookie = newcomerCookie;
  const res = await handler(event({ method: 'GET', path: '/api/admin/requests', cookie, body: undefined }));
  assert.equal(res.statusCode, 403);
  const gw = await handler(event({ method: 'GET', path: '/api/admin/gateways', cookie, body: undefined }));
  assert.equal(gw.statusCode, 403);
});

test('sign-out revokes: the same cookie stops resolving (last — consumes the shared session)', async () => {
  const cookie = newcomerCookie;
  await handler(event({ path: '/api/session/signout', cookie, body: {} }));
  const me = await handler(event({ method: 'GET', path: '/api/me', cookie, body: undefined }));
  assert.equal(parse(me).authenticated, false);
});

test('request-access is rate limited per IP', async () => {
  let limited = 0;
  for (let i = 0; i < 8; i += 1) {
    const res = await handler(
      event({ path: '/api/request-access', ip: '3.3.3.3', body: { email: `x${i}@example.com` } }),
    );
    if (res.statusCode === 429) limited += 1;
  }
  assert.ok(limited > 0);
});

test('owner enrolls and stops clan recordings; non-owners refused', async () => {
  const ownerCookie = await signIn(JAMIE);
  const start = await handler(
    event({ path: '/api/admin/clans', cookie: ownerCookie, body: { clan_tag: 'gq0ylcyj', action: 'start' } }),
  );
  assert.equal(parse(start).clan_tag, '#GQ0YLCYJ', 'normalized at the door');
  const list = parse(await handler(event({ method: 'GET', path: '/api/admin/clans', cookie: ownerCookie, body: undefined })));
  const row = list.clans.find((c) => c.clan_tag === '#GQ0YLCYJ');
  assert.equal(row.status, 'active');
  const dupe = await handler(
    event({ path: '/api/admin/clans', cookie: ownerCookie, body: { clan_tag: '#GQ0YLCYJ', action: 'start' } }),
  );
  assert.equal(dupe.statusCode, 200, 'idempotent');
  await handler(event({ path: '/api/admin/clans', cookie: ownerCookie, body: { clan_tag: '#GQ0YLCYJ', action: 'stop' } }));
  const after = parse(await handler(event({ method: 'GET', path: '/api/admin/clans', cookie: ownerCookie, body: undefined })));
  assert.ok(after.clans.some((c) => c.clan_tag === '#GQ0YLCYJ' && c.status === 'stopped'));

  const nonOwner = await handler(
    event({ path: '/api/admin/clans', cookie: newcomerCookie, body: { clan_tag: '#J2RGCRVG', action: 'start' } }),
  );
  assert.equal(nonOwner.statusCode, 403);
});

test('liveness verification: challenge -> wrong favourite -> right favourite -> verified', async () => {
  // Seed the card catalog the picker draws from.
  await db.query(
    `insert into api_payload (endpoint, entity_key, payload_hash, payload_json)
     values ('cards', 'GLOBAL', 'vh', '{"items": [{"id": 26000055, "name": "Mega Knight"}]}')
     on conflict do nothing`,
  );
  // The newcomer's claim from the journey test (#2PP0V90Y) is unverified.
  const cookie = await signIn(NEWCOMER);
  const start = await handler(
    event({ path: '/api/claims/verify', cookie, body: { player_tag: '#2PP0V90Y' } }),
  );
  assert.equal(start.statusCode, 200, start.body);
  const ch = parse(start);
  assert.equal(ch.card_name, 'Mega Knight');
  assert.match(ch.instructions, /favourite card/);

  // Wrong favourite: stays pending with an honest message.
  liveProfile = { tag: '#2PP0V90Y', currentFavouriteCard: { id: 1, name: 'Knight' } };
  const wrong = parse(await handler(event({ path: '/api/claims/verify/check', cookie, body: { player_tag: '#2PP0V90Y' } })));
  assert.equal(wrong.verified, false);
  assert.match(wrong.message, /Knight/);

  // Right favourite: claim flips to verified.
  liveProfile = { tag: '#2PP0V90Y', currentFavouriteCard: { id: 26000055, name: 'Mega Knight' } };
  const right = parse(await handler(event({ path: '/api/claims/verify/check', cookie, body: { player_tag: '#2PP0V90Y' } })));
  assert.equal(right.verified, true);
  const { rows } = await db.query(`select status, verified_method from claim where player_tag = '#2PP0V90Y'`);
  assert.equal(rows[0].status, 'verified');
  assert.equal(rows[0].verified_method, 'favourite_card');

  // Already verified short-circuits.
  const again = parse(await handler(event({ path: '/api/claims/verify', cookie, body: { player_tag: '#2PP0V90Y' } })));
  assert.equal(again.already_verified, true);
});
