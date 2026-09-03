/**
 * Hourly-window counter (librarian's pattern on Postgres). Identity for
 * unauthenticated surfaces is IP-ONLY — including User-Agent lets
 * attackers mint unlimited identities (audit finding A2, kept).
 */

const WINDOW_SECONDS = 3600;

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
