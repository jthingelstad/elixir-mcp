/**
 * The daily series ops (time-series review, docs/reviews/2026-09-18-TIME-SERIES.md).
 *
 *   {snapshot_day_census: true}
 *     Read-only. For player_snapshot_daily under game_day(observed_at)
 *     (0126): how many rows change day and how many collide (two UTC-day
 *     rows onto one game day), per kind. The winner of a collision is
 *     always the mover: a poll before 10:00Z on UTC day D+1 is later
 *     than anything polled on UTC day D, so the earlier row is the one
 *     dropped. Run before {snapshot_rekey}; the numbers go in NOTES.
 *
 *   {snapshot_rekey: {after?: "#TAG", batch?: 500}}
 *     The re-key (review 3.2; Jamie 2026-09-17, decision 1): the
 *     snapshot's day becomes the game day. Keyset-batched per player,
 *     each batch its own short transaction: the rows whose day moves
 *     are deleted and reinserted under game_day(observed_at); where two
 *     land on one key the later observed_at wins and the earlier is
 *     dropped, which is the rule's own semantics (that poll would never
 *     have been kept). A row with no observed_at (written before 0038
 *     and never re-stamped: 2,995 live on 2026-09-17) is first stamped
 *     from the receipts - the last admitted profile fetch of that tag
 *     on that UTC day, which is the poll the pre-0038 last-wins rule
 *     kept - and moves like the rest; one with no such receipt stays
 *     where it is (reported). The caller passes `after` back until
 *     `done`. RDS snapshot first, as on 2026-09-15.
 */

import pg from "pg";

const MOVES = `observed_at is not null and game_day(observed_at) <> snapshot_date`;
/** The last admitted profile fetch of the row's tag on the row's UTC day:
 *  what wrote a pre-0038 row, by that era's rule. */
const RECEIPT_STAMP = `(select max(r.fetched_at) from api_receipt r
   where r.entity_key = s.player_tag and r.endpoint = 'player' and r.admission = 'admitted'
     and r.fetched_at >= s.snapshot_date::timestamp at time zone 'UTC'
     and r.fetched_at < (s.snapshot_date + 1)::timestamp at time zone 'UTC')`;

export async function snapshotDayCensus(databaseUrl) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query("set transaction_read_only = on");
    const { rows: byKind } = await db.query(
      `with target as (
         select player_tag, snapshot_kind, snapshot_date, observed_at,
                case when observed_at is null then snapshot_date
                     else game_day(observed_at) end as game_day
         from player_snapshot_daily),
       groups as (
         select snapshot_kind, player_tag, game_day,
                count(*)::int as n, max(observed_at) as winner_observed_at
         from target group by 1, 2, 3)
       select t.snapshot_kind,
              count(*)::int as rows,
              count(*) filter (where t.observed_at is null)::int as unkeyable,
              count(*) filter (where t.observed_at is not null and t.game_day <> t.snapshot_date)::int as moving,
              count(*) filter (where t.observed_at is not null and t.game_day = t.snapshot_date)::int as staying,
              (select count(*)::int from groups g where g.snapshot_kind = t.snapshot_kind and g.n > 1) as collisions,
              (select coalesce(sum(g.n - 1), 0)::int from groups g where g.snapshot_kind = t.snapshot_kind and g.n > 1) as dropped,
              min(t.snapshot_date)::text as first_day,
              max(t.snapshot_date)::text as last_day
       from target t
       group by t.snapshot_kind order by t.snapshot_kind`,
    );
    // Where in the day the moving rows were observed: a UTC day whose
    // last poll was before 10:00Z is the whole class.
    const { rows: hours } = await db.query(
      `select extract(hour from observed_at at time zone 'UTC')::int as utc_hour, count(*)::int as n
       from player_snapshot_daily where ${MOVES}
       group by 1 order by 1`,
    );
    const {
      rows: [totals],
    } = await db.query(
      `select count(*)::int as rows,
              count(distinct player_tag)::int as players,
              count(distinct player_tag) filter (where ${MOVES})::int as players_moving
       from player_snapshot_daily`,
    );
    // The unkeyable rows, and how many of them the receipts can stamp
    // (and of those, how many then move).
    const {
      rows: [unkeyable],
    } = await db.query(
      `select count(*)::int as unkeyable,
              count(stamp)::int as stampable,
              count(stamp) filter (where game_day(stamp) <> snapshot_date)::int as stampable_moving,
              min(snapshot_date)::text as first_day, max(snapshot_date)::text as last_day
       from (select s.snapshot_date, ${RECEIPT_STAMP} as stamp
             from player_snapshot_daily s where s.observed_at is null) u`,
    );
    return {
      ...totals,
      by_kind: byKind,
      moving_by_utc_hour: hours,
      unkeyable_rows: unkeyable,
    };
  } finally {
    await db.end();
  }
}

