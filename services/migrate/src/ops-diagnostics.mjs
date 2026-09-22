import pg from "pg";

/** Read-only ops stats ({stats: true}) — the admin/ops query path from
 *  DESIGN §7: counts only, no row data, safe to invoke any time. */
export async function stats(databaseUrl) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const counts = {};
    for (const [key, sql] of Object.entries({
      accounts: `select count(*)::int n from account`,
      recordings: `select count(*)::int n from recording where status = 'active'`,
      players: `select count(*)::int n from player`,
      open_memberships: `select count(*)::int n from clan_membership where left_observed_at is null`,
      battles: `select count(*)::int n from battle`,
      snapshots: `select count(*)::int n from player_snapshot_daily`,
      war_weeks: `select count(*)::int n from war_week`,
      war_participation: `select count(*)::int n from war_participation`,
      war_anchors: `select count(*)::int n from war_period_anchor`,
      receipts_by_endpoint: `select json_object_agg(endpoint, n) n from (
         select endpoint, count(*)::int n from api_receipt group by endpoint) x`,
      // Keep the boards objective on its approved read path: no production
      // SQL from an operator shell just to establish that every daily board
      // landed, that the reset tick was singular, and that ranking presence
      // is still holding its promised field.
      ranking_health: `with latest as (
         select distinct on (b.location_key) b.location_key,
                greatest(s.observed_at, s.last_confirmed_at) as confirmed_at,
                s.observed_at, s.last_confirmed_at, s.entries, s.truncated
         from ranking_board b
         left join ranking_snapshot s
           on s.board = b.board and s.location_key = b.location_key
         where b.board = 'pol' and b.enabled
         order by b.location_key, s.observed_at desc nulls last
       ), locations as (
         select * from latest where location_key <> 'global'
       )
       select json_build_object(
         'enabled_locations', (select count(*)::int from locations),
         'fresh_locations', (select count(*)::int from locations
           where confirmed_at >= now() - interval '26 hours'),
         'stale_locations', (select count(*)::int from locations
           where confirmed_at is null or confirmed_at < now() - interval '26 hours'),
         'global_tick_receipts', (select count(*)::int from api_receipt
           where endpoint = 'rankings_pol' and entity_key = 'global'
             and fetched_at >= date_trunc('day', now()) + interval '10 hours'
             and fetched_at < date_trunc('day', now()) + interval '10 hours 15 minutes'),
         'ranking_recordings', (select count(*)::int from recording
           where status = 'active' and origin = 'ranking'),
         'global_snapshot', (select json_build_object(
           'observed_at', observed_at,
           'unchanged_until', last_confirmed_at,
           'entries', entries,
           'truncated', truncated)
           from latest where location_key = 'global')
       ) n`,
      audit_calls: `select count(*)::int n from mcp_call_audit`,
      // The collector-side filter's effect, last hour (0074): polls that
      // carried counts, what they saw, what never crossed the wire.
      battlelog_filter_last_hour: `select json_build_object(
           'polls', count(*)::int,
           'observed', coalesce(sum(observed), 0)::int,
           'filtered', coalesce(sum(filtered), 0)::int,
           'nothing_new', count(*) filter (where filtered = observed)::int,
           'gaps', count(*) filter (where filtered = 0 and observed > 0)::int) n
         from api_receipt
         where endpoint = 'player_battlelog' and observed is not null
           and fetched_at > now() - interval '1 hour'`,
      // A non-200 has no API receipt by definition. Keep its operational
      // aggregate beside normal receipt counts so an owner can distinguish an
      // upstream refusal from a collector/result-boundary failure without
      // payload access or a hand query against production.
      fetch_errors_24h: `select json_build_object(
           'total', coalesce(sum((row->>'count')::int), 0)::int,
           'by_endpoint', coalesce(json_agg(row order by (row->>'count')::int desc,
                                              row->>'endpoint'), '[]'::json)) n
         from (
           select json_build_object(
             'endpoint', endpoint,
             'count', sum(error_count)::int,
             'outcomes', json_agg(json_build_object(
               'http_status', http_status,
               'kind', error_kind,
               'count', error_count) order by error_count desc, http_status, error_kind)) as row
           from (
             select endpoint, coalesce(http_status::text, 'none') as http_status,
                    error_kind, count(*)::int as error_count
             from collector_fetch_error
             where recorded_at > now() - interval '24 hours'
             group by endpoint, http_status, error_kind
           ) grouped
           group by endpoint
         ) by_endpoint`,
    })) {
      counts[key] = (await db.query(sql)).rows[0].n;
    }
    return counts;
  } finally {
    await db.end();
  }
}

/**
 * Where the database's weight and churn are ({tables: true}): every user
 * table's size (heap, indexes, TOAST), its cumulative row churn since the
 * stats were last reset, live/dead tuples, and the settings that bound
 * memory. IAM-only, read-only, no payloads. Added 2026-09-11 when the
 * t4g.micro swapped itself into an unplanned recovery and the question
 * was WHICH load, not whether.
 */
export async function tables(databaseUrl) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const { rows } = await db.query(`
      select s.relname as table_name,
             pg_total_relation_size(s.relid) as total_bytes,
             pg_relation_size(s.relid) as heap_bytes,
             pg_indexes_size(s.relid) as index_bytes,
             coalesce(pg_total_relation_size(c.reltoastrelid), 0) as toast_bytes,
             s.n_live_tup as live_rows, s.n_dead_tup as dead_rows,
             s.n_tup_ins as inserted, s.n_tup_upd as updated, s.n_tup_del as deleted,
             s.n_tup_hot_upd as hot_updated,
             s.seq_scan, s.seq_tup_read, s.idx_scan,
             s.last_autovacuum, s.last_autoanalyze
      from pg_stat_user_tables s
      join pg_class c on c.oid = s.relid
      order by pg_total_relation_size(s.relid) desc`);
    const { rows: settings } = await db.query(`
      select name, setting, unit from pg_settings
      where name in ('shared_buffers', 'work_mem', 'maintenance_work_mem',
                     'effective_cache_size', 'max_connections', 'autovacuum_work_mem',
                     'wal_buffers', 'temp_buffers')`);
    const { rows: reset } = await db.query(
      `select stats_reset from pg_stat_database where datname = current_database()`,
    );
    const { rows: dbsize } = await db.query(
      `select pg_database_size(current_database()) as bytes`,
    );
    return {
      database_bytes: Number(dbsize[0].bytes),
      stats_since: reset[0]?.stats_reset ?? null,
      settings: Object.fromEntries(
        settings.map((r) => [
          r.name,
          r.unit ? `${r.setting} ${r.unit}` : r.setting,
        ]),
      ),
      tables: rows.map((r) =>
        Object.fromEntries(
          Object.entries(r).map(([k, v]) => [
            k,
            typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v,
          ]),
        ),
      ),
    };
  } finally {
    await db.end();
  }
}

