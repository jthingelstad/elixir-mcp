/** Nightly battle-activity histogram per recorded player (0084).
 *
 *  Step one of adaptive polling (NOTES 2026-09-12): the record holds every
 *  battle timestamp, so a per-player 24x7 rhythm and a year of daily
 *  counts are a nightly rebuild, not a learner. Two readers: the console's
 *  activity graphic on each tracked player (today), and the battlelog
 *  scheduler's poll placement (after a week of histograms has been read
 *  against the capture audit - the scheduler does NOT read this yet).
 *
 *  Everything here is UTC (AGENTS.md: store UTC, timezone is display).
 *  The rhythm buckets are (isodow - 1) * 24 + hour, Monday 00:00Z first.
 *  Each battle adds 2^(-age_days / HALF_LIFE_DAYS): a battle four weeks
 *  old counts half, eight weeks a quarter, so a player whose evenings
 *  moved is read from where they play NOW without forgetting the rest.
 *
 *  Not-recorded days are the part that must never read as zero. A day is
 *  marked not recorded when the recorder itself says the record is
 *  incomplete: the UTC day of a capture-audit gap (a battle log that had
 *  rolled past the high-water mark before it was read), and every UTC
 *  day inside a profile-snapshot interval whose lifetime battle counter
 *  moved more than the battles captured (elixir_coverage's own rule,
 *  services/mcp/src/coverage.mjs, applied over the last SNAPSHOT_DAYS
 *  rather than seven). Days before recording began are the reader's to
 *  mark from recorded_from; storing them would make the row a copy of the
 *  recording table. Marks already stored are carried forward, so an
 *  interval that has aged out of the snapshot window keeps its mark until
 *  it leaves the year. */

import pg from "pg";

export const HALF_LIFE_DAYS = 28;
const WINDOW_DAYS = 365;
/** How far back the snapshot-interval rule is re-evaluated each night.
 *  Older marks are carried forward from the previous row. */
const SNAPSHOT_DAYS = 35;
export const BUCKETS = 7 * 24;

/** UTC calendar day of an instant, as YYYY-MM-DD. */
export function utcDay(at) {
  return new Date(at).toISOString().slice(0, 10);
}

/** Every UTC day from `from` to `to` inclusive (instants or day strings). */
export function daysBetween(from, to) {
  const out = [];
  const start = Date.UTC(
    ...utcDay(from)
      .split("-")
      .map((n, i) => Number(n) - (i === 1 ? 1 : 0)),
  );
  const end = Date.parse(utcDay(to) + "T00:00:00Z");
  for (let t = start; t <= end; t += 86_400_000) out.push(utcDay(t));
  return out;
}

async function recordedPlayers(db) {
  const { rows } = await db.query(
    `select subject_tag as player_tag, min(created_at) as recorded_from
       from recording where subject_type = 'player'
      group by subject_tag`,
  );
  return rows;
}

/** One row per (player, bucket): decayed weight and raw count. */
async function rhythmRows(db, tags, now) {
  const { rows } = await db.query(
    `select bp.player_tag,
            ((extract(isodow from bp.battle_time at time zone 'UTC')::int - 1) * 24
              + extract(hour from bp.battle_time at time zone 'UTC')::int) as bucket,
            count(*)::int as n,
            sum(power(2, - extract(epoch from ($1::timestamptz - bp.battle_time)) / 86400.0 / $2))::float8 as w,
            min(bp.battle_time) as first_at,
            max(bp.battle_time) as last_at,
            count(*) filter (where bp.battle_time > $1::timestamptz - interval '28 days')::int as n_28d
       from battle_participant bp
      where bp.player_tag = any($3::text[])
        and bp.battle_time > $1::timestamptz - make_interval(days => $4)
        and bp.battle_time <= $1::timestamptz
      group by 1, 2`,
    [now, HALF_LIFE_DAYS, tags, WINDOW_DAYS],
  );
  return rows;
}

/** One row per (player, UTC day) with at least one battle. */
async function dayRows(db, tags, now) {
  const { rows } = await db.query(
    `select bp.player_tag,
            to_char(bp.battle_time at time zone 'UTC', 'YYYY-MM-DD') as day,
            count(*)::int as n
       from battle_participant bp
      where bp.player_tag = any($1::text[])
        and bp.battle_time > $2::timestamptz - make_interval(days => $3)
        and bp.battle_time <= $2::timestamptz
      group by 1, 2`,
    [tags, now, WINDOW_DAYS],
  );
  return rows;
}

/** The UTC day of every capture-audit gap inside the window. */
async function gapDayRows(db, tags, now) {
  const { rows } = await db.query(
    `select subject_tag as player_tag,
            to_char(fetched_at at time zone 'UTC', 'YYYY-MM-DD') as day
       from capture_audit
      where gap and subject_tag = any($1::text[])
        and fetched_at > $2::timestamptz - make_interval(days => $3)
      group by 1, 2`,
    [tags, now, WINDOW_DAYS],
  );
  return rows;
}

/** Profile-snapshot intervals in the last SNAPSHOT_DAYS whose lifetime
 *  counter moved more than the battles captured: the coverage rule, set-
 *  based over every recorded player at once. */
