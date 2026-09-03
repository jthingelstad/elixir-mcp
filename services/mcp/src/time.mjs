/**
 * Local-time rendering and local-window resolution (DESIGN §3). Storage
 * is UTC everywhere; the account timezone drives display and how
 * date-only from/to params resolve to instants.
 */

function tzOffsetMs(timeZone, utcMs) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour === "24" ? "00" : parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - utcMs;
}

export function validTimezone(timeZone) {
  if (!timeZone) return false;
  try {
    Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Local midnight of YYYY-MM-DD in tz, as a UTC Date (DST-aware). */
export function localMidnightUtc(timeZone, ymd) {
  const guess = Date.parse(`${ymd}T00:00:00Z`);
  if (Number.isNaN(guess)) return null;
  let utc = guess - tzOffsetMs(timeZone, guess);
  utc = guess - tzOffsetMs(timeZone, utc); // second pass for DST edges
  return new Date(utc);
}

/** [start, end) instants for a date-only range in the account's timezone. */
export function localDayRange(timeZone, fromYmd, toYmd) {
  const tz = validTimezone(timeZone) ? timeZone : "UTC";
  const start = fromYmd ? localMidnightUtc(tz, fromYmd) : null;
  const end = toYmd
    ? new Date(localMidnightUtc(tz, toYmd).getTime() + 24 * 3600_000)
    : null;
  return { start, end };
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Resolve a from/to param: date-only strings resolve in tz; ISO instants pass through. */
export function resolveInstant(timeZone, value, { endOfDay = false } = {}) {
  if (!value) return null;
  const raw = String(value);
  if (DATE_ONLY_RE.test(raw)) {
    const midnight = localMidnightUtc(
      validTimezone(timeZone) ? timeZone : "UTC",
      raw,
    );
    return endOfDay ? new Date(midnight.getTime() + 24 * 3600_000) : midnight;
  }
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

export function formatLocal(isoOrDate, timeZone) {
  const tz = validTimezone(timeZone) ? timeZone : "UTC";
  const date = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  return `${date.toLocaleString("sv-SE", { timeZone: tz })} (${tz})`;
}