/**
 * Ledger incident reader and recovery ({ledger: {op, job_ids?}}).
 *
 * Dead jobs are the collector path's durable DLQ. An operator must be able to
 * inspect their exact receipts before deciding to requeue them, and recovery
 * must name those receipts rather than sweeping every historical failure.
 * This IAM-only operation exposes no payloads or credentials. Requeueing is
 * deliberately guarded against a queued twin, preserves the original job id,
 * and resets the exhausted lease-attempt counter for a fresh delivery cycle.
 * A named redundant dead row may instead be folded only if a queued or leased
 * twin currently carries the same work, or a newer twin is done with a
 * stamped receipt; it can never erase an uncovered job.
 */
export async function ledger(databaseUrl, spec = {}) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const op = String(spec.op ?? "dead");
    if (op === "dead") {
      const { rows } = await db.query(
        `select j.job_id, j.endpoint, j.entity_key, j.lane, j.attempts,
                j.created_at, j.leased_at, j.done_at,
                g.name as gateway_name, g.card_name as gateway_card_name
         from job j
         left join gateway g on g.gateway_id = j.leased_by
         where j.status = 'dead'
         order by j.done_at, j.job_id`,
      );
      return { dead: rows };
    }

    if (op === "requeue") {
      const jobIds = [...new Set(spec.job_ids ?? [])]
        .map((id) => String(id))
        .filter((id) => /^[1-9][0-9]*$/.test(id));
      if (jobIds.length === 0 || jobIds.length > 100)
        return { error: "job_ids must contain 1 to 100 positive integers" };

      const { rows } = await db.query(
        `with recoverable as (
           select j.job_id
           from job j
           where j.job_id = any($1::bigint[])
             and j.status = 'dead'
             and not exists (
               select 1 from job queued
               where queued.endpoint = j.endpoint
                 and queued.entity_key = j.entity_key
                 and queued.status = 'queued')
         )
         update job j
         set status = 'queued', attempts = 0, leased_at = null,
             leased_by = null, done_at = null
         from recoverable r
         where j.job_id = r.job_id
         returning j.job_id, j.endpoint, j.entity_key, j.lane`,
        [jobIds],
      );
      return {
        requested: jobIds.length,
        requeued: rows,
        skipped: jobIds.filter(
          (id) => !rows.some((row) => String(row.job_id) === id),
        ),
      };
    }

    if (op === "fold") {
      const jobIds = [...new Set(spec.job_ids ?? [])]
        .map((id) => String(id))
        .filter((id) => /^[1-9][0-9]*$/.test(id));
      if (jobIds.length === 0 || jobIds.length > 100)
        return { error: "job_ids must contain 1 to 100 positive integers" };

      const { rows } = await db.query(
        `with redundant as (
           select j.job_id
           from job j
           where j.job_id = any($1::bigint[])
             and j.status = 'dead'
             and exists (
               select 1 from job twin
               where twin.job_id <> j.job_id
                 and twin.endpoint = j.endpoint
                 and twin.entity_key = j.entity_key
                 and (
                   twin.status in ('queued', 'leased')
                   or (
                     twin.status = 'done'
                     and twin.created_at >= j.created_at
                     and exists (
                       select 1 from api_receipt receipt
                       where receipt.job_id = twin.job_id
                     )
                   )
                 )
             )
         )
         update job j
         set status = 'done', done_at = now()
         from redundant r
         where j.job_id = r.job_id
         returning j.job_id, j.endpoint, j.entity_key, j.lane`,
        [jobIds],
      );
      return {
        requested: jobIds.length,
        folded: rows,
        skipped: jobIds.filter(
          (id) => !rows.some((row) => String(row.job_id) === id),
        ),
      };
    }

    return { error: "ledger op must be dead, requeue, or fold" };
  } finally {
    await db.end();
  }
}

/**
 * War-reset drift census ({war_drift: true}) — read-only.
 *
 * Supercell's policy reset is 10:00 UTC, but clans are matched into
 * races of five as matchmaking fills, so each clan's periods start a
 * little off the policy hour and the offset differs per clan. This
 * measures the offset we actually observe, per clan, from
 * war_period_anchor.
 *
 * CAVEAT the numbers cannot escape: first_observed_at is when the
 * RECORDER first saw the period open, so every offset here is
 * (true drift + polling latency) and is an UPPER bound on the drift.
 * riverrace polling is cadence-driven, so a clan we poll less often
 * looks like it drifts more. Read the spread across clans, not any
 * single clan's number.
 */
/** The war_week rows whose observed start lies outside their season's
 *  bounds by more than an hour, with the season of the start, the
 *  counts under the key and the sibling under the season of the start.
 *  ONE text for the census and {war_week_rekey_repair}, so the repair
 *  acts on exactly the rows the census reports. Ordered newest first. */
export const OUTSIDE_SEASON_WEEKS_SQL = `select w.clan_tag, w.season_id, w.section_index, w.is_colosseum,
              w.started_observed_at, w.finished_observed_at, w.closed_at,
              s.season_month, s.starts_at, s.ends_at,
              (select s2.war_season_id from season s2
                where s2.starts_at <= w.started_observed_at and s2.ends_at > w.started_observed_at) as season_of_start,
              (select s2.sections from season s2
                where s2.starts_at <= w.started_observed_at and s2.ends_at > w.started_observed_at) as sections_of_start,
              (select count(*)::int from war_participation p
                where p.clan_tag = w.clan_tag and p.season_id = w.season_id
                  and p.section_index = w.section_index) as participants,
              (select count(*)::int from war_week_clan c
                where c.clan_tag = w.clan_tag and c.season_id = w.season_id
                  and c.section_index = w.section_index) as standings,
              (select count(*)::int from war_period_log l
                where l.clan_tag = w.clan_tag and l.season_id = w.season_id
                  and l.section_index = w.section_index) as period_logs,
              (select count(*)::int from war_attendance_day a
                where a.clan_tag = w.clan_tag and a.season_id = w.season_id
                  and a.section_index = w.section_index) as attendance,
              -- The row this one duplicates when the season of its start
              -- already has the same section for the clan.
              exists (select 1 from war_week w2
                       where w2.clan_tag = w.clan_tag and w2.section_index = w.section_index
                         and w2.season_id = (select s2.war_season_id from season s2
                                              where s2.starts_at <= w.started_observed_at
                                                and s2.ends_at > w.started_observed_at)) as sibling_in_season_of_start,
              (select min(r.fetched_at) from api_receipt r
                where r.endpoint = 'currentriverrace' and r.entity_key = w.clan_tag
                  and r.fetched_at >= w.started_observed_at - interval '1 minute'
                  and r.fetched_at <= w.started_observed_at + interval '1 minute') as receipt_at
         from war_week w
         join season s on s.war_season_id = w.season_id
        where w.started_observed_at is not null
          and (w.started_observed_at < s.starts_at - interval '1 hour'
               or w.started_observed_at >= s.ends_at + interval '1 hour')
        order by w.started_observed_at desc, w.clan_tag
        limit 200`;

/** {war_week_season_census: true} (Phase 5, 2026-09-19): war_week rows
 *  whose observed start lies outside their season's bounds (the season
 *  row keyed by the war number), with the writers that could have keyed
 *  them, so a mis-keyed week is a count and a list, not a Phase 4
 *  observation. Read-only; the repair is {war_week_rekey_repair}. */