async function incompleteIntervalRows(db, tags, now) {
  const { rows } = await db.query(
    `with s as (
       select player_tag, observed_at,
              lag(observed_at) over w as observed_from,
              (lifetime->>'battleCount')::int
                - lag((lifetime->>'battleCount')::int) over w as expected
         from player_snapshot_daily
        where snapshot_kind = 'daily' and player_tag = any($1::text[])
        window w as (partition by player_tag order by snapshot_date)
     )
     select s.player_tag, s.observed_from, s.observed_at as observed_to,
            s.expected,
            (select count(*)::int from battle_participant bp
              where bp.player_tag = s.player_tag
                and bp.battle_time > s.observed_from
                and bp.battle_time <= s.observed_at) as captured
       from s
      where s.observed_from is not null
        and s.observed_at > s.observed_from
        and s.observed_at > $2::timestamptz - make_interval(days => $3)
        and s.expected is not null and s.expected >= 0`,
    [tags, now, SNAPSHOT_DAYS],
  );
  // Comparable and short: the same test coverage.mjs applies before it
  // asserts anything.
  return rows.filter(
    (r) => r.captured <= r.expected && r.captured < r.expected,
  );
}

async function previousMarks(db, tags) {
  const { rows } = await db.query(
    `select player_tag, not_recorded_days from player_activity
      where player_tag = any($1::text[])`,
    [tags],
  );
  return new Map(rows.map((r) => [r.player_tag, r.not_recorded_days ?? []]));
}

/** Rebuild every recorded player's row. `now` is injectable for tests. */
export async function activityHistogram(
  databaseUrl,
  { now = new Date() } = {},
) {
  const started = Date.now();
  const at = new Date(now);
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const players = await recordedPlayers(db);
    const tags = players.map((p) => p.player_tag);
    const out = {
      players: players.length,
      with_battles: 0,
      not_recorded_days: 0,
      ms: 0,
    };
    if (tags.length === 0) return out;

    const rhythm = new Map();
    for (const r of await rhythmRows(db, tags, at)) {
      let p = rhythm.get(r.player_tag);
      if (!p) {
        p = {
          buckets: new Array(BUCKETS).fill(0),
          weight: 0,
          battles: 0,
          battles28: 0,
          first: null,
          last: null,
        };
        rhythm.set(r.player_tag, p);
      }
      p.buckets[r.bucket] = Number((p.buckets[r.bucket] + r.w).toFixed(4));
      p.weight += r.w;
      p.battles += r.n;
      p.battles28 += r.n_28d;
      if (!p.first || r.first_at < p.first) p.first = r.first_at;
      if (!p.last || r.last_at > p.last) p.last = r.last_at;
    }
    const days = new Map();
    for (const r of await dayRows(db, tags, at)) {
      if (!days.has(r.player_tag)) days.set(r.player_tag, {});
      days.get(r.player_tag)[r.day] = r.n;
    }
    const marks = new Map();
    const mark = (tag, day) => {
      if (!marks.has(tag)) marks.set(tag, new Set());
      marks.get(tag).add(day);
    };
    for (const r of await gapDayRows(db, tags, at)) mark(r.player_tag, r.day);
    for (const r of await incompleteIntervalRows(db, tags, at))
      for (const d of daysBetween(r.observed_from, r.observed_to))
        mark(r.player_tag, d);
    const floor = utcDay(at.getTime() - WINDOW_DAYS * 86_400_000);
    for (const [tag, prior] of await previousMarks(db, tags))
      for (const d of prior) if (d >= floor) mark(tag, d);

    for (const p of players) {
      const r = rhythm.get(p.player_tag);
      const d = days.get(p.player_tag) ?? {};
      // Never before recording began: those days are the reader's, from
      // recorded_from, and a mark there would double-count the rule.
      const from = p.recorded_from ? utcDay(p.recorded_from) : null;
      const notRecorded = [...(marks.get(p.player_tag) ?? [])]
        .filter((day) => from === null || day >= from)
        .sort();
      if (r) out.with_battles += 1;
      out.not_recorded_days += notRecorded.length;
      await db.query(
        `insert into player_activity
           (player_tag, computed_at, window_days, half_life_days, rhythm,
            rhythm_weight, rhythm_battles, days, not_recorded_days,
            recorded_from, first_battle_at, last_battle_at, battles_28d)
         values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::jsonb, $9::jsonb,
                 $10, $11, $12, $13)
         on conflict (player_tag) do update set
           computed_at = excluded.computed_at,
           window_days = excluded.window_days,
           half_life_days = excluded.half_life_days,
           rhythm = excluded.rhythm,
           rhythm_weight = excluded.rhythm_weight,
           rhythm_battles = excluded.rhythm_battles,
           days = excluded.days,
           not_recorded_days = excluded.not_recorded_days,
           recorded_from = excluded.recorded_from,
           first_battle_at = excluded.first_battle_at,
           last_battle_at = excluded.last_battle_at,
           battles_28d = excluded.battles_28d`,
        [
          p.player_tag,
          at,
          WINDOW_DAYS,
          HALF_LIFE_DAYS,
          JSON.stringify(r?.buckets ?? new Array(BUCKETS).fill(0)),
          Number((r?.weight ?? 0).toFixed(4)),
          r?.battles ?? 0,
          JSON.stringify(d),
          JSON.stringify(notRecorded),
          p.recorded_from,
          r?.first ?? null,
          r?.last ?? null,
          r?.battles28 ?? 0,
        ],
      );
    }
    out.ms = Date.now() - started;
    return out;
  } finally {
    await db.end();
  }
}
