/**
 * Compact HMAC session tokens (librarian's session.mts logic, secret
 * injected — no env reads here). Tokens verify statelessly; the DB
 * session row (sessions-store.mjs) is the revocation authority.
 *
 * Signing canonicalizes by sorting top-level ENTRIES, not via a stringify
 * replacer array — a replacer array also filters keys of nested objects
 * and would silently drop a future nested claim from the signed bytes
 * (librarian's shipped lesson, kept verbatim).
 */

import crypto from 'node:crypto';

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 9; // sliding ~9 days

function b64url(value) {
  return Buffer.from(value).toString('base64url');
}

function b64urlDecode(value) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  return Buffer.from(value + padding, 'base64url');
}

export function signPayload(secret, payload) {
  const canonical = Object.fromEntries(
    Object.entries(payload).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  const encoded = b64url(JSON.stringify(canonical));
  const signature = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

export function createSessionToken({ secret, sub, sessionId, now = Date.now() }) {
  const sid = sessionId ?? crypto.randomBytes(18).toString('base64url');
  const iat = Math.floor(now / 1000);
  const exp = iat + SESSION_TTL_SECONDS;
  return { sessionId: sid, expiresAt: exp, token: signPayload(secret, { sid, sub, iat, exp }) };
}

export function verifySessionToken({ secret, token, now = Date.now() }) {
  try {
    const [encoded, signature] = String(token ?? '').split('.', 2);
    if (!encoded || !signature) return null;
    const expected = crypto.createHmac('sha256', secret).update(encoded).digest();
    const supplied = b64urlDecode(signature);
    if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied))
      return null;
    const payload = JSON.parse(b64urlDecode(encoded).toString('utf8'));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    if (Number(payload.exp ?? 0) < Math.floor(now / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