export async function snapshotRekey(databaseUrl, spec = {}) {
  const batch = Math.min(Math.max(Number(spec.batch ?? 500), 1), 5000);
  const after = typeof spec.after === "string" ? spec.after : "";
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  const started = Date.now();
  try {
    // Every column, read from the catalog, so the op is right for the
    // columns 0127 adds beside it and for any later ones.
    const { rows: cols } = await db.query(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'player_snapshot_daily'
       order by ordinal_position`,
    );
    const names = cols.map((c) => c.column_name);
    const insertCols = names.join(", ");
    const selectCols = names
      .map((c) => (c === "snapshot_date" ? "game_day(observed_at)" : c))
      .join(", ");
    const setCols = names
      .filter(
        (c) => !["player_tag", "snapshot_date", "snapshot_kind"].includes(c),
      )
      .map((c) => `${c} = excluded.${c}`)
      .join(", ");

    await db.query("begin");
    try {
      const { rows: players } = await db.query(
        `select distinct player_tag from player_snapshot_daily
         where player_tag > $1 order by player_tag limit $2`,
        [after, batch],
      );
      if (players.length === 0) {
        await db.query("rollback");
        return { players: 0, done: true, after, ms: Date.now() - started };
      }
      const tags = players.map((p) => p.player_tag);
      const last = tags[tags.length - 1];
      // Pre-0038 rows first: stamp what the receipts know.
      const { rowCount: stamped } = await db.query(
        `update player_snapshot_daily s set observed_at = ${RECEIPT_STAMP}
         where s.player_tag = any($1::text[]) and s.observed_at is null
           and ${RECEIPT_STAMP} is not null`,
        [tags],
      );
      // The rows that move, held aside for the transaction; then gone
      // from the table; then back under the game day, the later
      // observation winning among themselves and over any row already
      // on that key.
      await db.query(
        `create temp table snapshot_rekey_moved on commit drop as
         select * from player_snapshot_daily
         where player_tag = any($1::text[]) and ${MOVES}`,
        [tags],
      );
      const { rowCount: deleted } = await db.query(
        `delete from player_snapshot_daily s
         using snapshot_rekey_moved m
         where s.player_tag = m.player_tag and s.snapshot_date = m.snapshot_date
           and s.snapshot_kind = m.snapshot_kind`,
      );
      const { rows: outcome } = await db.query(
        `with winners as (
           select distinct on (player_tag, game_day(observed_at), snapshot_kind) *
           from snapshot_rekey_moved
           order by player_tag, game_day(observed_at), snapshot_kind, observed_at desc),
         placed as (
           insert into player_snapshot_daily (${insertCols})
           select ${selectCols} from winners
           on conflict (player_tag, snapshot_date, snapshot_kind) do update set ${setCols}
           where excluded.observed_at >= player_snapshot_daily.observed_at
              or player_snapshot_daily.observed_at is null
           returning (xmax = 0) as inserted)
         select (select count(*)::int from winners) as winners,
                count(*) filter (where inserted)::int as inserted,
                count(*) filter (where not inserted)::int as replaced
         from placed`,
      );
      await db.query("commit");
      const r = outcome[0];
      return {
        players: tags.length,
        stamped_from_receipts: stamped,
        moved: deleted,
        inserted: r.inserted,
        replaced_older_row: r.replaced,
        dropped: deleted - r.inserted - r.replaced,
        after: last,
        done: tags.length < batch,
        ms: Date.now() - started,
      };
    } catch (err) {
      await db.query("rollback").catch(() => {});
      throw err;
    }
  } finally {
    await db.end();
  }
}

/**
 * {series_status: {hours?: 1}} - read-only: the series tables' row
 * counts and day spans, the snapshot table split by writer (roster-only,
 * profile-only, both), and what the last N hours of admitted clan and
 * player receipts were worth (new_facts) now that a roster poll counts
 * the members that moved. The Phase 1 NOTES numbers and Phase 2's
 * before/after.
 */
export async function seriesStatus(databaseUrl, spec = {}) {
  const hours = Math.min(Math.max(Number(spec.hours ?? 1), 1), 168);
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query("set transaction_read_only = on");
    const {
      rows: [tables],
    } = await db.query(
      `select
         (select json_build_object('rows', count(*), 'clans', count(distinct clan_tag),
                 'first_day', min(day)::text, 'last_day', max(day)::text,
                 'kinds', (select json_object_agg(snapshot_kind, n) from
                           (select snapshot_kind, count(*)::int n from clan_snapshot_daily group by 1) k))
          from clan_snapshot_daily) as clan_snapshot_daily,
         (select json_build_object('rows', count(*), 'players', count(distinct player_tag),
                 'keys', count(distinct progress_key), 'first_day', min(day)::text, 'last_day', max(day)::text)
          from player_progress_daily) as player_progress_daily,
         (select json_build_object('rows', count(*), 'players', count(distinct player_tag),
                 'seasons', (select json_object_agg(season_month, n) from
                             (select season_month, count(*)::int n from player_pol_season group by 1) k))
          from player_pol_season) as player_pol_season,
         (select json_build_object('rows', count(*), 'clans', count(distinct clan_tag),
                 'sections', count(distinct (season_id, section_index)))
          from war_period_log) as war_period_log,
         (select json_build_object('rows', count(*),
                 'roster_only', count(*) filter (where clan_tag is not null and profile_observed_at is null),
                 'profile_only', count(*) filter (where clan_tag is null and profile_observed_at is not null),
                 'both', count(*) filter (where clan_tag is not null and profile_observed_at is not null),
                 'players', count(distinct player_tag),
                 'clans', count(distinct clan_tag),
                 'first_day', min(snapshot_date)::text, 'last_day', max(snapshot_date)::text,
                 'today_rows', count(*) filter (where snapshot_date = game_day(now())),
                 'today_roster_written', count(*) filter (where snapshot_date = game_day(now()) and clan_tag is not null))
          from player_snapshot_daily) as player_snapshot_daily,
         (select json_build_object('war_week_clan_with_score', count(*) filter (where clan_score is not null),
                 'war_week_clan_rows', count(*)) from war_week_clan) as war_week_clan,
         (select json_build_object('with_repairs', count(*) filter (where repair_points is not null),
                 'rows', count(*)) from war_participation) as war_participation,
         (select json_build_object('type', count(type), 'location', count(location_id), 'rows', count(*)) from clan) as clan_state,
         (select json_build_object('frozen', count(war_day_wins), 'rows', count(*)) from player) as player_state,
         (select json_build_object('keys', count(*), 'empty_key', count(*) filter (where progress_key = '')) from mode_season) as mode_season`,
    );
    const { rows: receipts } = await db.query(
      `select endpoint, count(*)::int as receipts,
              count(*) filter (where new_facts > 0)::int as with_facts,
              coalesce(sum(new_facts), 0)::int as facts,
              max(new_facts)::int as max_facts,
              round(avg(new_facts), 2)::float as avg_facts,
              round(avg(ingest_ms))::int as avg_ingest_ms,
              max(ingest_ms)::int as max_ingest_ms
       from api_receipt
       where admission = 'admitted' and fetched_at >= now() - make_interval(hours => $1)
         and endpoint in ('clan', 'player', 'currentriverrace', 'riverracelog')
       group by endpoint order by endpoint`,
      [hours],
    );
    return { hours, ...tables, receipts };
  } finally {
    await db.end();
  }
}
