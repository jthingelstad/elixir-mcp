import { RECORDED_PLAYERS_SQL } from "./tools/shared.mjs";

// The daily fetch series, every day or (bounded: $1, a UTC date) from
// that day on. The bound is the day's UTC midnight, so a bounded count
// covers each of its days in full.
const fetchesDailySql = (bounded = false) =>
  `select (r.fetched_at at time zone 'UTC')::date::text as day,
          count(*)::int as fetches,
          count(distinct r.gateway_id)::int as collectors
   from api_receipt r join gateway g on g.gateway_id = r.gateway_id
   where g.name <> 'backfill-elixir-bot'${
     bounded
       ? `\n     and r.fetched_at >= ($1::date::timestamp at time zone 'UTC')`
       : ""
   }
   group by 1 order by 1`;

export async function calculatePublicStats(db, { fetchesDaily } = {}) {
  const q = async (sql) => (await db.query(sql)).rows;
  const [totals] = await q(
    `select (select count(*)::int from battle) as battles,
          (select count(*)::int from player) as players,
          (select count(*)::int from clan) as clans,
          (select count(*)::int from war_week) as war_weeks,
          (select count(*)::int from player_snapshot_daily) as snapshots,
          (select min(battle_time) from battle) as oldest_battle,
          (select max(battle_time) from battle) as newest_battle,
          (select count(*)::int from gateway where status = 'active') as collectors_active,
          -- Recorded players as the tools count them: recorded
          -- directly or as a member of a comprehensively recorded
          -- clan. A player known only from a battle stub is a ghost
          -- entry and never the headline (Jamie, 2026-09-23).
          (select count(distinct player_tag)::int
           from (${RECORDED_PLAYERS_SQL}) rp) as players_recording,
          (select count(*) filter (where subject_type = 'clan')::int
           from recording where status = 'active') as clans_recording`,
  );
  const battlesDaily = await q(
    `select (battle_time at time zone 'UTC')::date::text as day,
          count(*)::int as battles
   from battle group by 1 order by 1`,
  );
  const observedDaily = await q(
    `select (first_seen_at at time zone 'UTC')::date::text as day,
          count(*)::int as players
   from player group by 1 order by 1`,
  );
  return {
    totals: {
      ...totals,
      oldest_battle: totals.oldest_battle?.toISOString() ?? null,
      newest_battle: totals.newest_battle?.toISOString() ?? null,
    },
    series: {
      battles_daily: battlesDaily,
      players_observed_daily: observedDaily,
      fetches_daily: fetchesDaily ?? (await q(fetchesDailySql())),
    },
    note: "Recorded history only - the corpus began 2026-09-03 plus imported archives; battle days predate observation days where archives were replayed.",
  };
}

// The fetch series is the one part of the snapshot that read all of
// api_receipt every hour (about 18,000 blocks from disk, 1.6 s; platform
// review 2026-10-21 §3). Receipts are only ever inserted: fetched_at and
// gateway_id never change, and nothing at runtime deletes one. So a day
// can only move when a receipt lands in it, and the hourly refresh
// recounts just the days the newest receipts fall in, from midnight,
// keeping the earlier days of the snapshot before.
//
// Which receipts are new is told by receipt_id, an identity: every id
// allocated after an instant is larger than every id visible at it. A
// receipt that was in flight at the last refresh may carry a smaller id
// than that refresh saw, so the recount starts from a mark at least
// MARK_MARGIN_MS older than the last refresh: no receipt transaction
// stays open that long (every writer is a Lambda, 15 minutes at most).
// The series is counted in full, as before, without such a mark; when
// the table's delete counter moved (a migration or an approved removal
// deleted receipts; a statistics reset moves it too); when the set of
// collectors the series leaves out changed (a gateway renamed to or from
// the backfill name); and once a day whatever the guards say, so a case
// none of them sees is never stale for longer than that.
const MARK_MARGIN_MS = 60 * 60_000;
const FULL_EVERY_MS = 24 * 60 * 60_000;
const MARKS_KEPT = 6;
const SERIES_STATE_VERSION = 1;

async function refreshFetchesDaily(db, previous) {
  const {
    rows: [now],
  } = await db.query(
    `select coalesce((select max(receipt_id) from api_receipt), 0)::text as through,
            (select n_tup_del from pg_stat_user_tables
              where relid = 'api_receipt'::regclass)::text as deleted,
            (select coalesce(string_agg(gateway_id::text, ',' order by gateway_id), '')
               from gateway where name = 'backfill-elixir-bot') as excluded,
            now() as at`,
  );
  const prevState = previous?.state?.fetches_daily;
  const prevSeries = previous?.payload?.series?.fetches_daily;
  const marks = Array.isArray(prevState?.marks) ? prevState.marks : [];
  let base = null;
  if (
    prevState?.version === SERIES_STATE_VERSION &&
    prevState.deleted === now.deleted &&
    prevState.excluded === now.excluded &&
    Date.parse(prevState.full_at) > now.at.getTime() - FULL_EVERY_MS &&
    Array.isArray(prevSeries) &&
    marks.length > 0
  ) {
    const lastAt = Date.parse(marks.at(-1).at);
    base =
      marks.filter((m) => Date.parse(m.at) <= lastAt - MARK_MARGIN_MS).at(-1) ??
      null;
  }
  let series;
  let recountedFrom = null;
  if (!base) {
    series = (await db.query(fetchesDailySql())).rows;
  } else {
    const {
      rows: [first],
    } = await db.query(
      `select (min(fetched_at) at time zone 'UTC')::date::text as day
       from api_receipt where receipt_id > $1::bigint`,
      [base.through],
    );
    recountedFrom = first.day;
    series = first.day
      ? [
          ...prevSeries.filter((r) => r.day < first.day),
          ...(await db.query(fetchesDailySql(true), [first.day])).rows,
        ]
      : prevSeries;
  }
  return {
    series,
    recountedFrom,
    full: !base,
    state: {
      version: SERIES_STATE_VERSION,
      deleted: now.deleted,
      excluded: now.excluded,
      full_at: base ? prevState.full_at : now.at.toISOString(),
      marks: [
        ...marks,
        { through: now.through, at: now.at.toISOString() },
      ].slice(-MARKS_KEPT),
    },
  };
}

/** The hourly snapshot (services/jobs): the same payload as
 *  calculatePublicStats, with the fetch series refreshed from `previous`
 *  (the stored row: { payload, state }) where it safely can be. Returns
 *  the payload to publish and the state to store beside it, never in it. */
export async function refreshPublicStats(db, previous = null) {
  const fetches = await refreshFetchesDaily(db, previous);
  const payload = await calculatePublicStats(db, {
    fetchesDaily: fetches.series,
  });
  return {
    payload,
    state: { fetches_daily: fetches.state },
    fetches_recounted: fetches.full ? "all" : fetches.recountedFrom,
  };
}

export async function readPublicStats(db) {
  const { rows } = await db.query(
    "select payload, updated_at from public_stats_cache where cache_key = 1 and updated_at > now() - interval '2 hours'",
  );
  if (rows[0])
    return { ...rows[0].payload, as_of: rows[0].updated_at.toISOString() };
  return {
    ...(await calculatePublicStats(db)),
    as_of: new Date().toISOString(),
  };
}
