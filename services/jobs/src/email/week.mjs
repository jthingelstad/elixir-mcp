/** The game week the reports cover: Monday 10:00Z to Monday 10:00Z,
 *  the policy grid every clan shares (docs clocks.md). Whatever day a
 *  kind sends, it covers the last COMPLETED game week, so Tuesday's and
 *  Wednesday's mail agree. The period key is the ISO week of the
 *  Monday the week started on. */
import { gameWeekStartMs } from "@elixir-mcp/record/form";

const DAY = 86_400_000;

export function lastGameWeek(now = new Date()) {
  // Most recent Monday 10:00Z at or before now: the boundary Ladder's
  // "This week vs your last 4" uses too (@elixir-mcp/record/form).
  const monday = gameWeekStartMs(now.getTime());
  const to = new Date(monday);
  const from = new Date(monday - 7 * DAY);
  return { from, to, key: isoWeekKey(from), label: rangeLabel(from, to) };
}

/** The collector week: Saturday 00:00Z to Saturday 00:00Z (Jamie,
 *  2026-10-12, docs/DECISIONS.md "The collector week is Saturday to
 *  Saturday"). The mail keeps its Sunday 14:00Z send, so it covers the
 *  week that closed at the start of the day before. The period key is
 *  the ISO week of the Saturday it started on, plus `c`: a Saturday and
 *  the Sunday after it share an ISO week, so the switch from the old
 *  Sunday 14:00Z week kept one key per week. The label names the days
 *  the week holds, Saturday to Friday: it closes at Friday's midnight,
 *  and no hour of it falls on the closing Saturday. */
export function lastCollectorWeek(now = new Date()) {
  const t = now.getTime();
  const d = new Date(t);
  // The most recent Saturday 00:00Z at or before now.
  const saturday = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() - ((d.getUTCDay() + 1) % 7),
  );
  const to = new Date(saturday);
  const from = new Date(saturday - 7 * DAY);
  return {
    from,
    to,
    key: `${isoWeekKey(from)}c`,
    label: rangeLabel(from, new Date(saturday - DAY)),
  };
}

export function isoWeekKey(date) {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d - yearStart) / DAY + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
/** "Sep 7 – 14" or "Sep 28 – Oct 5": the days the week ran over, in
 *  UTC. The end is the Monday it closed on: the week's last hours are
 *  that Monday morning, and that is the day the game calls it. */
export function rangeLabel(from, to) {
  const last = to;
  const a = `${MONTHS[from.getUTCMonth()]} ${from.getUTCDate()}`;
  const b =
    from.getUTCMonth() === last.getUTCMonth()
      ? `${last.getUTCDate()}`
      : `${MONTHS[last.getUTCMonth()]} ${last.getUTCDate()}`;
  return `${a} – ${b}`;
}

export const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Fri 20:56" in the account's zone. */
export function whenLabel(iso, timezone = "UTC") {
  const d = new Date(iso);
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .format(d)
      .replace(",", "");
  } catch {
    return `${WEEKDAY[d.getUTCDay()]} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}Z`;
  }
}
