/**
 * The season as a row (0104; docs/reviews/2026-09-16-SCHEMA-REVIEW.md 1.1).
 *
 * The calendar itself stays arithmetic (war-clock.mjs: first Monday
 * 10:00Z to first Monday 10:00Z, the war number counted from the 2026-08
 * = 135 anchor). This module is the one place that turns it into `season`
 * rows and reads them back, so the scheduler, the profile projector and
 * the tools cannot each carry a copy of the month-to-row rule.
 *
 *  - ensureSeason writes the calendar row for a month, idempotently; the
 *    scheduler keeps the current and next month present on every tick,
 *    and the profile projector fills any month a progress key names.
 *  - verifyWarSeason is the riverracelog check: the entry's seasonId
 *    against the row its close instant falls in. A match stamps
 *    war_id_verified_at once; a mismatch is reported, never relabelled.
 *  - seasonByKey resolves the tools' `season` argument: "current",
 *    "previous", YYYY-MM, or the war number (the only integer the API
 *    speaks). Nothing here guesses: an unknown key is null.
 */

import {
  monthKey,
  periodInfo,
  seasonFromDate,
  seasonIdForMonth,
} from "./war-clock.mjs";

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const MONTH_RE = /^\d{4}-\d{2}$/;

function monthStart(month, offsetMonths = 0) {
  const [y, m] = String(month).split("-").map(Number);
  return Date.UTC(y, m - 1 + offsetMonths, 15);
}

/** The calendar row for a month, as the table stores it. */
export function seasonCalendar(month) {
  if (!MONTH_RE.test(String(month)))
    throw new Error(`season month must be YYYY-MM, got ${month}`);
  const startMs = seasonFromDate(monthStart(month)).seasonStartMs;
  const endMs = seasonFromDate(monthStart(month, 1)).seasonStartMs;
  const sections = Math.round((endMs - startMs) / WEEK_MS);
  return {
    season_month: month,
    war_season_id: seasonIdForMonth(month),
    starts_at: new Date(startMs),
    ends_at: new Date(endMs),
    sections,
    colosseum_section: sections - 1,
  };
}

/** The periods of a season on the policy grid (0105): one row a day,
 *  three training then four war days a section, the last section
 *  colosseum. Pure, so the SQL seed and this agree by test. */
export function warPeriods(calendar) {
  const out = [];
  for (let i = 0; i < calendar.sections * 7; i += 1) {
    const info = periodInfo(i);
    out.push({
      war_season_id: calendar.war_season_id,
      period_index: i,
      section_index: info.sectionIndex,
      day_in_section: info.dayInSection,
      kind:
        info.kind === "war" && info.sectionIndex === calendar.colosseum_section
          ? "colosseum"
          : info.kind,
      war_day: info.warDay,
      starts_at: new Date(calendar.starts_at.getTime() + i * DAY_MS),
      ends_at: new Date(calendar.starts_at.getTime() + (i + 1) * DAY_MS),
    });
  }
  return out;
}

/** Write the calendar rows for a month if they are missing: the season
 *  and its periods. Pure calendar, so two writers (scheduler,
 *  projector) can never disagree. */
export async function ensureSeason(db, month) {
  const row = seasonCalendar(month);
  const { rowCount } = await db.query(
    `insert into season (season_month, war_season_id, starts_at, ends_at, sections, colosseum_section)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (season_month) do nothing`,
    [
      row.season_month,
      row.war_season_id,
      row.starts_at,
      row.ends_at,
      row.sections,
      row.colosseum_section,
    ],
  );
  if (rowCount > 0) {
    const periods = warPeriods(row);
    await db.query(
      `insert into war_period
         (war_season_id, period_index, section_index, day_in_section, kind, war_day, starts_at, ends_at)
       select $1, i, sec, day, kind, war_day, s, e
       from unnest($2::int[], $3::int[], $4::int[], $5::text[], $6::int[], $7::timestamptz[], $8::timestamptz[])
         as p(i, sec, day, kind, war_day, s, e)
       on conflict do nothing`,
      [
        row.war_season_id,
        periods.map((p) => p.period_index),
        periods.map((p) => p.section_index),
        periods.map((p) => p.day_in_section),
        periods.map((p) => p.kind),
        periods.map((p) => p.war_day),
        periods.map((p) => p.starts_at),
        periods.map((p) => p.ends_at),
      ],
    );
  }
  return row;
}

/** The scheduler's rollover: the season running now and the next one,
 *  so the row exists before the roll rather than at the first tick after
 *  it. Idempotent and two statements; runs every tick. */
export async function ensureSeasonsAround(db, nowMs = Date.now()) {
  const current = monthKey(seasonFromDate(nowMs).seasonStartMs);
  await ensureSeason(db, current);
  await ensureSeason(db, monthKey(monthStart(current, 1)));
  return current;
}

/** The row whose bounds contain an instant, or null. */
export async function seasonAt(db, atMs) {
  const { rows } = await db.query(
    `select * from season where starts_at <= $1 and ends_at > $1`,
    [new Date(atMs)],
  );
  return rows[0] ?? null;
}

/**
 * The tools' `season` argument. Returns the row, or null when the key
 * names no season the record has (the caller says so; nothing widens).
 */
