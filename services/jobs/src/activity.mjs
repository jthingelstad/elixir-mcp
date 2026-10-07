/** Nightly battle-activity metadata per recorded player (0084).
 * First/last battle, a 28-day count and historical capture-audit marks remain
 * dated projections. The private console year reads canonical counts and
 * comparable observation intervals together; it does not use these cached
 * marks, tracking dates or poll success to establish quiet days.
 *
 * Marks cover a capture-audit gap's UTC date and profile intervals whose
 * lifetime counter moved more than captured battles. Older marks are carried
 * forward until they leave the year, so they are historical diagnostics, not
 * a current completeness answer. Everything here is UTC.
 *
 * The 24x7 rhythm retired 2026-09-19 after its proposed adaptive polling did
 * not place reads reliably; its columns went in 0150. */

import pg from "pg";

const WINDOW_DAYS = 365;
/** How far back the snapshot-interval rule is re-evaluated each night.
 *  Older marks are carried forward from the previous row. */
const SNAPSHOT_DAYS = 35;

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
    `select r.subject_tag as player_tag, min(r.created_at) as recorded_from
       from recording r where r.subject_type = 'player' and (
         (r.origin='claim' and exists(select 1 from account a where a.account_id=r.requested_by and a.kind in ('person','agent')))
         or (r.origin='ops' and r.status='active')
         or exists(select 1 from claim c join account a using(account_id) where c.player_tag=r.subject_tag and a.kind in ('person','agent'))
         or exists(select 1 from account_event e join account a using(account_id) where a.kind in ('person','agent') and e.kind in ('claim_added','tracked_by_ops','recording_started') and e.detail->>'player_tag'=r.subject_tag)
         or exists(select 1 from clan_membership m join account_clan f using(clan_tag) join account a using(account_id) where m.player_tag=r.subject_tag and m.left_observed_at is null and f.scope='comprehensive' and a.kind in ('person','agent'))
       ) group by r.subject_tag`,
  );
  return rows;
}

/** One row per player: the first and last battle in the window, and
 *  the count in the last 28 days. */
async function battleRows(db, tags, now) {
  const { rows } = await db.query(
    `select bp.player_tag,
            count(*)::int as n,
            min(bp.battle_time) as first_at,
            max(bp.battle_time) as last_at,
            count(*) filter (where bp.battle_time > $1::timestamptz - interval '28 days')::int as n_28d
       from battle_participant bp
      where bp.player_tag = any($2::text[])
        and bp.battle_time > $1::timestamptz - make_interval(days => $3)
        and bp.battle_time <= $1::timestamptz
      group by 1`,
    [now, tags, WINDOW_DAYS],
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
       select player_tag, profile_observed_at as observed_at,
              lag(profile_observed_at) over w as observed_from,
              battle_count - lag(battle_count) over w as expected
         from player_snapshot_daily
        where snapshot_kind = 'daily' and player_tag = any($1::text[])
          and profile_observed_at is not null
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
    `select player_tag,
            array(select to_char(d, 'YYYY-MM-DD') from unnest(not_recorded_days) as d) as not_recorded_days
       from player_activity
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

    const battles = new Map();
    for (const r of await battleRows(db, tags, at))
      battles.set(r.player_tag, {
        battles: r.n,
        battles28: r.n_28d,
        first: r.first_at,
        last: r.last_at,
      });
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
      const r = battles.get(p.player_tag);
      // Never before recording began: those days are the reader's, from
      // recorded_from, and a mark there would double-count the rule.
      const from = p.recorded_from ? utcDay(p.recorded_from) : null;
      const notRecorded = [...(marks.get(p.player_tag) ?? [])]
        .filter((day) => from === null || day >= from)
        .sort();
      if (r) out.with_battles += 1;
      out.not_recorded_days += notRecorded.length;
      // Typed (0123/0125): the not-recorded days as date[]. The year's
      // daily counts are the daily rollup, which the graphic's route
      // reads directly.
      await db.query(
        `insert into player_activity
           (player_tag, computed_at, window_days, not_recorded_days,
            recorded_from, first_battle_at, last_battle_at, battles_28d)
         values ($1, $2, $3, $4::date[], $5, $6, $7, $8)
         on conflict (player_tag) do update set
           computed_at = excluded.computed_at,
           window_days = excluded.window_days,
           not_recorded_days = excluded.not_recorded_days,
           recorded_from = excluded.recorded_from,
           first_battle_at = excluded.first_battle_at,
           last_battle_at = excluded.last_battle_at,
           battles_28d = excluded.battles_28d`,
        [
          p.player_tag,
          at,
          WINDOW_DAYS,
          notRecorded,
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
