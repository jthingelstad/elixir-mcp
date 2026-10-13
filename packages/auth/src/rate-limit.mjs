/**
 * Hourly-window counter (librarian's pattern on Postgres). Identity for
 * unauthenticated surfaces is IP-ONLY — including User-Agent lets
 * attackers mint unlimited identities (audit finding A2, kept).
 */

export const WINDOW_SECONDS = 3600;

export async function checkRateLimit(db, { bucket, max, now = Date.now() }) {
  const windowStart = new Date(
    Math.floor(now / 1000 / WINDOW_SECONDS) * WINDOW_SECONDS * 1000,
  );
  const { rows } = await db.query(
    `insert into rate_limit (bucket, window_start, count) values ($1, $2, 1)
     on conflict (bucket, window_start) do update set count = rate_limit.count + 1
     returning count`,
    [bucket, windowStart],
  );
  return rows[0].count <= max;
}

/** Sign-in codes mailed to one address in an hour, website and OAuth
 *  sign-in together: one bucket, so neither door is a way to flood an
 *  inbox the other one guards. */
export const SIGNIN_MAIL_PER_ADDRESS_HOUR = 5;

export function signinMailAllowed(db, emailHash) {
  return checkRateLimit(db, {
    bucket: `auth#${emailHash}`,
    max: SIGNIN_MAIL_PER_ADDRESS_HOUR,
  });
}

/** Sign-in mail one viewer may ask for in an hour, website and OAuth
 *  together. Both doors open an account once its address is proved
 *  (2026-10-12), so a second door must not double what one caller may
 *  send: one bucket, as the per-address one is. */
export const SIGNIN_MAIL_PER_IP_HOUR = 10;

export function signinMailFromAllowed(db, ip) {
  return checkRateLimit(db, {
    bucket: `auth#${ip ?? "unknown"}`,
    max: SIGNIN_MAIL_PER_IP_HOUR,
  });
}

/** The address a sign-in form posted, trimmed, or null when it is not
 *  one: the same check at every door that mails a code. */
export function signinAddress(raw) {
  const email = String(raw ?? "").trim();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? email
    : null;
}