export async function warWeekSeasonCensus(databaseUrl) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const { rows: totals } = await db.query(
      `select count(*)::int as war_weeks,
              count(*) filter (where w.started_observed_at is null)::int as unstarted,
              count(*) filter (where s.war_season_id is null)::int as no_season_row
         from war_week w
         left join season s on s.war_season_id = w.season_id`,
    );
    const { rows } = await db.query(OUTSIDE_SEASON_WEEKS_SQL);
    return {
      ...totals[0],
      outside_season: rows.length,
      rows: rows.map((r) => ({
        ...r,
        started_observed_at: r.started_observed_at?.toISOString() ?? null,
        finished_observed_at: r.finished_observed_at?.toISOString() ?? null,
        closed_at: r.closed_at?.toISOString() ?? null,
        starts_at: r.starts_at.toISOString(),
        ends_at: r.ends_at.toISOString(),
      })),
    };
  } finally {
    await db.end();
  }
}

export async function warDrift(databaseUrl) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    // Offset in minutes from the 10:00Z policy hour, normalized into
    // (-720, +720] so an anchor just BEFORE the hour reads negative
    // rather than as nearly a full day late.
    const offset = `((extract(epoch from (first_observed_at - date_trunc('day', first_observed_at)))/60
                      - 600 + 720)::int % 1440) - 720`;
    const { rows: perClan } = await db.query(
      `select clan_tag, count(*)::int as anchors,
              min(${offset})::int as min_off_min,
              max(${offset})::int as max_off_min,
              round(percentile_cont(0.5) within group (order by ${offset}))::int as median_off_min
       from war_period_anchor group by clan_tag order by clan_tag`,
    );
    const { rows: overall } = await db.query(
      `select count(*)::int as anchors,
              count(distinct clan_tag)::int as clans,
              min(${offset})::int as min_off_min,
              max(${offset})::int as max_off_min,
              round(percentile_cont(0.5) within group (order by ${offset}))::int as median_off_min,
              round(percentile_cont(0.9) within group (order by ${offset}))::int as p90_off_min
       from war_period_anchor`,
    );
    return {
      note: "Offsets are minutes from the 10:00Z policy reset and INCLUDE polling latency, so they are an upper bound on true drift.",
      overall: overall[0],
      per_clan: perClan,
    };
  } finally {
    await db.end();
  }
}

/** Capture completeness census ({capture_audit: {days?}}): identify the
 * subjects behind battlelog-window gaps, together with the scheduler state
 * needed to distinguish an individual cadence problem from fleet pressure.
 * This is a private, read-only ops reader; public status intentionally keeps
 * only the aggregate. */
export async function captureAudit(databaseUrl, spec) {
  const days = Math.min(Math.max(Number(spec?.days ?? 1), 1), 30);
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const { rows: totals } = await db.query(
      `select count(*)::int as polls,
              count(*) filter (where gap)::int as gaps
       from capture_audit
       where fetched_at > now() - make_interval(days => $1)`,
      [days],
    );
    const { rows: subjects } = await db.query(
      `select ca.subject_tag,
              count(*)::int as polls,
              count(*) filter (where ca.gap)::int as gaps,
              min(ca.fetched_at) filter (where ca.gap) as first_gap_at,
              max(ca.fetched_at) filter (where ca.gap) as last_gap_at,
              max(ca.fetched_at) as last_audited_at,
              max(ps.last_planned_at) as last_planned_at,
              max(ps.last_admitted_at) as last_admitted_at
       from capture_audit ca
       left join poll_state ps
         on ps.subject_tag = ca.subject_tag
        and ps.endpoint = 'player_battlelog'
       where ca.fetched_at > now() - make_interval(days => $1)
       group by ca.subject_tag
       having count(*) filter (where ca.gap) > 0
       order by gaps desc, last_gap_at desc, ca.subject_tag`,
      [days],
    );
    return { days, ...totals[0], gaps_by_subject: subjects };
  } finally {
    await db.end();
  }
}

/** Read-only yield census ({probe: true}) — hourly fetch volume vs
 *  battles actually harvested, live gateways only (the backfill gateway
 *  is history, not capture). Counts only, no row data; this is how the
 *  monitoring loop measures fetch efficiency across scheduler modes. */
