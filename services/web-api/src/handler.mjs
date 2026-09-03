/**
 * Site API — DESIGN §6.1. One credential core, this is the web shell.
 *
 * Auth resolution: Bearer wins (dev/tools), else the __Host- cookie —
 * and cookie-authed state changes require the X-Elixir-Client header
 * (CSRF: SameSite=Lax + custom-header contract, librarian's pattern; the
 * CloudFront distribution for the site is the only origin that forwards
 * it). The access-gate answers identically for unknown/pending/denied
 * emails everywhere — never an oracle.
 */

import pg from 'pg';
import {
  emailHash,
  requestAccess,
  decideAccess,
  approvedAccount,
  pendingRequests,
  startMagicLogin,
  redeemMagicToken,
  verifyMagicCode,
  createSession,
  resolveSession,
  revokeSession,
  checkRateLimit,
} from '@elixir-mcp/auth';
import { normalizeTag, InvalidTagError } from '@elixir-mcp/contracts';

const COOKIE_NAME = '__Host-elixir_session';
const CONTRACT_HEADER = 'x-elixir-client';

const json = (statusCode, body, headers = {}) => ({
  statusCode,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  body: JSON.stringify(body),
});

function sessionCookie(token, maxAgeSeconds) {
  return `${COOKIE_NAME}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

function readCookie(event) {
  const cookies = event.cookies ?? String(event.headers?.cookie ?? '').split('; ');
  for (const c of cookies) {
    if (c.startsWith(`${COOKIE_NAME}=`)) return c.slice(COOKIE_NAME.length + 1);
  }
  return '';
}

function bearer(event) {
  const auth = String(event.headers?.authorization ?? '');
  return auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
}

export function makeHandler({ databaseUrl, secret, sendLoginEmail, notifyOwner = async () => {} }) {
  async function resolveAccount(db, event, { requireContractHeader = false } = {}) {
    const fromBearer = bearer(event);
    const token = fromBearer || readCookie(event);
    if (!token) return null;
    if (!fromBearer && requireContractHeader && !event.headers?.[CONTRACT_HEADER]) return null;
    return resolveSession(db, { secret, token });
  }

  async function mintSessionResponse(db, hash) {
    const account = await approvedAccount(db, hash);
    if (!account) return json(400, { error: 'invalid_or_expired' });
    const minted = await createSession(db, { secret, accountId: account.account_id, emailHash: hash });
    return json(
      200,
      { authenticated: true },
      { 'set-cookie': sessionCookie(minted.token, 9 * 24 * 3600) },
    );
  }

  const routes = {
    'POST /api/request-access': async (db, event, body) => {
      const ip = event.requestContext?.http?.sourceIp ?? 'unknown';
      if (!(await checkRateLimit(db, { bucket: `reqaccess#${ip}`, max: 5 }))) {
        return json(429, { error: 'rate_limited' });
      }
      const email = String(body.email ?? '').trim();
      if (!email.includes('@')) return json(400, { error: 'bad_request' });
      let playerTag = null;
      try {
        playerTag = body.player_tag ? normalizeTag(String(body.player_tag)) : null;
      } catch {
        return json(400, { error: 'invalid_tag' });
      }
      const result = await requestAccess(db, {
        emailHash: emailHash(email),
        playerTag,
        note: String(body.note ?? '').slice(0, 500) || null,
      });
      if (result.created) await notifyOwner({ kind: 'access_request', playerTag });
      // Identical response for new, repeat, denied, and already-approved.
      return json(200, { ok: true, message: 'If your request is approved, you will hear from us by email.' });
    },

    'POST /api/auth': async (db, event, body) => {
      const ip = event.requestContext?.http?.sourceIp ?? 'unknown';
      const email = String(body.email ?? '').trim();
      const okIp = await checkRateLimit(db, { bucket: `auth#${ip}`, max: 10 });
      const okEmail = await checkRateLimit(db, { bucket: `auth#${emailHash(email)}`, max: 5 });
      if (okIp && okEmail && email.includes('@')) {
        const account = await approvedAccount(db, emailHash(email));
        if (account) {
          const { token, code } = await startMagicLogin(db, { emailHash: emailHash(email), purpose: 'web' });
          await sendLoginEmail({ email, code, token, purpose: 'web' });
        }
      }
      return json(200, { ok: true, message: 'If your account is approved, a sign-in email is on its way.' });
    },

    'POST /api/auth/redeem': async (db, _event, body) => {
      const row = await redeemMagicToken(db, body.token);
      if (!row || row.purpose !== 'web') return json(400, { error: 'invalid_or_expired' });
      return mintSessionResponse(db, row.email_hash);
    },

    'POST /api/auth/code': async (db, _event, body) => {
      const hash = emailHash(String(body.email ?? ''));
      const row = await verifyMagicCode(db, { emailHash: hash, code: body.code });
      if (!row || row.purpose !== 'web') return json(400, { error: 'invalid_or_expired' });
      return mintSessionResponse(db, hash);
    },

    'GET /api/me': async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(200, { authenticated: false });
      const [claims, recordings] = await Promise.all([
        db.query(
          `select c.player_tag, c.status, c.is_primary, p.name, p.last_known_clan_tag
           from claim c join player p on p.player_tag = c.player_tag
           where c.account_id = $1 order by c.is_primary desc, c.player_tag`,
          [account.accountId],
        ),
        db.query(
          `select r.subject_tag, r.status, r.created_at,
                  (select max(last_admitted_at) from poll_state ps where ps.subject_tag = r.subject_tag) as freshest_poll
           from recording r where r.requested_by = $1 and r.subject_type = 'player'`,
          [account.accountId],
        ),
      ]);
      return json(200, {
        authenticated: true,
        is_owner: account.isOwner,
        timezone: account.timezone,
        claims: claims.rows,
        recordings: recordings.rows,
      });
    },

    'POST /api/session/signout': async (db, event) => {
      const account = await resolveAccount(db, event, { requireContractHeader: true });
      if (account) await revokeSession(db, account.sessionId);
      return json(200, { ok: true }, { 'set-cookie': sessionCookie('', 0) });
    },

    'POST /api/me/timezone': async (db, event, body) => {
      const account = await resolveAccount(db, event, { requireContractHeader: true });
      if (!account) return json(401, { error: 'unauthenticated' });
      const tz = String(body.timezone ?? '');
      try {
        Intl.DateTimeFormat('en-US', { timeZone: tz });
      } catch {
        return json(400, { error: 'bad_request', message: 'Not an IANA timezone.' });
      }
      await db.query(`update account set timezone = $2 where account_id = $1`, [account.accountId, tz]);
      return json(200, { ok: true, timezone: tz });
    },

    'POST /api/claims': async (db, event, body) => {
      const account = await resolveAccount(db, event, { requireContractHeader: true });
      if (!account) return json(401, { error: 'unauthenticated' });
      let tag;
      try {
        tag = normalizeTag(String(body.player_tag ?? ''));
      } catch (err) {
        if (err instanceof InvalidTagError) return json(400, { error: 'invalid_tag' });
        throw err;
      }
      await db.query(`insert into player (player_tag) values ($1) on conflict do nothing`, [tag]);
      const { rows: existing } = await db.query(
        `select count(*)::int as n from claim where account_id = $1`,
        [account.accountId],
      );
      await db.query(
        `insert into claim (account_id, player_tag, status, is_primary)
         values ($1, $2, 'unverified', $3) on conflict (account_id, player_tag) do nothing`,
        [account.accountId, tag, existing[0].n === 0 || body.make_primary === true],
      );
      if (body.make_primary === true) {
        await db.query(`update claim set is_primary = (player_tag = $2) where account_id = $1`, [
          account.accountId,
          tag,
        ]);
      }
      return json(200, { ok: true, player_tag: tag });
    },

    'POST /api/recordings': async (db, event, body) => {
      const account = await resolveAccount(db, event, { requireContractHeader: true });
      if (!account) return json(401, { error: 'unauthenticated' });
      let tag;
      try {
        tag = normalizeTag(String(body.player_tag ?? ''));
      } catch {
        return json(400, { error: 'invalid_tag' });
      }
      const { rows: claim } = await db.query(
        `select 1 from claim where account_id = $1 and player_tag = $2`,
        [account.accountId, tag],
      );
      if (!claim[0]) return json(403, { error: 'not_entitled' });
      if (body.action === 'start') {
        await db.query(
          `insert into recording (subject_type, subject_tag, requested_by)
           select 'player', $1, $2
           where not exists (select 1 from recording where subject_type = 'player' and subject_tag = $1 and status = 'active')`,
          [tag, account.accountId],
        );
      } else if (body.action === 'stop') {
        await db.query(
          `update recording set status = 'stopped'
           where subject_type = 'player' and subject_tag = $1 and status = 'active'`,
          [tag],
        );
      } else {
        return json(400, { error: 'bad_request' });
      }
      return json(200, { ok: true });
    },

    'GET /api/admin/requests': async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account?.isOwner) return json(403, { error: 'not_entitled' });
      return json(200, { requests: await pendingRequests(db) });
    },

    'POST /api/admin/decide': async (db, event, body) => {
      const account = await resolveAccount(db, event, { requireContractHeader: true });
      if (!account?.isOwner) return json(403, { error: 'not_entitled' });
      const decided = await decideAccess(db, {
        emailHash: String(body.email_hash ?? ''),
        decision: String(body.decision ?? ''),
      });
      if (!decided) return json(404, { error: 'not_found' });
      if (decided.status === 'approved') await notifyOwner({ kind: 'approved_welcome', emailHash: body.email_hash });
      return json(200, { ok: true, status: decided.status });
    },

    'GET /api/admin/clans': async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account?.isOwner) return json(403, { error: 'not_entitled' });
      const { rows } = await db.query(
        `select r.subject_tag as clan_tag, r.status, r.created_at, cl.name,
                (select count(*)::int from clan_membership cm
                 where cm.clan_tag = r.subject_tag and cm.left_observed_at is null) as open_members,
                (select max(ps.last_admitted_at) from poll_state ps
                 where ps.subject_tag = r.subject_tag and ps.endpoint = 'clan') as last_roster_poll
         from recording r
         left join clan cl on cl.clan_tag = r.subject_tag
         where r.subject_type = 'clan'
         order by r.created_at`,
      );
      return json(200, { clans: rows });
    },

    'POST /api/admin/clans': async (db, event, body) => {
      const account = await resolveAccount(db, event, { requireContractHeader: true });
      if (!account?.isOwner) return json(403, { error: 'not_entitled' });
      let tag;
      try {
        tag = normalizeTag(String(body.clan_tag ?? ''));
      } catch {
        return json(400, { error: 'invalid_tag' });
      }
      if (body.action === 'start') {
        await db.query(`insert into clan (clan_tag) values ($1) on conflict do nothing`, [tag]);
        await db.query(
          `insert into recording (subject_type, subject_tag, requested_by)
           select 'clan', $1, $2
           where not exists (select 1 from recording
                             where subject_type = 'clan' and subject_tag = $1 and status = 'active')`,
          [tag, account.accountId],
        );
      } else if (body.action === 'stop') {
        await db.query(
          `update recording set status = 'stopped'
           where subject_type = 'clan' and subject_tag = $1 and status = 'active'`,
          [tag],
        );
      } else {
        return json(400, { error: 'bad_request' });
      }
      return json(200, { ok: true, clan_tag: tag });
    },

    'GET /api/admin/gateways': async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account?.isOwner) return json(403, { error: 'not_entitled' });
      const { rows } = await db.query(
        `select gateway_id, name, status, static_ip, key_source, enrolled_at, last_heartbeat_at, last_success_at,
                (select count(*)::int from api_receipt r where r.gateway_id = g.gateway_id
                 and r.fetched_at > now() - interval '1 hour') as fetches_last_hour
         from gateway g order by enrolled_at`,
      );
      return json(200, { gateways: rows });
    },
  };

  return async function handler(event) {
    const method = event.requestContext?.http?.method ?? event.httpMethod ?? 'GET';
    const path = event.rawPath ?? event.path ?? '/';
    const route = routes[`${method} ${path}`];
    if (!route) return json(404, { error: 'not_found' });
    let body = {};
    if (event.body) {
      try {
        // API Gateway v2 may deliver bodies base64-encoded.
        body = JSON.parse(
          event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body,
        );
      } catch {
        return json(400, { error: 'invalid_json' });
      }
    }
    const db = new pg.Client({ connectionString: databaseUrl });
    await db.connect();
    try {
      return await route(db, event, body);
    } finally {
      await db.end();
    }
  };
}
