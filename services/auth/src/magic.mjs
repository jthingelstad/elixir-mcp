/**
 * Magic login rows — one row serves BOTH the emailed link and the 6-digit
 * code (librarian's design: link-click and code-entry burn one shared
 * one-shot record). Redemption is a conditional single-use update so
 * races lose; code verification increments attempts BEFORE comparing,
 * capped, with a timing-safe compare.
 */

import {
  createMagicToken,
  createMagicCode,
  validMagicToken,
  validMagicCode,
  sha256hex,
  timingSafeEqualHex,
  MAGIC_TTL_SECONDS,
} from './crypto.mjs';

export const MAX_CODE_ATTEMPTS = 5;

/** Create a pending login; returns the plaintext token + code for the email. */
export async function startMagicLogin(
  db,
  { emailHash, purpose = 'web', context = null, ttlSeconds = MAGIC_TTL_SECONDS },
) {
  const token = createMagicToken();
  const code = createMagicCode();
  await db.query(
    `insert into magic_login (token_hash, email_hash, code_hash, purpose, context, expires_at)
     values ($1, $2, $3, $4, $5, now() + make_interval(secs => $6))`,
    [sha256hex(token), emailHash, sha256hex(code), purpose, context ? JSON.stringify(context) : null, ttlSeconds],
  );
  return { token, code };
}

/** Link path: single-use conditional burn. Returns the row or null. */
export async function redeemMagicToken(db, token) {
  const value = validMagicToken(token);
  if (!value) return null;
  const { rows } = await db.query(
    `update magic_login
     set used_at = now()
     where token_hash = $1 and used_at is null and expires_at > now()
     returning email_hash, purpose, context`,
    [sha256hex(value)],
  );
  return rows[0] ?? null;
}

/**
 * Code path: find the latest pending row for the email, count the attempt
 * BEFORE comparing (cap enforced), timing-safe compare, then burn the
 * same row the link would have burned. Returns the row or null.
 */
export async function verifyMagicCode(db, { emailHash, code }) {
  const value = validMagicCode(code);
  if (!value) return null;
  const { rows } = await db.query(
    `update magic_login
     set attempts = attempts + 1
     where token_hash = (
       select token_hash from magic_login
       where email_hash = $1 and used_at is null and expires_at > now()
       order by created_at desc limit 1
     ) and attempts < $2
     returning token_hash, code_hash, purpose, context`,
    [emailHash, MAX_CODE_ATTEMPTS],
  );
  const pending = rows[0];
  if (!pending) return null;
  if (!timingSafeEqualHex(sha256hex(value), pending.code_hash)) return null;
  const { rows: burned } = await db.query(
    `update magic_login set used_at = now()
     where token_hash = $1 and used_at is null
     returning email_hash, purpose, context`,
    [pending.token_hash],
  );
  return burned[0] ?? null;
}