export async function probe(databaseUrl) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const { rows } = await db.query(
      `with fetches as (
         select date_trunc('hour', r.fetched_at) as h,
                count(*) filter (where r.endpoint = 'player_battlelog')::int as battlelog,
                count(distinct r.entity_key)
                  filter (where r.endpoint = 'player_battlelog')::int as battlelog_subjects,
                count(*) filter (where r.endpoint = 'player')::int as player,
                count(*) filter (where r.endpoint in
                  ('currentriverrace', 'riverracelog', 'clan'))::int as clan_war,
                count(*)::int as fetches
         from api_receipt r
         join gateway g on g.gateway_id = r.gateway_id
         where r.fetched_at > now() - interval '48 hours'
           and g.name <> 'backfill-elixir-bot'
         group by 1),
       harvests as (
         select date_trunc('hour', created_at) as h,
                count(*)::int as battles
         from battle
         where created_at > now() - interval '48 hours'
         group by 1)
       select to_char(h at time zone 'UTC', 'MM-DD"T"HH24"Z"') as hour,
              coalesce(f.battlelog, 0) as battlelog,
              coalesce(f.battlelog_subjects, 0) as battlelog_subjects,
              coalesce(f.player, 0) as player,
              coalesce(f.clan_war, 0) as clan_war,
              coalesce(f.fetches, 0) as fetches,
              coalesce(v.battles, 0) as battles
       from fetches f
       full join harvests v using (h)
       order by h`,
    );
    // War calendar census (0105): the week's war battles by the day
    // their battle_time falls on; UNRESOLVED means a war battle outside
    // every war_period row, which the seed and the scheduler make
    // impossible and which would starve the war readers if it happened.
    const { rows: stamps } = await db.query(
      `select coalesce(p.war_season_id::text, 'UNRESOLVED') as season,
              p.section_index, p.war_day, count(*)::int as battles
       from battle b
       left join war_period p
         on b.battle_time >= p.starts_at and b.battle_time < p.ends_at
       where (b.type like 'riverRace%' or b.type = 'boatBattle')
         and b.battle_time > now() - interval '7 days'
       group by 1, 2, 3 order by 1, 2, 3`,
    );
    // Level-economics data support (META-INTEL follow-on): how much of
    // the corpus carries BOTH sides' per-card levels, and what the
    // level-gap distribution looks like. Decks store slim cards with
    // display-scale levels; duels (rounds) and deckless rows excluded.
    // BOUNDED to the last 24 hours of battles (battle_time_idx, then PK
    // lookups): the unbounded form expanded every deck in
    // battle_participant on every call, ~2 minutes at 500 read IOPS, and
    // thirteen calls in 25 minutes on 2026-09-11 preceded the 14:02Z RDS
    // memory recovery. A census is a sample, not a scan.
    const { rows: levels } = await db.query(
      `with sides as (
         select bp.battle_id,
                avg(pc.level::numeric) filter (where bp.side = 0) as lvl0,
                avg(pc.level::numeric) filter (where bp.side = 1) as lvl1
         from battle b
         join battle_participant bp on bp.battle_id = b.battle_id
         join battle_participant_card pc
           on pc.battle_id = bp.battle_id and pc.player_tag = bp.player_tag
          and pc.round = 0 and pc.slot > 0
         where b.battle_time > now() - interval '24 hours'
           and bp.deck_hash is not null
         group by bp.battle_id)
       select count(*)::int as battles_with_both_side_levels,
              (select count(*)::int from battle
                where battle_time > now() - interval '24 hours') as battles_total,
              round(avg(abs(lvl0 - lvl1))::numeric, 2) as mean_abs_level_gap,
              round(percentile_cont(0.5) within group (order by abs(lvl0 - lvl1))::numeric, 2) as median_abs_level_gap,
              round(percentile_cont(0.9) within group (order by abs(lvl0 - lvl1))::numeric, 2) as p90_abs_level_gap
       from sides where lvl0 is not null and lvl1 is not null`,
    );
    // War-rivals data support: how many DISTINCT rival clans the corpus
    // already fingerprints, at what depth (races observed per rival),
    // deduped across observers (two of our clans sharing a bracket see
    // the same race twice).
    const { rows: rivals } = await db.query(
      `with races as (
         select distinct season_id, section_index, participant_clan_tag, fame
         from war_week_clan
         where participant_clan_tag not in
           (select subject_tag from recording where subject_type = 'clan'))
       select count(distinct participant_clan_tag)::int as rival_clans_observed,
              count(*)::int as rival_race_rows,
              (select count(*)::int from (
                 select participant_clan_tag from races
                 group by participant_clan_tag having count(*) >= 3) x)
                as rivals_with_3plus_races
       from races`,
    );
    // The ledger's last day, by kind: what the timeline has to show.
    const { rows: feed } = await db.query(
      `select event_type, count(*)::int as rows
         from (select event_type, window_end from player_event
               union all
               select event_type, window_end from clan_event) x
        where window_end > now() - interval '24 hours'
        group by event_type order by event_type`,
    );
    // Pros-collection capture ramp: recording coverage and 24h battle
    // flow for every member of the 'pros' collection.
    const { rows: pros } = await db.query(
      `select count(*)::int as members,
              count(*) filter (where r.subject_tag is not null)::int as recording,
              count(*) filter (where b24.n > 0)::int as active_24h,
              coalesce(sum(b24.n), 0)::int as battles_24h
       from collection c
       join collection_member m on m.collection_id = c.collection_id
       left join recording r on r.subject_type = 'player'
         and r.subject_tag = m.subject_tag and r.status = 'active'
       left join lateral (
         select count(*)::int as n from battle_participant bp
         join battle b on b.battle_id = bp.battle_id
         where bp.player_tag = m.subject_tag
           and b.battle_time > now() - interval '24 hours') b24 on true
       where c.slug = 'pros'`,
    );
    return {
      hours: rows,
      war_calendar_7d: stamps,
      level_census: { window: "24h", ...levels[0] },
      rival_census: rivals[0],
      ledger_census: feed,
      pros_census: pros[0],
    };
  } finally {
    await db.end();
  }
}

/** Read-only storage census for the DB audit ({inspect: true}). */
export async function inspect(databaseUrl) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const tables = (
      await db.query(
        `select relname,
                pg_size_pretty(pg_total_relation_size(relid)) as total,
                pg_total_relation_size(relid) as bytes,
                n_live_tup, n_dead_tup, seq_scan, idx_scan,
                autovacuum_count, autoanalyze_count
         from pg_stat_user_tables
         order by pg_total_relation_size(relid) desc`,
      )
    ).rows;
    const indexes = (
      await db.query(
        `select relname as table, indexrelname as index,
                pg_size_pretty(pg_relation_size(indexrelid)) as size,
                idx_scan
         from pg_stat_user_indexes
         order by pg_relation_size(indexrelid) desc limit 25`,
      )
    ).rows;
    const dbsize = (
      await db.query(
        `select pg_size_pretty(pg_database_size(current_database())) s`,
      )
    ).rows[0].s;
    return { database_size: dbsize, tables, indexes };
  } finally {
    await db.end();
  }
}

/** Read-only session census ({sessions: true}): every session row of the
 *  last 30 days by account (email ref only), with when it was minted, last
 *  seen, and whether it is live, expired or revoked. No tokens, no
 *  addresses. How "why do I keep signing in?" gets a factual answer. */
export async function sessions(databaseUrl) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const { rows } = await db.query(
      `select left(a.email_hash, 8) as account, a.role,
              s.created_at, s.last_seen_at, s.sliding_expires_at, s.absolute_expires_at, s.revoked_at,
              case when s.revoked_at is not null then 'revoked'
                   when s.sliding_expires_at < now() then 'idle_expired'
                   when s.absolute_expires_at < now() then 'capped'
                   else 'live' end as state
       from session s join account a on a.account_id = s.account_id
       where s.created_at > now() - interval '30 days'
       order by a.email_hash, s.created_at`,
    );
    return { sessions: rows };
  } finally {
    await db.end();
  }
}

/**
 * EXPLAIN ANALYZE the clans_participation reads for one clan
 * ({explain_participation: {clan_tag, weeks}}), read-only. The SQL is
 * the tool's own (services/mcp/src/participation-sql.mjs), so the
 * plan read here is the plan being served. Added 2026-09-13 when every
 * slow page in Elixir Clan turned out to be this one call (8.7 s for a
 * week, 20 s for eight) and there was no other way to see why.
 */
export async function explainParticipation(databaseUrl, spec = {}) {
  const [{ MEMBERS_SQL, participationQueries }, { typesForModeGroup }] =
    await Promise.all([
      import("../../mcp/src/participation-sql.mjs"),
      import("@elixir-mcp/contracts"),
    ]);
  const clanTag = String(spec.clan_tag ?? "#J2RGCRVG").toUpperCase();
  const weeks = Math.min(8, Math.max(1, Number(spec.weeks ?? 8)));
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query("set statement_timeout = 120000");
    const out = [];
    const explain = async (name, text, values) => {
      const started = Date.now();
      const { rows } = await db.query(
        `explain (analyze, buffers, format text) ${text}`,
        values,
      );
      out.push({
        name,
        ms: Date.now() - started,
        plan: rows.map((r) => r["QUERY PLAN"]).join("\n"),
      });
    };
    await explain("members", MEMBERS_SQL, [clanTag]);
    const members = await db.query(MEMBERS_SQL, [clanTag]);
    const tags = members.rows.map((m) => m.player_tag);
    const now = new Date();
    const day = now.getUTCDay() || 7;
    const monday = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() - (day - 1),
      ),
    );
    const from = new Date(monday.getTime() - (weeks - 1) * 7 * 86400_000);
    const queries = participationQueries({
      clanTag,
      tags,
      from,
      rankedTypes: typesForModeGroup("ranked"),
    });
    for (const q of queries) await explain(q.name, q.text, q.values);
    // Why the planner may decline the covering index (2026-09-16, Clan
    // pages at 8 s): the fraction of participant pages the visibility
    // map calls all-visible, which is what prices an index-only scan,
    // and the same first read with the bitmap and sequential paths
    // closed so the index-only plan's real time is on record beside it.
    const { rows: vis } = await db.query(
      `select relname, relpages, relallvisible, reltuples::bigint as reltuples
         from pg_class where relname in ('battle_participant', 'battle')`,
    );
    const forced = queries[0];
    await db.query("set enable_bitmapscan = off");
    await db.query("set enable_seqscan = off");
    await explain(
      `${forced.name} (index paths only)`,
      forced.text,
      forced.values,
    );
    return {
      clan_tag: clanTag,
      weeks,
      members: tags.length,
      from,
      visibility: vis,
      queries: out,
    };
  } finally {
    await db.end();
  }
}

