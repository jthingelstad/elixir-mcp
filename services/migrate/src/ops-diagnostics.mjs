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
      audit_calls: `select count(*)::int n from mcp_call_audit`,
    })) {
      counts[key] = (await db.query(sql)).rows[0].n;
    }
    return counts;
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

    return { error: "ledger op must be dead or requeue" };
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
    const { rows: levels } = await db.query(
      `with sides as (
         select bp.battle_id,
                avg((c.value->>'level')::numeric)
                  filter (where bp.side = 0) as lvl0,
                avg((c.value->>'level')::numeric)
                  filter (where bp.side = 1) as lvl1
         from battle_participant bp
         cross join lateral jsonb_array_elements(bp.deck->'cards') c
         where bp.deck ? 'cards'
         group by bp.battle_id)
       select count(*)::int as battles_with_both_side_levels,
              (select count(*)::int from battle) as battles_total,
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
    // Push-lane pulse (shipped 2026-09-05): rows by topic, and how
    // much sits unread past each account's cursor.
    const { rows: feed } = await db.query(
      `select topic, count(*)::int as rows,
              min(ef.created_at) as first, max(ef.created_at) as last,
              count(*) filter (where ef.event_id > a.events_seen_through)::int as unread
       from event_feed ef join account a on a.account_id = ef.account_id
       group by topic order by topic`,
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
      level_census: levels[0],
      rival_census: rivals[0],
      feed_census: feed,
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
