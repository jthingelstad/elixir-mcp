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
    // War-stamp census: unstamped war battles can silently starve every
    // reader that joins on war keys (attendance union, week focus).
    const { rows: stamps } = await db.query(
      `select coalesce(b.season_id::text, 'UNSTAMPED') as season,
              b.section_index, b.war_day, count(*)::int as battles
       from battle b
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
      war_stamps_7d: stamps,
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