/** Tables the vacuum op may name. A closed list: the op takes a table
 *  name into SQL, and it is the only maintenance op that writes. */
const VACUUMABLE = new Set([
  "battle",
  "battle_participant",
  "battle_participant_card",
  "player_snapshot_daily",
]);

/**
 * VACUUM (ANALYZE) one named table ({vacuum: {table}}), so its
 * visibility map is rebuilt and the planner can take an index-only scan
 * again. Added 2026-09-16 when battle_participant had relallvisible = 0
 * after the 0091-0100 backfills and every Elixir Clan page paid 7 s of
 * heap I/O for it (0103 has the story). VACUUM cannot run inside a
 * migration's transaction, hence an op. Reports the map before and
 * after; touches no row.
 */
export async function vacuum(databaseUrl, spec = {}) {
  const table = String(spec.table ?? "");
  if (!VACUUMABLE.has(table)) {
    return { error: "unknown_table", allowed: [...VACUUMABLE] };
  }
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const map = async () =>
      (
        await db.query(
          `select relpages, relallvisible, reltuples::bigint as reltuples
             from pg_class where relname = $1`,
          [table],
        )
      ).rows[0];
    const before = await map();
    const started = Date.now();
    await db.query(`vacuum (analyze) ${table}`);
    return { table, ms: Date.now() - started, before, after: await map() };
  } finally {
    await db.end();
  }
}

/**
 * {enum_census: true} - the distinct values of every column the schema
 * review (2026-09-16, 1.5) wants a CHECK on, plus the orphan counts the
 * NOT VALID foreign keys of 0108/0109 will be validated against. Read
 * only. The checks are written from THIS, on the next deploy, so a value
 * history holds that the code no longer emits is a decision on record
 * rather than a failed migration.
 */
export async function enumCensus(databaseUrl) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const values = async (table, column) => {
      const { rows } = await db.query(
        `select ${column}::text as value, count(*)::int as n
         from ${table} group by 1 order by 2 desc, 1`,
      );
      return rows;
    };
    const orphans = async (sql) => {
      const { rows } = await db.query(sql);
      return rows[0].n;
    };
    return {
      player_event_type: await values("player_event", "event_type"),
      clan_event_type: await values("clan_event", "event_type"),
      rollup_mode_group: await values(
        "player_daily_battle_rollup",
        "mode_group",
      ),
      poll_state_hint: await values("poll_state", "hint"),
      poll_state_period_type: await values("poll_state", "period_type"),
      snapshot_kind: await values("player_snapshot_daily", "snapshot_kind"),
      participant_type_class: await values("battle_participant", "type_class"),
      // Jamie 2026-09-22: "game modes are really played as a different
      // game", and in some of them the player does not choose the deck.
      // deck_selection is the API's own word for that, stored since the
      // beginning and never used as a filter.
      battle_deck_selection: await values("battle", "deck_selection"),
      battle_type: await values("battle", "type"),
      deck_card_count: await values("deck", "card_count"),
      orphans: {
        participant_deck: await orphans(
          `select count(*)::int as n from battle_participant bp
           where bp.deck_hash is not null
             and not exists (select 1 from deck d where d.deck_hash = bp.deck_hash)`,
        ),
        player_card_card: await orphans(
          `select count(*)::int as n from player_card pc
           where not exists (select 1 from card c where c.card_id = pc.card_id)`,
        ),
        war_participation_week: await orphans(
          `select count(*)::int as n from war_participation wp
           where not exists (select 1 from war_week w where (w.clan_tag, w.season_id, w.section_index) = (wp.clan_tag, wp.season_id, wp.section_index))`,
        ),
        war_attendance_day_week: await orphans(
          `select count(*)::int as n from war_attendance_day ad
           where not exists (select 1 from war_week w where (w.clan_tag, w.season_id, w.section_index) = (ad.clan_tag, ad.season_id, ad.section_index))`,
        ),
        war_week_clan_week: await orphans(
          `select count(*)::int as n from war_week_clan wc
           where not exists (select 1 from war_week w where (w.clan_tag, w.season_id, w.section_index) = (wc.clan_tag, wc.season_id, wc.section_index))`,
        ),
        ranking_snapshot_season: await orphans(
          `select count(*)::int as n from ranking_snapshot r
           where not exists (select 1 from season s where s.season_month = r.season_month)`,
        ),
        ranking_presence_season: await orphans(
          `select count(*)::int as n from ranking_presence r
           where not exists (select 1 from season s where s.season_month = r.season_month)`,
        ),
        participant_null_battle_time: await orphans(
          `select count(*)::int as n from battle_participant where battle_time is null`,
        ),
        participant_null_type: await orphans(
          `select count(*)::int as n from battle_participant where type is null`,
        ),
      },
    };
  } finally {
    await db.end();
  }
}

/** {explain_standings: {clan_tag?, days?, mode?}} - EXPLAIN ANALYZE of
 *  the one query behind clans_standings, as the tool builds it. */
export async function explainStandings(databaseUrl, spec = {}) {
  const { standingsQuery } = await import("../../mcp/src/standings-sql.mjs");
  const clanTag = String(spec.clan_tag ?? "#J2RGCRVG").toUpperCase();
  const days = Math.min(90, Math.max(1, Number(spec.days ?? 30)));
  const q = standingsQuery({
    clanTag,
    from: new Date(Date.now() - days * 86_400_000),
    to: null,
    mode: spec.mode ?? null,
  });
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query("set statement_timeout = 120000");
    const started = Date.now();
    const { rows } = await db.query(
      `explain (analyze, buffers, format text) ${q.text}`,
      q.values,
    );
    return {
      clan_tag: clanTag,
      days,
      ms: Date.now() - started,
      plan: rows.map((r) => r["QUERY PLAN"]).join("\n"),
    };
  } finally {
    await db.end();
  }
}

/** One poll subject explained ({poll_state: {subject_tag, endpoint}}),
 *  read-only: the poll_state row, the last ten ledger jobs for the key
 *  and the last five receipts. Added 2026-09-19 when the card catalog
 *  had not confirmed in nine days and nothing read-only could say
 *  whether the planner, the lease or the admission was the silent
 *  half. */
