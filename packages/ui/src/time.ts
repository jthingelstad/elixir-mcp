/** One clock vocabulary for every surface.
 *
 *  These lived as near-identical copies in the console's Status.jsx and
 *  Dashboard.jsx while Admin.jsx rendered raw `toLocaleTimeString()`,
 *  which is how the public status page and the admin collectors table
 *  came to disagree about the same collector (2026-09-06); then the
 *  console's copy and Elixir Clan's drifted the same way. Relative
 *  deltas are timezone free; an absolute local wall-clock time is not,
 *  and it silently wraps after a day. Import from here rather than
 *  writing another one.
 */

/** Seconds since `ts`, or null when there is no timestamp.
 *
 *  Clamped at zero: the browser clock and the server clock disagree by
 *  a second or two, and a collector that just heartbeated would
 *  otherwise render "-1s ago". */
export function secsSince(
  ts: string | number | Date | null | undefined,
  now: number = Date.now(),
): number | null {
  if (!ts) return null;
  return Math.max(0, (now - new Date(ts).getTime()) / 1000);
}

/** Coarse relative time from an age in seconds: "just now", "12s ago",
 *  "4m ago", "60m ago", "3h ago", "2d ago". The unit turns over late
 *  (90 s, 90 min, 2 d) so a reading stays in the finer unit while it is
 *  still worth reading that way - "75m ago" says more than "1h ago"
 *  about a poll. This is the vocabulary Elixir's own freshness pill
 *  used and Clan copied; the console's lib/time turned over at 60/3600
 *  and the two disagreed about the same instant. */
