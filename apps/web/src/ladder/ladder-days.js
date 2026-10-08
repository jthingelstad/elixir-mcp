/**
 * Ladder's Days page (LadderDays.dc.html): the season's battles as
 * battles_query returned them, laid on the account's calendar and
 * chained into nights. Counting is all this does: a day holds the
 * battles that started on it in the account's zone, each mode keeps its
 * own mark and its own record, and a night is a run of battles with no
 * gap longer than half an hour. Nothing here rates a day or a night.
 */
import { clockTime, fmt, modeLabel } from "./ladder.js";
import { battleCapture } from "@elixir-mcp/record/capture-state";

/** Every mode group battles_query can name (contracts MODE_GROUPS), in
 *  the order a day lists them: the season's games first, casual last. */
const ORDER = [
  "ladder",
  "ranked",
  "war",
  "event",
  "challenge",
  "tournament",
  "casual",
];
const NAMES = {
  ladder: "Trophy Road",
  ranked: "Path of Legends",
  war: "War",
  event: "Event",
  challenge: "Challenge",
  tournament: "Tournament",
  casual: "Casual",
};
/** A mode group as a day or a night names it (singular, "Event"). */
export const groupLabel = (key) => NAMES[key] ?? modeLabel(key);
const rank = (key) => {
  const i = ORDER.indexOf(key);
  return i < 0 ? ORDER.length : i;
};

/** Half an hour: the longest gap inside one night (the board's rule,
 *  and the battle page's sitting). */
const NIGHT_GAP_MS = 30 * 60_000;

/* ---------------------------------------------------------------- dates */

/** The calendar date an instant falls on in `zone`, as "2026-09-28". An
 *  unknown zone reads as UTC rather than failing the page. */
export function localDate(ts, zone) {
  const d = new Date(ts);
  if (ts == null || Number.isNaN(d.getTime())) return null;
  const make = (timeZone) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(d);
  let list;
  try {
    list = make(zone || "UTC");
  } catch {
    list = make("UTC");
  }
  const p = Object.fromEntries(list.map(({ type, value }) => [type, value]));
  return `${p.year}-${p.month}-${p.day}`;
}

const asUtc = (ymd) => new Date(`${ymd}T12:00:00Z`);

/** A calendar date `n` days on. */
export function addDays(ymd, n) {
  const d = asUtc(ymd);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Local midnight as an instant, including 23/25-hour DST days. Invalid
 * account zones use UTC, like localDate. Missing midnights stay unknown. */
function midnight(ymd, zone) {
  const base = Date.parse(`${ymd}T00:00:00Z`);
  let formatter;
  const options = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  };
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      ...options,
      timeZone: zone || "UTC",
    });
  } catch {
    formatter = new Intl.DateTimeFormat("en-CA", {
      ...options,
      timeZone: "UTC",
    });
  }
  let guess = base;
  for (let attempt = 0; attempt < 4; attempt++) {
    const p = Object.fromEntries(
      formatter.formatToParts(guess).map((x) => [x.type, x.value]),
    );
    const wall = Date.parse(
      `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`,
    );
    const delta = base - wall;
    if (!delta) return guess;
    guess += delta;
  }
  return NaN;
}

/** Monday 0 through Sunday 6. */
export const weekdayIndex = (ymd) => (asUtc(ymd).getUTCDay() + 6) % 7;

const DAY_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
});
const WEEKDAY_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "short",
});
/** "Sep 28". */
const dayLabel = (ymd) => DAY_FMT.format(asUtc(ymd));
/** "Mon, Sep 28". */
export const weekdayLabel = (ymd) =>
  `${WEEKDAY_FMT.format(asUtc(ymd))}, ${dayLabel(ymd)}`;
/** "Mon". */
export const weekdayOf = (ymd) => WEEKDAY_FMT.format(asUtc(ymd));

/** The zone as prose for the lede: "Central time", "UTC". */
export function zoneName(zone) {
  if (!zone || zone === "UTC" || zone === "Etc/UTC") return "UTC";
  try {
    const p = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "longGeneric",
    })
      .formatToParts(new Date())
      .find((x) => x.type === "timeZoneName")?.value;
    return p ? p.replace(/ Time$/, " time") : zone;
  } catch {
    return "UTC";
  }
}

/* -------------------------------------------------------------- battles */

/** A battle the page counts: one with an outcome, and not a boat
 *  DEFENSE, which is not the member's battle (0171; battles_performance
 *  leaves it out, so the season home does too). The row's boat.role is
 *  your player's part (9.19.0); boat.side is the recording log's word,
 *  which is the other player's when their log recorded it first. */