export async function pollStateOp(databaseUrl, spec = {}) {
  const subject = String(spec.subject_tag ?? "");
  const endpoint = String(spec.endpoint ?? "");
  if (!subject || !endpoint)
    return { error: "poll_state needs subject_tag and endpoint" };
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const {
      rows: [state],
    } = await db.query(
      `select * from poll_state where subject_tag = $1 and endpoint = $2`,
      [subject, endpoint],
    );
    const { rows: jobs } = await db.query(
      `select j.job_id, j.status, j.lane, j.attempts, j.created_at, j.leased_at,
              j.done_at, g.name as gateway
       from job j left join gateway g on g.gateway_id = j.leased_by
       where j.endpoint = $2 and j.entity_key = $1
       order by j.job_id desc limit 10`,
      [subject, endpoint],
    );
    const { rows: receipts } = await db.query(
      `select r.receipt_id, r.fetched_at, r.admission, r.admission_errors, g.name as gateway
       from api_receipt r left join gateway g on g.gateway_id = r.gateway_id
       where r.endpoint = $2 and r.entity_key = $1
       order by r.receipt_id desc limit 5`,
      [subject, endpoint],
    );
    return { state: state ?? null, jobs, receipts };
  } finally {
    await db.end();
  }
}

/** {battle_length_census}: what the record can say about how long battles
 *  ran. The battle log carries no duration, but the game's clock makes the
 *  crown pair a bound (cr-agent-api-docs models/battles.md "Battle Length
 *  And Phases"): a King Tower is the ONLY way to end before 3:00, so a
 *  finish without one ran at least regulation; and overtime ends on the
 *  next tower, so a finish with the sides LEVEL on crowns means overtime
 *  expired and the tower-hitpoints tiebreaker resolved it - exactly 5:00.
 *
 *  One pass, grouped by a small key (never by battle_id): the 1v1 types
 *  only, since a duel row sums crowns across up to three games and a boat
 *  battle has no overtime. starting_trophies is banded by the LOWER of the
 *  two sides, so a band reads "both players at or above this"; the scale
 *  differs per type (Path of Legends rating is not ladder trophies), so
 *  bands are comparable within a type and not across them. */
export async function battleLengthCensus(databaseUrl, spec) {
  const band = Number(spec?.band ?? 500);
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const { rows } = await db.query(
      `select a.type,
              a.crowns as c0, b.crowns as c1,
              a.outcome as outcome_0,
              (least(a.starting_trophies, b.starting_trophies) / $1::int) * $1::int as band,
              count(*)::int as n
         from battle_participant a
         join battle_participant b
           on b.battle_id = a.battle_id and b.side = 1
        where a.side = 0
          and a.type_class = 'pvp'
          and a.type in ('PvP', 'pathOfLegend', 'riverRacePvP')
        group by 1, 2, 3, 4, 5`,
      [band],
    );
    const summary = {};
    for (const r of rows) {
      const t = (summary[r.type] ??= {
        battles: 0,
        equal_crowns: 0,
        equal_decided: 0,
        equal_drawn: 0,
        three_crown: 0,
        crowns_unknown: 0,
        by_band: {},
      });
      t.battles += r.n;
      if (r.c0 === null || r.c1 === null) {
        t.crowns_unknown += r.n;
        continue;
      }
      if (r.c0 === 3 || r.c1 === 3) t.three_crown += r.n;
      if (r.c0 === r.c1) {
        t.equal_crowns += r.n;
        if (r.outcome_0 === "draw") t.equal_drawn += r.n;
        else t.equal_decided += r.n;
      }
      const key = r.band === null ? "unknown" : String(r.band);
      const bk = (t.by_band[key] ??= { battles: 0, equal: 0, three: 0 });
      bk.battles += r.n;
      if (r.c0 === r.c1) bk.equal += r.n;
      if (r.c0 === 3 || r.c1 === 3) bk.three += r.n;
    }
    // The level-crown battles themselves: few enough to return whole, and
    // the only rows whose duration is pinned. Their tower hitpoints are
    // what the game resolved them on, so the ones with a RECORDED winner
    // say which hitpoint rule it used, and that rule can then be read
    // across the ones whose winner the record lost (a war 1v1 carries no
    // trophyChange, so winner inference falls through to the crowns -
    // level crowns, hence 'draw' - and the real result is in the towers).
    const { rows: level } = await db.query(
      `select a.battle_id, a.type, a.battle_time, a.crowns,
              a.outcome as outcome_0, b.outcome as outcome_1,
              a.trophy_change as trophy_0, b.trophy_change as trophy_1,
              a.king_tower_hp as king_0, a.princess_tower_hp_1 as p1_0,
              a.princess_tower_hp_2 as p2_0,
              b.king_tower_hp as king_1, b.princess_tower_hp_1 as p1_1,
              b.princess_tower_hp_2 as p2_1
         from battle_participant a
         join battle_participant b
           on b.battle_id = a.battle_id and b.side = 1
        where a.side = 0
          and a.type_class = 'pvp'
          and a.type in ('PvP', 'pathOfLegend', 'riverRacePvP')
          and a.crowns is not null and a.crowns = b.crowns
        order by a.battle_time`,
    );
    // The contamination the level-crown rows turned up: a decided 1v1 has
    // ONE winner, so a pair of outcomes that is not {win, loss} (or a pair
    // of same-signed trophy changes) is the record disagreeing with the
    // game. Counted corpus-wide so the level-crown signal can be read net
    // of it.
    const { rows: outcomePairs } = await db.query(
      `select a.type,
              a.outcome as outcome_0, b.outcome as outcome_1,
              sign(coalesce(a.trophy_change, 0))::int as trophy_sign_0,
              sign(coalesce(b.trophy_change, 0))::int as trophy_sign_1,
              count(*)::int as n
         from battle_participant a
         join battle_participant b
           on b.battle_id = a.battle_id and b.side = 1
        where a.side = 0
          and a.type_class = 'pvp'
          and a.type in ('PvP', 'pathOfLegend', 'riverRacePvP')
        group by 1, 2, 3, 4, 5
        order by 6 desc`,
    );
    return {
      band,
      pairs: rows.length,
      summary,
      level_crown: level,
      outcome_pairs: outcomePairs,
    };
  } finally {
    await db.end();
  }
}

/** {outcome_pair_repair}: the rows the fixed derivation would now write.
 *  A decided 1v1 moves the two sides opposite ways, so a pair of
 *  same-signed trophy changes was never a verdict - Path of Legends
 *  penalises BOTH players for a draw, and reading each side's sign alone
 *  wrote 'loss' on both. Re-derives those rows as the crowns say (equal
 *  crowns -> draw). Dry run by default; pass {apply: true} to write. */
