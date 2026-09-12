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

function validTimezone(timeZone) {
  if (!timeZone) return false;
  try {
    Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Local midnight of YYYY-MM-DD in tz, as a UTC Date (DST-aware). */
function localMidnightUtc(timeZone, ymd) {
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

/** Local time as ISO 8601 WITH its offset (2026-09-09T23:31:47-05:00):
 *  machine-parseable, the zone recoverable from the offset plus
 *  meta.timezone_applied. It used to be "2026-09-09 23:31:47
 *  (America/Chicago)", a display string nothing could parse (review 2.2.12). */
export function formatLocal(isoOrDate, timeZone) {
  const tz = validTimezone(timeZone) ? timeZone : "UTC";
  const date = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  const offsetMin = Math.round(tzOffsetMs(tz, date.getTime()) / 60_000);
  const local = new Date(date.getTime() + offsetMin * 60_000)
    .toISOString()
    .slice(0, 19);
  const sign = offsetMin < 0 ? "-" : "+";
  const abs = Math.abs(offsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${local}${offsetMin === 0 ? "Z" : `${sign}${hh}:${mm}`}`;
}

/** Monday 00:00 UTC of the ISO week containing `date`. */
export function isoWeekStart(date) {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = d.getUTCDay() || 7; // Monday = 1 ... Sunday = 7
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return d;
}

/** "2026-W37": the ISO year and week of `date` (a UTC instant). */
export function isoWeekLabel(date) {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day); // the week's Thursday decides the year
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