export function counted(b) {
  if (!b?.me?.outcome) return false;
  if (b.boat?.role === "defender") return false;
  return true;
}

function tally(list) {
  const t = { battles: 0, wins: 0, losses: 0, draws: 0 };
  for (const b of list) {
    t.battles++;
    if (b.me.outcome === "win") t.wins++;
    else if (b.me.outcome === "loss") t.losses++;
    else t.draws++;
  }
  return t;
}

/** One record per mode group, in the day's order. */
function byMode(list) {
  const groups = new Map();
  for (const b of list) {
    const k = b.mode_group ?? "casual";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(b);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([key, rows]) => ({ key, label: groupLabel(key), ...tally(rows) }));
}

/* ------------------------------------------------------------- calendar */

/**
 * The season's calendar in the account's zone: one entry per day from
 * the season's first local day to the day before its last (the season
 * ends early on a Monday morning; a battle in those hours adds that
 * day). Each day is `past`, `today`, `future`, or `unread` when the
 * sweep stopped before reaching it (`readFrom`, the oldest battle read,
 * when the sweep was capped): an unread day is never drawn as empty.
 */
export function seasonCalendar({
  battles,
  startsAt,
  endsAt,
  now,
  zone,
  readFrom = null,
  observationIntervals = [],
}) {
  const first = localDate(startsAt, zone);
  const end = localDate(endsAt, zone);
  if (!first || !end) return { lead: 0, days: [], busiest: 0 };
  const today = localDate(now, zone);
  const floor = readFrom ? localDate(readFrom, zone) : null;
  const on = new Map();
  for (const b of battles ?? []) {
    if (!counted(b)) continue;
    const day = localDate(b.battle_time, zone);
    if (!day) continue;
    if (!on.has(day)) on.set(day, []);
    on.get(day).push(b);
  }
  let last = addDays(end, -1);
  if (on.has(end)) last = end;
  const days = [];
  for (let d = first; d <= last; d = addDays(d, 1)) {
    // A capped sweep reached into this day part way, or not at all.
    const unread = floor !== null && d <= floor;
    const list = on.get(d) ?? [];
    const state = unread
      ? "unread"
      : d === today
        ? "today"
        : d > today
          ? "future"
          : "past";
    const dayStart = midnight(d, zone);
    const dayEnd = midnight(addDays(d, 1), zone);
    days.push({
      ymd: d,
      label: dayLabel(d),
      state,
      count: list.length,
      modes: byMode(list),
      capture: battleCapture({
        from: dayStart,
        to: dayEnd,
        intervals: observationIntervals,
        recordedBattles: list.length,
        // A clipped season boundary and a partial sweep leave part of
        // the day unread. Today's unbracketed tail is always unknown.
        readComplete:
          state === "past" &&
          !unread &&
          dayStart >= Date.parse(startsAt) &&
          dayEnd <= Date.parse(endsAt),
      }),
    });
  }
  const busiest = Math.max(0, ...days.map((d) => d.count));
  for (const d of days)
    d.level =
      d.count === 0 ? 0 : Math.min(3, Math.ceil((3 * d.count) / busiest));
  return { lead: weekdayIndex(first), days, busiest };
}

/** Positive captured days, with elapsed season days as calendar context.
 * The calendar denominator does not measure coverage. */
export function daysPlayed(days) {
  const so = days.filter((d) => d.state !== "future");
  return { played: so.filter((d) => d.count > 0).length, of: so.length };
}

/** One tile per mode played this season, most battles first: the days
 *  it was played on, its battles and its own record. */
export function modeDays(days) {
  const out = new Map();
  for (const d of days)
    for (const m of d.modes) {
      const t = out.get(m.key) ?? {
        key: m.key,
        label: groupLabel(m.key),
        days: 0,
        battles: 0,
        wins: 0,
        losses: 0,
        draws: 0,
      };
      t.days++;
      t.battles += m.battles;
      t.wins += m.wins;
      t.losses += m.losses;
      t.draws += m.draws;
      out.set(m.key, t);
    }
  return [...out.values()].sort(
    (a, b) => b.battles - a.battles || rank(a.key) - rank(b.key),
  );
}

/** The longest run of fully covered quiet days before today.
 * Unknown days interrupt a run; null means no supported stretch. */
