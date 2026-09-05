/**
 * Server-side session rows: the revocation and access-gate authority.
 * The HMAC token proves possession; the row decides whether it still
 * means anything (sign-out, 90-day absolute cap, account status).
 */

import {
  createSessionToken,
  verifySessionToken,
  SESSION_TTL_SECONDS,
} from "./session.mjs";

const ABSOLUTE_CAP_DAYS = 90;

export async function createSession(
  db,
  { secret, accountId, emailHash, now = Date.now() },
) {
  const minted = createSessionToken({ secret, sub: emailHash, now });
  await db.query(
    `insert into session (session_id, account_id, sliding_expires_at, absolute_expires_at)
     values ($1, $2, to_timestamp($3), now() + make_interval(days => $4))`,
    [minted.sessionId, accountId, minted.expiresAt, ABSOLUTE_CAP_DAYS],
  );
  return minted;
}

/**
 * Resolve a token to an approved account, enforcing: valid signature,
 * unexpired claims, live unrevoked row, absolute cap, and the ACCESS GATE
 * (§6.1 step 0 — only approved accounts resolve, on every request).
 * Slides the row's expiry as a side effect.
 */
export async function resolveSession(db, { secret, token, now = Date.now() }) {
  const claims = verifySessionToken({ secret, token, now });
  if (!claims?.sid || !claims?.sub) return null;
  const { rows } = await db.query(
    `update session s
     set last_seen_at = now(),
         sliding_expires_at = least(now() + make_interval(secs => $3), s.absolute_expires_at)
     from account a
     where s.session_id = $1
       and s.account_id = a.account_id
       and a.email_hash = $2
       and a.status = 'approved'
       and s.revoked_at is null
       and s.sliding_expires_at > now()
       and s.absolute_expires_at > now()
     returning a.account_id, a.email_hash, a.is_owner, a.timezone, a.role`,
    [claims.sid, claims.sub, SESSION_TTL_SECONDS],
  );
  const row = rows[0] ?? null;
  return row
    ? {
        accountId: row.account_id,
        emailHash: row.email_hash,
        // One entitlements system: the console is a role power.
        isOwner: row.role === "owner",
        isAdmin: row.role === "owner" || row.role === "admin",
        timezone: row.timezone,
        role: row.role,
        sessionId: claims.sid,
      }
    : null;
}

export async function revokeSession(db, sessionId) {
  await db.query(
    `update session set revoked_at = now() where session_id = $1 and revoked_at is null`,
    [sessionId],
  );
}
