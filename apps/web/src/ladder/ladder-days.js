/**
 * Ladder's calendar (on Season) and battle list (on Battles): the season's
 * battles as battles_query returned them, laid on the account's calendar and
 * chained into sittings. Counting is all this does: a day holds the battles
 * that started on it in the account's zone, each mode keeps its own count and
 * its own record, and a sitting is a run of battles with no gap longer than
 * half an hour. Nothing here rates a day or a sitting.
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
/** A mode group as a sitting names it (singular, "Event"). */
const groupLabel = (key) => NAMES[key] ?? modeLabel(key);
const rank = (key) => {
  const i = ORDER.indexOf(key);
  return i < 0 ? ORDER.length : i;
};

/** Half an hour: the longest gap inside one sitting (the board's rule,
 *  and the battle page's sitting). */
const SITTING_GAP_MS = 30 * 60_000;

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
/** "Mon Sep 28". */
export const weekdayLabel = (ymd) =>
  `${WEEKDAY_FMT.format(asUtc(ymd))} ${dayLabel(ymd)}`;
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

/* ------------------------------------------------- the calendar, by chip */

/** A count on the calendar in the board's words: "8 · 5–3", a draw last. */
const countText = (t) =>
  `${fmt(t.battles)} · ${fmt(t.wins)}–${fmt(t.losses)}${t.draws ? `–${fmt(t.draws)}` : ""}`;

/**
 * The calendar as one chip reads it (`groups`, the tools' modes it holds): each
 * day's class and words, in the order the key lists them. A battle in this mode
 * is a shade. A day with none here and some elsewhere is a count, never pooled
 * into this mode. A day with none at all says only what the read can prove: "No
 * battles" takes a whole day read, and anything less is partly read or unknown
 * (`coverageFailed`, when the check itself did not answer, is unknown too).
 */
export function chipCalendar(cal, groups, { coverageFailed = false } = {}) {
  const inChip = (d) => {
    const hit = d.modes.filter((m) => groups.includes(m.key));
    return hit.reduce(
      (t, m) => ({
        battles: t.battles + m.battles,
        wins: t.wins + m.wins,
        losses: t.losses + m.losses,
        draws: t.draws + m.draws,
      }),
      { battles: 0, wins: 0, losses: 0, draws: 0 },
    );
  };
  const busiest = Math.max(0, ...cal.days.map((d) => inChip(d).battles));
  const days = cal.days.map((d) => {
    const mine = inChip(d);
    const others = d.count - mine.battles;
    const today = d.state === "today";
    let cls;
    let text;
    if (mine.battles > 0) {
      cls = `l${Math.min(3, Math.ceil((3 * mine.battles) / busiest))}`;
      text = countText(mine);
    } else if (d.state === "unread") {
      cls = "unread";
      text = "Not read";
    } else if (d.state === "future") {
      cls = "fut";
      text = "";
    } else if (others > 0) {
      cls = "other";
      text = `${fmt(others)} in other modes`;
    } else if (today) {
      cls = "fut";
      text = "Still being read";
    } else if (!coverageFailed && d.capture.quiet) {
      cls = "quiet";
      text = "No battles";
    } else if (!coverageFailed && d.capture.coverage === "partial") {
      cls = "part";
      text = "Partly read";
    } else {
      cls = "unk";
      text = "Unknown";
    }
    return { ...d, mine, others, cls, text, today };
  });
  const elapsed = days.filter((d) => d.state !== "future");
  return {
    lead: cal.lead,
    days,
    played: elapsed.filter((d) => d.mine.battles > 0).length,
    of: elapsed.length,
    gap: coverageFailed ? null : longestBreak(days),
    hasUnread: days.some((d) => d.state === "unread"),
  };
}

/** The longest run of past days fully read with no battle in this mode. A day
 *  not fully read is unknown, so it ends the run. */
export function longestBreak(days) {
  let best = null;
  let run = null;
  for (const d of days) {
    if (
      d.state === "past" &&
      d.capture?.coverage === "complete" &&
      d.mine.battles === 0
    ) {
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

/* ------------------------------------------------------------- sittings */

/**
 * A list of battles as sittings, newest first: runs of battles with no gap
 * longer than half an hour. Each sitting keeps its battles newest first, its
 * modes in the order they were played ("2 event battles, then 3 on
 * Trophy Road") each with its own record, and on Trophy Road the
 * trophies it started and ended on, as the battles' own
 * starting_trophies and trophy_change say (a loss on the floor carries
 * no change and costs nothing).
 */
export function sittingsOf(battles, zone, { gap = SITTING_GAP_MS } = {}) {
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

/** A row's result as it leads the row: "Lost 0–2", and the tone Record's card
 *  gives it. The word stays, so colour is never the only signal. */
export function battleOutcome(b) {
  const score = battleScore(b);
  return {
    words: score.charAt(0).toUpperCase() + score.slice(1),
    tone:
      b.me?.outcome === "win"
        ? "win"
        : b.me?.outcome === "loss"
          ? "loss"
          : "draw",
  };
}

/** The path of a battle's own page, from the url the tool returned
 *  (never built from an id): the battle page is this app's, so the link
 *  stays in it. */
export const battlePath = (url) =>
  String(url ?? "").replace(/^https?:\/\/[^/]+/, "");

/** "War duel", "Boat attack", "2v2", "Clanmate battle", "Casual",
 *  "Challenge", "Tournament": a row's own kind where a mode's rows differ, from
 *  the row's API type and its sides. Null where every row is the same game. */
export function battleKind(b) {
  const group = b?.mode_group;
  const type = String(b?.type ?? "");
  if (group === "war") {
    if (/^riverRaceDuel/.test(type)) return "War duel";
    if (type === "boatBattle") return "Boat attack";
    return "War battle";
  }
  if (group === "casual") {
    if ((b?.opponents ?? []).length > 1) return "2v2";
    if (/^clanMate/.test(type)) return "Clanmate battle";
    return "Casual";
  }
  if (group === "challenge" || group === "tournament") return groupLabel(group);
  return null;
}

/**
 * The Battles tab: the days with a battle in this read, newest first, each
 * with its sittings newest first. A day is the calendar's day, so its count
 * agrees with Season's, and a sitting that crosses midnight is two here as it
 * is two days there.
 */
export function battleDays(battles, zone) {
  const on = new Map();
  for (const b of battles ?? []) {
    if (!counted(b)) continue;
    const day = localDate(b.battle_time, zone);
    if (!day) continue;
    if (!on.has(day)) on.set(day, []);
    on.get(day).push(b);
  }
  return [...on.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([ymd, list]) => ({
      ymd,
      label: weekdayLabel(ymd),
      ...tally(list),
      sittings: sittingsOf(list, zone),
    }));
}

/** "4–2", a draw last. */
function recordLine(t) {
  return `${fmt(t.wins)}–${fmt(t.losses)}${t.draws ? `–${fmt(t.draws)}` : ""}`;
}

/** "6 battles · 4–2". */
export function tallyLine(t) {
  return `${fmt(t.battles)} ${t.battles === 1 ? "battle" : "battles"} · ${recordLine(t)}`;
}

/** The head of a day with one sitting, which has no row of its own: its record,
 *  the trophies it moved, and when, with no span for a single battle. The rows
 *  under it are the count. */
export function soloSittingLine(day, zone) {
  const [s] = day.sittings;
  return [
    recordLine(day),
    s.trophies ? `${fmt(s.trophies.from)} to ${fmt(s.trophies.to)}` : null,
    s.battles.length > 1 ? timeSpan(s.start, s.end, zone) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
