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
} from "./crypto.mjs";

export const MAX_CODE_ATTEMPTS = 5;

/** Create a pending login; returns the plaintext token + code for the email. */
export async function startMagicLogin(
  db,
  {
    emailHash,
    purpose = "web",
    context = null,
    ttlSeconds = MAGIC_TTL_SECONDS,
  },
) {
  const token = createMagicToken();
  const code = createMagicCode();
  await db.query(
    `insert into magic_login (token_hash, email_hash, code_hash, purpose, context, expires_at)
     values ($1, $2, $3, $4, $5, now() + make_interval(secs => $6))`,
    [
      sha256hex(token),
      emailHash,
      sha256hex(code),
      purpose,
      context ? JSON.stringify(context) : null,
      ttlSeconds,
    ],
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
export async function verifyMagicCode(db, { emailHash, code, purpose = null }) {
  const value = validMagicCode(code);
  if (!value) return { ok: false, reason: "malformed" };

  // SCOPED BY PURPOSE, and that is the whole point.
  //
  // Website sign-in and OAuth consent are two flows sharing one table. This
  // used to take the newest unused row for the address whatever it was for, so
  // the two ate each other: request a Claude authorization, sign in to the
  // console, and the console's code becomes "the" row — after which the
  // correct, newest, unexpired OAuth code from your inbox can never be
  // redeemed, identically, forever. Worse, each wrong-flow attempt spent one of
  // the OTHER flow's five attempts, so five console sign-ins could lock out a
  // pending authorization without the person doing anything wrong.
  // Reported 2026-09-09 as "the code isn't being accepted" with the newest
  // code, which was true.
  const { rows } = await db.query(
    `update magic_login
     set attempts = attempts + 1
     where token_hash = (
       select token_hash from magic_login
       where email_hash = $1 and used_at is null and expires_at > now()
         and ($3::text is null or purpose = $3)
       order by created_at desc limit 1
     ) and attempts < $2
     returning token_hash, code_hash, purpose, context, attempts`,
    [emailHash, MAX_CODE_ATTEMPTS, purpose],
  );
  const pending = rows[0];
  if (!pending)
    return {
      ok: false,
      reason: await whyNothingPending(db, emailHash, purpose),
    };
  if (!timingSafeEqualHex(sha256hex(value), pending.code_hash)) {
    return {
      ok: false,
      // Naming WHICH way it was wrong is what turns "that didn't work" into a
      // sentence somebody can act on. None of these reveal anything a caller
      // did not already supply.
      reason: await classifyMismatch(db, emailHash, purpose, value),
      attempts: pending.attempts,
    };
  }
  const { rows: burned } = await db.query(
    `update magic_login set used_at = now()
     where token_hash = $1 and used_at is null
     returning email_hash, purpose, context`,
    [pending.token_hash],
  );

  return burned[0]
    ? { ok: true, row: burned[0] }
    : { ok: false, reason: "raced" };
}

/**
 * Why the selector found nothing to try. Both answers are actionable and
 * neither is an oracle: the caller already told us the address.
 */
async function whyNothingPending(db, emailHash, purpose) {
  const { rows } = await db.query(
    `select attempts from magic_login
     where email_hash = $1 and used_at is null and expires_at > now()
       and ($2::text is null or purpose = $2)
     order by created_at desc limit 1`,
    [emailHash, purpose],
  );
  if (!rows[0]) return "no_live_code";
  return rows[0].attempts >= MAX_CODE_ATTEMPTS ? "attempts_exhausted" : "raced";
}

/**
 * The newest code for this flow did not match. Did the person hand us an
 * OLDER code from the same flow, or a code from the other flow entirely?
 * Failure path only, so the extra reads cost nothing in the normal case.
 */
async function classifyMismatch(db, emailHash, purpose, value) {
  const digest = sha256hex(value);
  const { rows } = await db.query(
    `select purpose, used_at, expires_at < now() as expired
     from magic_login
     where email_hash = $1 and code_hash = $2
     order by created_at desc limit 1`,
    [emailHash, digest],
  );
  const found = rows[0];
  if (!found) return "code_mismatch";
  if (purpose && found.purpose !== purpose) return "wrong_flow";
  if (found.used_at) return "already_used";
  if (found.expired) return "expired";
  return "superseded";
}