export function agoSeconds(s: number | null | undefined): string {
  if (s == null || Number.isNaN(s)) return "never";
  if (s < 1) return "just now";
  if (s < 90) return `${Math.round(s)}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 172800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/** The same age in the words a member reads on a freshness chip: "15 min
 *  ago", "2 hr ago", "3 days ago". */
export function agoPlain(s: number | null | undefined): string {
  if (s == null || Number.isNaN(s)) return "never";
  if (s < 60) return "just now";
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172800) return `${Math.round(s / 3600)} hr ago`;
  return `${Math.round(s / 86400)} days ago`;
}

/** Coarse relative time from a timestamp. */
export function ago(
  ts: string | number | Date | null | undefined,
  now: number = Date.now(),
): string {
  if (!ts) return "never";
  return agoSeconds(secsSince(ts, now));
}

/** Exact relative time, two units: "12s ago", "3m 12s ago", "2h 14m ago",
 *  "3d 5h ago". For a table that is read to compare rows against each
 *  other - the fleet page, where "3m ago" five times over hid that the
 *  collectors were fetching in lockstep (2026-09-11). Reads as of the
 *  `now` it was rendered with, like `ago`. */
export function agoExact(
  ts: string | number | Date | null | undefined,
  now: number = Date.now(),
): string {
  if (!ts) return "never";
  const s = Math.round(secsSince(ts, now) ?? 0);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s ago`;
  if (s < 86400)
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h ago`;
}

/** The freshness pill's class for an age: live under 15 minutes, stale
 *  under a day, then plain. */
export function freshCls(s: number | null | undefined): string {
  if (s == null) return "freshness freshness--never";
  if (s < 900) return "freshness freshness--live";
  if (s < 86400) return "freshness freshness--stale";
  return "freshness";
}

/** Freshness of a HEARTBEAT, held to a much tighter standard. A
 *  collector touches the door every few seconds, and its own watchdog
 *  exits after 5 minutes without a round-trip, so a heartbeat older
 *  than that means the process is gone rather than idle. */
export function beatCls(s: number | null | undefined): string {
  if (s == null) return "freshness freshness--never";
  if (s < 300) return "freshness freshness--live";
  if (s < 3600) return "freshness freshness--stale";
  return "freshness";
}

type Instant = string | number | Date | null | undefined;

/** A wall clock for an instant: its date, hours and minutes, seconds,
 *  and the suffix that names the zone. No zone (the account never set
 *  one) is UTC written the way the console always wrote it, with a Z;
 *  a zone is that zone's own short name ("CDT", or "GMT+2" where the
 *  zone has no abbreviation). A zone this browser does not know reads
 *  as UTC rather than failing the page. */
function wallClock(ts: Instant, zone: string | null | undefined) {
  if (ts == null || ts === "") return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  if (zone && zone !== "UTC" && zone !== "Etc/UTC") {
    try {
      const p: Record<string, string> = {};
      for (const { type, value } of new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
        timeZoneName: "short",
      }).formatToParts(d))
        p[type] = value;
      return {
        date: `${p.year}-${p.month}-${p.day}`,
        hm: `${p.hour}:${p.minute}`,
        s: p.second,
        suffix: ` ${p.timeZoneName}`,
      };
    } catch {
      // Unknown to this browser: fall through to UTC.
    }
  }
  const iso = d.toISOString();
  return {
    date: iso.slice(0, 10),
    hm: iso.slice(11, 16),
    s: iso.slice(17, 19),
    suffix: "Z",
  };
}

/** An instant as the reader's wall clock: "09-12 10:00 CDT", or with
 *  `year` "2026-09-12 10:00 CDT", and `seconds` adds them. Every
 *  absolute time the console shows goes through here, in the account's
 *  timezone (Jamie, 2026-09-23: the console knew the zone and printed
 *  UTC anyway, from a dozen hand-built toISOString() copies). "—" for
 *  no instant. */
export function stamp(
  ts: Instant,
  zone?: string | null,
  { year = false, seconds = false }: { year?: boolean; seconds?: boolean } = {},
): string {
  const w = wallClock(ts, zone);
  if (!w) return "—";
  return `${year ? w.date : w.date.slice(5)} ${w.hm}${seconds ? `:${w.s}` : ""}${w.suffix}`;
}

/** The reader's calendar date for an instant, "2026-09-12": the day it
 *  was where they are, which near midnight is not the UTC day. */
export function stampDay(ts: Instant, zone?: string | null): string {
  return wallClock(ts, zone)?.date ?? "—";
}

/** Just the time of day, "10:00 CDT" or with `seconds` "10:00:05 CDT".
 *  `bare` drops the zone, for a chart axis whose tooltip names it. */
export function stampTime(
  ts: Instant,
  zone?: string | null,
  { seconds = false, bare = false }: { seconds?: boolean; bare?: boolean } = {},
): string {
  const w = wallClock(ts, zone);
  if (!w) return "—";
  return `${w.hm}${seconds ? `:${w.s}` : ""}${bare ? "" : w.suffix}`;
}

const WEEK_MS = 7 * 86_400_000;

type WhenOptions = { now?: number };

/** The parts of an instant on a reader's clock. `named` says the reader
 *  has a zone of their own; without one (no zone set, or one this browser
 *  does not know) the parts are UTC and the caller says so. */
function readerParts(ts: Instant, zone: string | null | undefined) {
  if (ts == null || ts === "") return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  const read = (timeZone: string) => {
    const p: Record<string, string> = {};
    for (const { type, value } of new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).formatToParts(d))
      p[type] = value;
    return {
      weekday: p.weekday,
      month: p.month,
      day: p.day,
      year: p.year,
      clock: `${p.hour}:${p.minute} ${String(p.dayPeriod).toLowerCase()}`,
    };
  };
  if (zone) {
    try {
      return { ...read(zone), named: zone !== "UTC" && zone !== "Etc/UTC" };
    } catch {
      // Unknown to this browser: fall through to UTC.
    }
  }
  return { ...read("UTC"), named: false };
}

/** The year a date is read against, on the same clock as the date. */
function yearOf(now: number, zone: string | null | undefined): string {
  return readerParts(now, zone)?.year ?? "";
}

/** How a member page says when something happened, the one format
 *  (Jamie, 2026-11-05): "Sat 8:42 pm" within a week either side of now,
 *  "Fri Oct 23, 5:07 pm" older, and "Fri Oct 23 2025, 5:07 pm" in another
 *  year. In the reader's zone; a reader with no zone reads UTC and the
 *  time says "UTC", because it is not their clock. "—" for no instant.
 *  Pass `now` from `useClock`/`useInitialTime` in a render. */
export function whenAt(
  ts: Instant,
  zone?: string | null,
  { now = Date.now() }: WhenOptions = {},
): string {
  const p = readerParts(ts, zone);
  if (!p) return "—";
  const tail = `${p.clock}${p.named ? "" : " UTC"}`;
  if (Math.abs(now - new Date(ts as string).getTime()) < WEEK_MS)
    return `${p.weekday} ${tail}`;
  const year = p.year === yearOf(now, zone) ? "" : ` ${p.year}`;
  return `${p.weekday} ${p.month} ${p.day}${year}, ${tail}`;
}

/** The day of an instant with no clock: "Fri Oct 23", with the year when
 *  it is another year. The reader's day, which near midnight is not the
 *  UTC day. "—" for no instant. */
export function dayAt(
  ts: Instant,
  zone?: string | null,
  { now = Date.now() }: WhenOptions = {},
): string {
  // A bare date names a day, not an instant, so no zone can move it.
  const bare = typeof ts === "string" && /^\d{4}-\d{2}-\d{2}$/.test(ts);
  const on = bare ? "UTC" : zone;
  const p = readerParts(bare ? `${ts}T12:00:00Z` : ts, on);
  if (!p) return "—";
  const year = p.year === yearOf(now, on) ? "" : ` ${p.year}`;
  return `${p.weekday} ${p.month} ${p.day}${year}`;
}

/** A date with no instant behind it ("2026-10-23", a Monday, a hold's
 *  last day) as "Fri Oct 23": read as the calendar date it names, in no
 *  zone. "—" for anything else. */
export function calendarDay(
  ymd: string | null | undefined,
  { now = Date.now() }: WhenOptions = {},
): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd ?? ""));
  if (!m) return "—";
  return dayAt(`${m[1]}-${m[2]}-${m[3]}T12:00:00Z`, "UTC", { now });
}

/** Just the time of day, "8:42 pm". The caller says which day and whose
 *  clock. Empty for no instant. */
export function clockAt(
  ts: Instant,
  zone?: string | null,
  { seconds = false }: { seconds?: boolean } = {},
): string {
  const p = readerParts(ts, zone);
  if (!p) return "";
  if (!seconds) return p.clock;
  const s = String(new Date(ts as string).getUTCSeconds()).padStart(2, "0");
  return p.clock.replace(/ (am|pm)$/, `:${s} $1`);
}

/** The short name of the reader's zone at an instant, "CDT" or "UTC". */
export function zoneShort(ts: Instant, zone?: string | null): string {
  if (ts == null || ts === "") return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const read = (timeZone: string) =>
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
      .formatToParts(d)
      .find((p) => p.type === "timeZoneName")?.value ?? "";
  try {
    return read(zone || "UTC");
  } catch {
    return read("UTC");
  }
}

/** A month and day with nothing around it, "Sep 18", for a range or a
 *  chart axis in the reader's zone. Empty for no instant. */
export function monthDayAt(ts: Instant, zone?: string | null): string {
  const p = readerParts(ts, zone);
  return p ? `${p.month} ${p.day}` : "";
}

/** "Season 137, week 4". A member page never writes "S137 W4". */
export function seasonWeek(
  season: number | string,
  week?: number | string | null,
): string {
  return week == null || week === ""
    ? `Season ${season}`
    : `Season ${season}, week ${week}`;
}

/** The browser's own IANA zone ("America/Chicago"), or null when it
 *  will not say. The battle page's clock when nobody is signed in; the
 *  zone a signup sends, which a NEW account opens on (Jamie,
 *  2026-10-08); and the zone the Console offers to set when an account
 *  has none. Never a silent default for an existing account, whose zone
 *  is the one it has (UTC while it has none). */
export function browserZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}