export async function outcomePairRepair(databaseUrl, spec) {
  const apply = spec?.apply === true;
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const targets = `
      select a.battle_id, a.crowns as c0, b.crowns as c1,
             a.trophy_change as t0, b.trophy_change as t1
        from battle_participant a
        join battle_participant b
          on b.battle_id = a.battle_id and b.side = 1
       where a.side = 0
         and a.outcome = b.outcome
         and a.outcome in ('win', 'loss')
         and a.trophy_change is not null and b.trophy_change is not null
         and a.trophy_change <> 0 and b.trophy_change <> 0
         and sign(a.trophy_change) = sign(b.trophy_change)`;
    const { rows: found } = await db.query(
      `with t as (${targets})
       select count(*)::int as battles,
              count(*) filter (where c0 = c1)::int as equal_crowns,
              count(*) filter (where c0 <> c1)::int as unequal_crowns
         from t`,
    );
    if (!apply) return { dry_run: true, ...found[0] };
    // Only the equal-crown ones have an unambiguous answer; an unequal
    // pair would need a rule this defect never produced, so it is left
    // alone and reported rather than guessed at.
    const { rowCount } = await db.query(
      `update battle_participant p set outcome = 'draw'
         from (${targets}) t
        where p.battle_id = t.battle_id and t.c0 = t.c1`,
    );
    return { dry_run: false, ...found[0], rows_updated: rowCount };
  } finally {
    await db.end();
  }
}

/** {battle_fidelity_census}: for every column on the battle tables, how
 *  many rows actually carry a value. The payload manifest
 *  (services/ingest/src/payload-keys.mjs) says where each API field
 *  LANDS; the nightly shape census catches a field the API adds. Neither
 *  checks the other direction - a column the manifest promises but the
 *  projector never fills reads as faithful and is empty. Split by
 *  type_class, and for battle_participant by type, because most of these
 *  are legitimately conditional (trophy_change only on PvP and Path of
 *  Legends, the boat columns only on boat battles). */