export async function seasonByKey(db, key, nowMs = Date.now()) {
  if (key === undefined || key === null || key === "current")
    return seasonAt(db, nowMs);
  if (key === "previous") {
    const cur = await seasonAt(db, nowMs);
    if (!cur) return null;
    const { rows } = await db.query(`select * from season where ends_at = $1`, [
      cur.starts_at,
    ]);
    return rows[0] ?? null;
  }
  if (Number.isInteger(key) || /^\d+$/.test(String(key))) {
    const { rows } = await db.query(
      `select * from season where war_season_id = $1`,
      [Number(key)],
    );
    return rows[0] ?? null;
  }
  if (MONTH_RE.test(String(key))) {
    const { rows } = await db.query(
      `select * from season where season_month = $1`,
      [String(key)],
    );
    return rows[0] ?? null;
  }
  return null;
}

/** Every season boundary strictly inside (fromMs, toMs): the rows whose
 *  starts_at falls in the open interval, as crossings. */
export async function seasonCrossings(db, fromMs, toMs) {
  const { rows } = await db.query(
    `select s.season_month, s.war_season_id, s.starts_at,
            p.season_month as prev_month, p.war_season_id as prev_war
     from season s
     left join season p on p.ends_at = s.starts_at
     where s.starts_at > $1 and s.starts_at < $2
     order by s.starts_at`,
    [new Date(fromMs), new Date(toMs)],
  );
  return rows.map((r) => ({
    kind: "season",
    at: r.starts_at.toISOString(),
    from_season: r.prev_month ? { month: r.prev_month, war: r.prev_war } : null,
    to_season: { month: r.season_month, war: r.war_season_id },
  }));
}

/**
 * The riverracelog check. `closedAt` is the entry's createdDate (the
 * race close, ~09:30-10:00Z on the season's last Monday, so inside the
 * season that raced). Returns "verified" (stamped now or before),
 * "mismatch" (the alarm; nothing written), or "unknown" (no row covers
 * the instant, which the seed and the scheduler make impossible for any
 * week the API still serves).
 */
export async function verifyWarSeason(db, { warSeasonId, closedAt }) {
  const row = await seasonAt(db, Date.parse(closedAt));
  if (!row) return { status: "unknown", season: null };
  if (row.war_season_id !== warSeasonId)
    return {
      status: "mismatch",
      season: row.season_month,
      expected: row.war_season_id,
      got: warSeasonId,
    };
  if (!row.war_id_verified_at)
    await db.query(
      `update season set war_id_verified_at = $2
       where season_month = $1 and war_id_verified_at is null`,
      [row.season_month, new Date(closedAt)],
    );
  return { status: "verified", season: row.season_month };
}

/** One EMF line for the alarm (ElixirMCP/Record SeasonWarIdMismatch),
 *  the scheduler's metrics.mjs shape: stdout, one JSON object, no
 *  network. `write` is injectable. */
export function seasonMismatchEmf(mismatch, now = Date.now()) {
  return JSON.stringify({
    _aws: {
      Timestamp: now,
      CloudWatchMetrics: [
        {
          Namespace: "ElixirMCP/Record",
          Dimensions: [[]],
          Metrics: [{ Name: "SeasonWarIdMismatch", Unit: "Count" }],
        },
      ],
    },
    SeasonWarIdMismatch: 1,
    season_month: mismatch.season,
    expected: mismatch.expected,
    got: mismatch.got,
    clan_tag: mismatch.clan_tag ?? null,
  });
}

/**
 * A Player.progress key, split the way the API spells it: the month
 * form (`2v2League_202609`, `seasonal-trophy-road-202609`) carries the
 * season the record keys on; a mode that counts its own
 * (`AutoChess_2026_Season_11`) keeps its key verbatim and no month. The
 * empty key the payload carries is not a season.
 */
export function parseProgressKey(key) {
  const raw = String(key ?? "");
  if (!raw) return null;
  const month = /^(.+?)[-_](\d{4})(\d{2})$/.exec(raw);
  if (month && Number(month[3]) >= 1 && Number(month[3]) <= 12)
    return {
      progress_key: raw,
      mode: month[1],
      season_month: `${month[2]}-${month[3]}`,
    };
  const own = /^(.+?)_\d{4}_Season_\d+$/.exec(raw);
  return { progress_key: raw, mode: own ? own[1] : raw, season_month: null };
}

/** The profile projector's half: every progress key on the payload,
 *  first/last seen. last_seen_at is day-grained on purpose: a profile
 *  is polled every eight hours and the table is a few dozen rows, so a
 *  write per poll per key would be all churn; `changed` counts new keys
 *  only (a fact for the receipt), never the bump. */
export async function projectModeSeasons(db, { payload, fetchedAt }) {
  const keys = Object.keys(payload?.progress ?? {})
    .map(parseProgressKey)
    .filter(Boolean);
  let changed = 0;
  for (const k of keys) {
    if (k.season_month) await ensureSeason(db, k.season_month);
    const { rows } = await db.query(
      `insert into mode_season (progress_key, mode, season_month, first_seen_at, last_seen_at)
       values ($1, $2, $3, $4, $4)
       on conflict (progress_key) do update set
         last_seen_at = excluded.last_seen_at
       where mode_season.last_seen_at < excluded.last_seen_at - interval '1 day'
       returning (xmax = 0) as inserted`,
      [k.progress_key, k.mode, k.season_month, fetchedAt],
    );
    if (rows[0]?.inserted) changed += 1;
  }
  return { keys: keys.length, changed };
}