export function longestBreak(days) {
  let best = null;
  let run = null;
  for (const d of days) {
    if (d.state === "past" && d.capture?.quiet === true) {
      run = run
        ? { ...run, to: d.ymd, length: run.length + 1 }
        : { from: d.ymd, to: d.ymd, length: 1 };
      if (!best || run.length > best.length) best = run;
    } else run = null;
  }
  return best;
}

/** "Sep 13 and 14", "Sep 25", "Sep 13 to 16", "Sep 30 to Oct 2". */
export function spanLabel({ from, to, length }) {
  if (length === 1 || from === to) return dayLabel(from);
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  const end = sameMonth ? String(Number(to.slice(8))) : dayLabel(to);
  return `${dayLabel(from)} ${length === 2 ? "and" : "to"} ${end}`;
}

/* --------------------------------------------------------------- nights */

/**
 * The season's nights, newest first: runs of battles with no gap longer
 * than half an hour. Each night keeps its battles newest first, its
 * modes in the order they were played ("2 event battles, then 3 on
 * Trophy Road") each with its own record, and on Trophy Road the
 * trophies it started and ended on, as the battles' own
 * starting_trophies and trophy_change say (a loss on the floor carries
 * no change and costs nothing).
 */
export function nightsOf(battles, zone, { gap = NIGHT_GAP_MS } = {}) {
  const rows = (battles ?? [])
    .filter(counted)
    .map((b) => ({ b, t: new Date(b.battle_time).getTime() }))
    .filter((x) => !Number.isNaN(x.t))
    .sort((x, y) => x.t - y.t);
  const runs = [];
  for (const x of rows) {
    const cur = runs.at(-1);
    if (cur && x.t - cur.at(-1).t <= gap) cur.push(x);
    else runs.push([x]);
  }
  return runs.reverse().map((run) => {
    const list = run.map((x) => x.b);
    const start = list[0].battle_time;
    const end = list.at(-1).battle_time;
    const sequence = [];
    for (const b of list) {
      const k = b.mode_group ?? "casual";
      const cur = sequence.at(-1);
      if (cur && cur.key === k) cur.rows.push(b);
      else sequence.push({ key: k, rows: [b] });
    }
    const ladder = list.filter(
      (b) => b.mode_group === "ladder" && b.me.starting_trophies != null,
    );
    const lastLadder = ladder.at(-1);
    return {
      key: list[0].battle_id ?? start,
      day: localDate(start, zone),
      start,
      end,
      sequence: sequence.map((s) => ({
        key: s.key,
        label: groupLabel(s.key),
        ...tally(s.rows),
      })),
      modes: byMode(list),
      trophies: ladder.length
        ? {
            from: ladder[0].me.starting_trophies,
            to:
              lastLadder.me.starting_trophies +
              Number(lastLadder.me.trophy_change ?? 0),
          }
        : null,
      battles: [...list].reverse(),
    };
  });
}

/** "10:37 – 11:20 pm", "11:50 pm – 12:20 am", or one time. */
export function timeSpan(start, end, zone) {
  const a = clockTime(start, zone);
  const b = clockTime(end, zone);
  if (!a) return "";
  if (a === b || !b) return a;
  const [at, ap] = a.split(" ");
  const [, bp] = b.split(" ");
  return ap === bp ? `${at} – ${b}` : `${a} – ${b}`;
}

/** A night's modes as played: "5 on Trophy Road", "2 event battles,
 *  then 3 on Trophy Road", "3 war battles". */
export function nightLine(sequence) {
  const one = (s) => {
    const n = fmt(s.battles);
    if (s.key === "ladder" || s.key === "ranked") return `${n} on ${s.label}`;
    const word = s.battles === 1 ? "battle" : "battles";
    return `${n} ${s.label.toLowerCase()} ${word}`;
  };
  return sequence.map(one).join(", then ");
}

/** A battle row's words: the opponent (both, in 2v2) and the score. */
export function battleWho(b) {
  const names = (b.opponents ?? [])
    .map((o) => o.name ?? o.player_tag)
    .filter(Boolean);
  return names.length ? names.join(" and ") : "Unknown opponent";
}

export function battleScore(b) {
  const word =
    b.me?.outcome === "win"
      ? "won"
      : b.me?.outcome === "loss"
        ? "lost"
        : "drew";
  const against = b.opponents?.[0]?.crowns;
  if (b.me?.crowns == null || against == null) return word;
  return `${word} ${b.me.crowns}–${against}`;
}

/** The path of a battle's own page, from the url the tool returned
 *  (never built from an id): the battle page is this app's, so the link
 *  stays in it. */
export const battlePath = (url) =>
  String(url ?? "").replace(/^https?:\/\/[^/]+/, "");