export async function battleFidelityCensus(databaseUrl) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const cols = async (table) => {
      const { rows } = await db.query(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = $1
          order by ordinal_position`,
        [table],
      );
      return rows.map((r) => r.column_name);
    };
    const fill = async (table, groupBy) => {
      const names = await cols(table);
      const counts = names
        .map((c) => `count("${c}")::bigint as "${c}"`)
        .join(", ");
      const { rows } = await db.query(
        `select ${groupBy} as bucket, count(*)::bigint as rows, ${counts}
           from ${table} group by 1 order by 2 desc`,
      );
      return rows.map((r) => {
        const total = Number(r.rows);
        const filled = {};
        for (const c of names) {
          const n = Number(r[c]);
          filled[c] = {
            n,
            pct: total ? Math.round((n / total) * 1000) / 10 : 0,
          };
        }
        return { bucket: r.bucket, rows: total, columns: filled };
      });
    };
    return {
      battle: await fill("battle", "type_class"),
      battle_by_type: await fill("battle", "type"),
      battle_participant: await fill("battle_participant", "type"),
    };
  } finally {
    await db.end();
  }
}

/** {battle_detail_backfill}: land duel round results and global_rank on
 *  battles recorded before 0151. The payloads live in S3 (Postgres only
 *  caches them for two hours), so the sweep is local -
 *  infra/scripts/battle-detail-backfill.mjs reads the archive, runs the
 *  SAME canonicalizeBattle the pipeline uses, and posts batches here.
 *  Rows for a battle this record does not hold are skipped by the join
 *  rather than failing the batch. Idempotent; a value already present
 *  is never overwritten. */
export async function battleDetailBackfill(databaseUrl, spec) {
  const rounds = Array.isArray(spec?.rounds) ? spec.rounds : [];
  const ranks = Array.isArray(spec?.ranks) ? spec.ranks : [];
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    let roundRows = 0;
    let rankRows = 0;
    if (rounds.length > 0) {
      const { rowCount } = await db.query(
        `insert into battle_participant_round
           (battle_id, player_tag, round, crowns, king_tower_hp,
            princess_tower_hp_1, princess_tower_hp_2, elixir_leaked)
         with src as (
           -- One battle sits in many archived payloads (both players'
           -- logs, and every poll that still held it), so a batch can
           -- carry the same round twice: ON CONFLICT DO UPDATE cannot
           -- touch a row twice in one statement.
           select distinct on (battle_id, player_tag, round) *
             from jsonb_to_recordset($1::jsonb)
               as r(battle_id text, player_tag text, round smallint,
                    crowns smallint, king_tower_hp smallint,
                    princess_tower_hp_1 smallint, princess_tower_hp_2 smallint,
                    elixir_leaked numeric)
            order by battle_id, player_tag, round
         )
         select r.battle_id, r.player_tag, r.round, r.crowns, r.king_tower_hp,
                r.princess_tower_hp_1, r.princess_tower_hp_2, r.elixir_leaked
           from src r
           join battle_participant bp
             on bp.battle_id = r.battle_id and bp.player_tag = r.player_tag
         on conflict (battle_id, player_tag, round) do update
           set crowns = coalesce(battle_participant_round.crowns, excluded.crowns),
               king_tower_hp = coalesce(battle_participant_round.king_tower_hp, excluded.king_tower_hp),
               princess_tower_hp_1 = coalesce(battle_participant_round.princess_tower_hp_1, excluded.princess_tower_hp_1),
               princess_tower_hp_2 = coalesce(battle_participant_round.princess_tower_hp_2, excluded.princess_tower_hp_2),
               elixir_leaked = coalesce(battle_participant_round.elixir_leaked, excluded.elixir_leaked)`,
        [JSON.stringify(rounds)],
      );
      roundRows = rowCount;
    }
    if (ranks.length > 0) {
      const { rowCount } = await db.query(
        `update battle_participant bp set global_rank = r.global_rank
           from (select distinct on (battle_id, player_tag) *
                   from jsonb_to_recordset($1::jsonb)
                     as t(battle_id text, player_tag text, global_rank int)
                  order by battle_id, player_tag) r
          where bp.battle_id = r.battle_id and bp.player_tag = r.player_tag
            and bp.global_rank is null and r.global_rank is not null`,
        [JSON.stringify(ranks)],
      );
      rankRows = rowCount;
    }
    return { round_rows: roundRows, rank_rows: rankRows };
  } finally {
    await db.end();
  }
}

/** {mode_shape_census}: what a battle TYPE actually contains, by the
 *  game's own mode name and by whether the player chose the deck. Jamie
 *  2026-09-22: "game modes are really played as a different game", and
 *  `trail` - a quarter of the record - is a container nobody had opened.
 *  Also counts the duel round rows 0151 introduced, so the archive
 *  backfill can be verified. */
export async function modeShapeCensus(databaseUrl) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const { rows: modes } = await db.query(
      `select type, coalesce(game_mode_name, '(null)') as game_mode,
              coalesce(deck_selection, '(null)') as deck_selection,
              count(*)::int as n
         from battle group by 1, 2, 3 order by 4 desc`,
    );
    // The decisive cut: the same RULESET (game_mode) under different
    // TYPES. If trail's Ladder carried trophies the way PvP's does they
    // would be one population; the stakes say whether they are.
    const { rows: stakes } = await db.query(
      `select b.type, coalesce(b.game_mode_name, '(null)') as game_mode,
              count(*)::int as participants,
              count(bp.trophy_change)::int as with_trophy_change,
              count(bp.starting_trophies)::int as with_starting_trophies,
              count(bp.global_rank)::int as with_global_rank
         from battle_participant bp join battle b on b.battle_id = bp.battle_id
        where b.game_mode_name in ('Ladder', 'TeamVsTeam', 'Crazy_Arena',
                                   'Friendly', 'PickMode', 'CW_Duel_1v1')
        group by 1, 2 order by 3 desc`,
    );
    // Supercell describes a Trail as a limited-time themed ladder where
    // "Trophies obtained will be permanent... and will not deduct if the
    // player loses". If that is what type=trail marks, a trail Ladder
    // LOSS costs nothing while a Trophy Road loss does - which the sign
    // of trophy_change by outcome settles.
    const { rows: trophyRule } = await db.query(
      `select b.type, bp.outcome,
              count(*)::int as rows,
              count(*) filter (where bp.trophy_change is null)::int as null_change,
              count(*) filter (where bp.trophy_change = 0)::int as zero_change,
              count(*) filter (where bp.trophy_change < 0)::int as negative,
              count(*) filter (where bp.trophy_change > 0)::int as positive
         from battle_participant bp join battle b on b.battle_id = bp.battle_id
        where b.game_mode_name = 'Ladder'
        group by 1, 2 order by 1, 3 desc`,
    );
    // Event content clusters in time; a permanent format does not.
    const { rows: calendar } = await db.query(
      `select to_char(b.battle_time, 'YYYY-MM') as month, b.type,
              count(*)::int as battles
         from battle b
        where b.game_mode_name = 'Ladder'
        group by 1, 2 order by 1, 2`,
    );
    // Seasonal Arena II boosts low cards to level 15 and bans the
    // player's top 8. If type=trail is the Seasonal Road, its recorded
    // card levels are not the player's real ones, and every level-gap
    // comparison that pools them is measuring the format.
    const { rows: levels } = await db.query(
      `select b.type,
              count(*)::int as rows,
              round(avg(bp.deck_avg_level)::numeric, 2) as mean_deck_level,
              round(percentile_cont(0.5) within group
                    (order by bp.deck_avg_level)::numeric, 2) as median,
              count(*) filter (where bp.deck_avg_level >= 14.5)::int as at_15ish,
              min(bp.deck_avg_level) as min, max(bp.deck_avg_level) as max
         from battle_participant bp join battle b on b.battle_id = bp.battle_id
        where b.game_mode_name = 'Ladder' and bp.deck_avg_level is not null
        group by 1`,
    );
    // Is `trail` the Seasonal Road, or a misc bucket that now also holds
    // it? If TeamVsTeam and the party modes predate June 2026 while
    // Ladder does not, the type is older than the Seasonal Road and the
    // grouping cannot simply follow the type.
    const { rows: trailCalendar } = await db.query(
      `select to_char(b.battle_time, 'YYYY-MM') as month,
              coalesce(b.game_mode_name, '(null)') as game_mode,
              count(*)::int as battles
         from battle b
        where b.type = 'trail'
        group by 1, 2 order by 1, 3 desc`,
    );
    // The corpus itself ramps: broad multi-clan recording began
    // 2026-09-03, so a month-over-month rise can be our population
    // rather than the game's. Battles and distinct observed players per
    // month, by type, so a share can be read against its own month.
    const { rows: corpus } = await db.query(
      `select to_char(b.battle_time, 'YYYY-MM') as month, b.type,
              count(*)::int as battles
         from battle b
        where b.battle_time >= '2026-03-01'
        group by 1, 2 order by 1, 3 desc`,
    );
    const { rows: players } = await db.query(
      `select to_char(bp.battle_time, 'YYYY-MM') as month,
              count(distinct bp.player_tag)::int as players
         from battle_participant bp
        where bp.battle_time >= '2026-03-01'
        group by 1 order by 1`,
    );
    // A tournament is a window; a permanent mode is a level. Daily
    // counts for the two modes that exploded in September say which.
    const { rows: daily } = await db.query(
      `select to_char(b.battle_time, 'YYYY-MM-DD') as day,
              b.game_mode_name as game_mode,
              count(*)::int as battles,
              count(distinct bp.player_tag)::int as players
         from battle b join battle_participant bp on bp.battle_id = b.battle_id
        where b.battle_time >= '2026-08-25'
          and b.game_mode_name in ('TeamVsTeam', 'Ladder')
        group by 1, 2 order by 1, 2`,
    );
    // Jamie's model: Supercell slots an EVENT into a (type, gameMode)
    // pair bound by a date window, and may reuse the pair later for a
    // different event. If so the API's own eventTag is that identity,
    // and each tag should own a window rather than sprawling.
    const { rows: events } = await db.query(
      `select b.type, coalesce(b.game_mode_name, '(null)') as game_mode,
              coalesce(b.event_tag, '(none)') as event_tag,
              count(*)::int as battles,
              to_char(min(b.battle_time), 'YYYY-MM-DD') as first_day,
              to_char(max(b.battle_time), 'YYYY-MM-DD') as last_day,
              count(distinct to_char(b.battle_time, 'YYYY-MM-DD'))::int as active_days
         from battle b
        where b.event_tag is not null
        group by 1, 2, 3 order by 4 desc limit 40`,
    );
    // Does one pair carry several event tags (reuse), and does one tag
    // span several pairs?
    const { rows: reuse } = await db.query(
      `select b.type, coalesce(b.game_mode_name, '(null)') as game_mode,
              count(distinct b.event_tag)::int as distinct_event_tags,
              count(*)::int as battles
         from battle b
        where b.event_tag is not null
        group by 1, 2 having count(distinct b.event_tag) > 1
        order by 3 desc limit 20`,
    );
    // The load-bearing claim: does a PERMANENT format ever carry an
    // event tag? If not, event_tag is the discriminator - not the type,
    // not the mode name, not the pair.
    const { rows: tagged } = await db.query(
      `select b.type, count(*)::int as battles,
              count(b.event_tag)::int as with_event_tag,
              count(b.tournament_tag)::int as with_tournament_tag
         from battle b group by 1 order by 2 desc`,
    );
    const { rows: rounds } = await db.query(
      `select count(*)::int as round_rows,
              count(distinct battle_id)::int as battles,
              count(distinct player_tag)::int as players,
              min(round)::int as min_round, max(round)::int as max_round,
              count(*) filter (where crowns is not null)::int as with_crowns,
              count(*) filter (where elixir_leaked is not null)::int as with_elixir
         from battle_participant_round`,
    );
    const { rows: ranks } = await db.query(
      `select count(*)::int as rows_with_rank,
              min(global_rank)::int as best, max(global_rank)::int as worst
         from battle_participant where global_rank is not null`,
    );
    return {
      modes,
      stakes,
      trophy_rule: trophyRule,
      ladder_calendar: calendar,
      ladder_levels: levels,
      trail_calendar: trailCalendar,
      corpus_calendar: corpus,
      players_per_month: players,
      daily_burst: daily,
      event_tags: events,
      event_tag_reuse: reuse,
      event_tag_by_type: tagged,
      rounds: rounds[0],
      global_rank: ranks[0],
    };
  } finally {
    await db.end();
  }
}
