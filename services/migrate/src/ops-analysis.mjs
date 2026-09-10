import pg from "pg";
import { inLossBoundArm } from "../../scheduler/src/plan.mjs";

export async function abYield(databaseUrl, spec) {
  const hours = Math.min(Math.max(Number(spec?.hours ?? 24), 1), 72);
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const windowStats = async (startIso) => {
      const { rows } = await db.query(
        `with live as (
           select r.receipt_id, r.endpoint, r.entity_key, r.fetched_at
           from api_receipt r
           join gateway g on g.gateway_id = r.gateway_id
           where g.name <> 'backfill-elixir-bot'
             and r.fetched_at >= $1::timestamptz
             and r.fetched_at < $1::timestamptz + make_interval(hours => $2)),
         first_obs as (
           select bo.battle_id, min(bo.receipt_id) as receipt_id
           from battle_observation bo group by bo.battle_id)
         select
           (select count(*)::int from live) as fetches,
           (select count(*)::int from live where endpoint = 'player_battlelog') as battlelog_fetches,
           (select count(distinct entity_key)::int from live
            where endpoint = 'player_battlelog') as battlelog_subjects,
           (select count(*)::int from live
            where endpoint in ('currentriverrace', 'riverracelog')) as war_fetches,
           (select count(*)::int from first_obs fo
            join live l on l.receipt_id = fo.receipt_id
            where l.endpoint = 'player_battlelog') as battles_captured`,
        [startIso, hours],
      );
      return rows[0];
    };
    // Per-subject battlelog census for the same window, split by the loss
    // bound's hash arm (the SAME split the scheduler uses under
    // ELIXIR_LOSS_BOUND=half), so both arms read over identical clock
    // hours and the war/training confound of a time-windowed A/B is gone.
    // zero-yield = payload hash equal to the subject's previous receipt;
    // gaps come from capture_audit (fresh polls with prior coverage only).
    const armStats = async (startIso) => {
      const { rows } = await db.query(
        `with seq as (
           select r.receipt_id, r.entity_key, r.fetched_at, r.payload_hash,
                  lag(r.payload_hash) over (partition by r.entity_key order by r.fetched_at) as prev_hash
           from api_receipt r
           join gateway g on g.gateway_id = r.gateway_id
           where g.name <> 'backfill-elixir-bot'
             and r.endpoint = 'player_battlelog'
             and r.fetched_at >= $1::timestamptz - interval '2 days'
             and r.fetched_at < $1::timestamptz + make_interval(hours => $2)),
         win as (select * from seq where fetched_at >= $1::timestamptz),
         first_obs as (
           select bo.battle_id, min(bo.receipt_id) as receipt_id
           from battle_observation bo group by bo.battle_id)
         select w.entity_key,
                count(*)::int as fetches,
                count(*) filter (where w.prev_hash = w.payload_hash)::int as zero_yield,
                count(ca.receipt_id)::int as audited,
                count(ca.receipt_id) filter (where ca.gap)::int as gaps,
                (select count(*)::int from first_obs fo
                  join win w2 on w2.receipt_id = fo.receipt_id
                  where w2.entity_key = w.entity_key) as battles
         from win w
         left join capture_audit ca on ca.receipt_id = w.receipt_id
         group by w.entity_key`,
        [startIso, hours],
      );
      const arms = {
        treated: {
          subjects: 0,
          battlelog_fetches: 0,
          zero_yield: 0,
          audited: 0,
          gaps: 0,
          battles: 0,
        },
        control: {
          subjects: 0,
          battlelog_fetches: 0,
          zero_yield: 0,
          audited: 0,
          gaps: 0,
          battles: 0,
        },
      };
      for (const r of rows) {
        const arm = inLossBoundArm(r.entity_key, "half")
          ? arms.treated
          : arms.control;
        arm.subjects += 1;
        arm.battlelog_fetches += r.fetches;
        arm.zero_yield += r.zero_yield;
        arm.audited += r.audited;
        arm.gaps += r.gaps;
        arm.battles += r.battles;
      }
      for (const arm of Object.values(arms)) {
        arm.zero_yield_share =
          arm.battlelog_fetches > 0
            ? Math.round((arm.zero_yield / arm.battlelog_fetches) * 1000) / 1000
            : null;
        arm.gap_rate =
          arm.audited > 0
            ? Math.round((arm.gaps / arm.audited) * 10000) / 10000
            : null;
        arm.battles_per_battlelog_fetch =
          arm.battlelog_fetches > 0
            ? Math.round((arm.battles / arm.battlelog_fetches) * 1000) / 1000
            : null;
      }
      return arms;
    };
    const a = {
      ...(await windowStats(spec.a_start)),
      arms: await armStats(spec.a_start),
    };
    const b = {
      ...(await windowStats(spec.b_start)),
      arms: await armStats(spec.b_start),
    };
    const per = (w) =>
      w.battlelog_fetches > 0
        ? Math.round((w.battles_captured / w.battlelog_fetches) * 1000) / 1000
        : null;
    return {
      hours,
      a: { start: spec.a_start, ...a, battles_per_battlelog_fetch: per(a) },
      b: { start: spec.b_start, ...b, battles_per_battlelog_fetch: per(b) },
      deltas: {
        fetch_spend_ratio:
          a.fetches > 0
            ? Math.round((b.fetches / a.fetches) * 1000) / 1000
            : null,
        battles_ratio:
          a.battles_captured > 0
            ? Math.round((b.battles_captured / a.battles_captured) * 1000) /
              1000
            : null,
        yield_per_fetch_ratio:
          per(a) > 0 ? Math.round((per(b) / per(a)) * 1000) / 1000 : null,
      },
    };
  } finally {
    await db.end();
  }
}

/** MCP request effectiveness census ({audit_census: {days?}}): the
 *  product-signal read of mcp_call_audit (Jamie, 2026-09-05) - per-tool
 *  volume, errors, truncation, latency (avg, p95, max), size and reach,
 *  per-surface and per-CLIENT (client_name) breakdowns, declared tools
 *  nobody has called, live_fetch by path (the catch-all is meant to be
 *  rare; frequent use is the signal a tool is missing - review 4.7), and
 *  calls-since-ship for every feedback item with a shipped_in version, so
 *  a batch is judged by adoption rather than by shipping (review 4.5).
 *  Read-only, counts only. */
export async function auditCensus(databaseUrl, spec) {
  const days = Math.min(Math.max(Number(spec?.days ?? 7), 1), 90);
  const { TOOL_GROUPS } = await import("@elixir-mcp/contracts");
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const { rows: perTool } = await db.query(
      `select tool,
              count(*)::int as calls,
              count(distinct account_id)::int as accounts,
              count(*) filter (where error_code is not null)::int as errors,
              round(avg(duration_ms))::int as avg_ms,
              round(percentile_cont(0.95) within group (order by duration_ms))::int as p95_ms,
              max(duration_ms)::int as max_ms,
              round(avg(result_bytes))::int as avg_bytes,
              max(result_bytes)::int as max_bytes,
              count(*) filter (where truncated)::int as truncated,
              max(created_at) as last_called
       from mcp_call_audit
       where created_at > now() - make_interval(days => $1)
       group by tool order by calls desc`,
      [days],
    );
    const { rows: perSurface } = await db.query(
      `select surface, count(*)::int as calls,
              count(*) filter (where error_code is not null)::int as errors
       from mcp_call_audit
       where created_at > now() - make_interval(days => $1)
       group by surface order by calls desc`,
      [days],
    );
    // Which CLIENT (Claude.ai, Claude Code, mcp-remote, a bot naming
    // itself) made the calls and how often each is refused: the way to see
    // which clients drop the instructions block or fail scope step-up.
    const { rows: perClient } = await db.query(
      `select coalesce(client_name, '(unnamed)') as client,
              surface,
              count(*)::int as calls,
              count(distinct account_id)::int as accounts,
              count(*) filter (where error_code is not null)::int as errors,
              count(*) filter (where tool = 'elixir_my_players')::int as identity_lookups,
              max(created_at) as last_called
       from mcp_call_audit
       where created_at > now() - make_interval(days => $1)
       group by client_name, surface order by calls desc`,
      [days],
    );
    const { rows: errors } = await db.query(
      `select tool, error_code, count(*)::int as n
       from mcp_call_audit
       where created_at > now() - make_interval(days => $1)
         and error_code is not null
       group by tool, error_code order by n desc limit 30`,
      [days],
    );
    // The catch-all, by path shape (tags folded so the axis is the
    // endpoint, not the subject).
    const { rows: livePaths } = await db.query(
      `select regexp_replace(coalesce(args->>'path', '?'),
                             '#[0-9A-Z]+', '{tag}', 'g') as path,
              count(*)::int as calls,
              count(distinct account_id)::int as accounts,
              count(*) filter (where error_code is not null)::int as errors,
              count(*) filter (where truncated)::int as truncated
       from mcp_call_audit
       where tool = 'live_fetch'
         and created_at > now() - make_interval(days => $1)
       group by 1 order by calls desc`,
      [days],
    );
    const {
      rows: [liveShare],
    } = await db.query(
      `select count(*) filter (where tool = 'live_fetch')::int as live_calls,
              count(*)::int as calls
       from mcp_call_audit
       where created_at > now() - make_interval(days => $1)`,
      [days],
    );
    // Adoption of shipped feedback: calls to each item's related_tools
    // since its response, by anyone and by the requester.
    const { rows: adoption } = await db.query(
      `select f.feedback_id, f.shipped_in, f.related_tools, f.responded_at,
              (select count(*)::int from mcp_call_audit a
               where a.tool = any(f.related_tools)
                 and a.created_at > coalesce(f.responded_at, f.created_at)) as calls_since_ship,
              (select count(*)::int from mcp_call_audit a
               where a.tool = any(f.related_tools)
                 and a.account_id = f.account_id
                 and a.created_at > coalesce(f.responded_at, f.created_at)) as requester_calls_since_ship
       from feedback f
       where f.shipped_in is not null and f.related_tools is not null
         and array_length(f.related_tools, 1) > 0
       order by f.feedback_id desc limit 50`,
    );
    const called = new Set(perTool.map((r) => r.tool));
    const never_called = Object.keys(TOOL_GROUPS).filter((t) => !called.has(t));
    return {
      days,
      per_tool: perTool,
      per_surface: perSurface,
      per_client: perClient,
      top_errors: errors,
      live_fetch: {
        calls: liveShare.live_calls,
        share_of_calls:
          liveShare.calls > 0
            ? Number((liveShare.live_calls / liveShare.calls).toFixed(4))
            : 0,
        by_path: livePaths,
      },
      feedback_adoption: adoption,
      never_called,
    };
  } finally {
    await db.end();
  }
}

/** Argument census ({args_census: {days?, tool?}}): per tool and error
 *  code, WHICH argument keys were present and how often - never values.
 *  The audit stored bounded arguments from day one and nothing read them,
 *  so "what trips strict validation" and "what did elixir-bot send" were
 *  unanswerable without a deploy (review 4.4). Also the error message
 *  class per tool, so a refusal's cause is one invoke away. */
export async function argsCensus(databaseUrl, spec) {
  const days = Math.min(Math.max(Number(spec?.days ?? 7), 1), 90);
  const tool = spec?.tool ? String(spec.tool) : null;
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const { rows: keys } = await db.query(
      `select tool, coalesce(error_code, 'ok') as outcome,
              k.key, count(*)::int as calls
       from mcp_call_audit a
       cross join lateral jsonb_object_keys(coalesce(a.args, '{}'::jsonb)) k(key)
       where a.created_at > now() - make_interval(days => $1)
         and ($2::text is null or a.tool = $2)
       group by tool, outcome, k.key
       order by tool, outcome, calls desc`,
      [days, tool],
    );
    const { rows: shapes } = await db.query(
      `select tool, coalesce(error_code, 'ok') as outcome,
              (select string_agg(k, ',' order by k)
               from jsonb_object_keys(coalesce(a.args, '{}'::jsonb)) k) as key_set,
              count(*)::int as calls
       from mcp_call_audit a
       where a.created_at > now() - make_interval(days => $1)
         and ($2::text is null or a.tool = $2)
       group by tool, outcome, key_set
       order by tool, calls desc`,
      [days, tool],
    );
    return { days, tool, keys_by_outcome: keys, key_sets: shapes };
  } finally {
    await db.end();
  }
}

/** Prototype intelligence preview ({preview_intel: {player_tag, clan_tag}}):
 *  read-only flavor of the META-INTEL section 9/10 tools computed on live
 *  data — the level-gap curve, one player's position on it, and rival
 *  fingerprints for one clan's current bracket. Also the seed of the
 *  section 6 validation harness. */
export async function previewIntel(databaseUrl, spec) {
  const tag = spec?.player_tag ?? "#20JJJ2CCRU";
  const clan = spec?.clan_tag ?? "#J2RGCRVG";
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const sides = `
      with sides as (
        select bp.battle_id, bp.player_tag, bp.outcome, b.battle_time,
               avg((c.value->>'level')::numeric) as lvl
        from battle_participant bp
        join battle b on b.battle_id = bp.battle_id
        cross join lateral jsonb_array_elements(bp.deck->'cards') c
        where bp.deck ? 'cards' and b.type_class = 'pvp'
          and bp.outcome in ('win','loss')
        group by bp.battle_id, bp.player_tag, bp.outcome, b.battle_time),
      duos as (select battle_id from sides group by battle_id having count(*) = 2),
      pairs as (
        select a.battle_id, a.player_tag, a.outcome, a.battle_time,
               round(a.lvl - o.lvl, 2) as gap
        from sides a
        join sides o on o.battle_id = a.battle_id and o.player_tag <> a.player_tag
        where a.battle_id in (select battle_id from duos))`;
    const { rows: curve } = await db.query(
      `${sides}
       select width_bucket(gap, array[-2.5,-1.5,-1.0,-0.6,-0.3,-0.1,0.1,0.3,0.6,1.0,1.5,2.5]) as bin,
              min(gap) as gap_lo, max(gap) as gap_hi,
              count(*)::int as n,
              round(avg((outcome = 'win')::int)::numeric, 3) as win_rate
       from pairs group by bin order by bin`,
    );
    const tags = Array.isArray(spec?.player_tags) ? spec.player_tags : [tag];
    // Score each player against the corpus curve: expected win rate at
    // each battle's level gap -> actual minus expected = the win-rate
    // the LEVELS cannot explain (level-adjusted skill signal). The
    // player's own battles are a negligible share of the 66k-obs curve.
    const { rows: me } = await db.query(
      `${sides},
       curve as (
         select width_bucket(gap, array[-2.5,-1.5,-1.0,-0.6,-0.3,-0.1,0.1,0.3,0.6,1.0,1.5,2.5]) as bin,
                avg((outcome = 'win')::int) as wr
         from pairs group by bin)
       select p.player_tag,
              count(*)::int as n,
              round(avg(p.gap)::numeric, 2) as mean_gap,
              round(avg((p.outcome = 'win')::int)::numeric, 3) as actual_wr,
              round(avg(c.wr)::numeric, 3) as expected_wr_from_levels,
              round((avg((p.outcome = 'win')::int) - avg(c.wr))::numeric, 3) as skill_residual,
              round((1.0 / sqrt(count(*)) / 2)::numeric, 3) as residual_se_approx,
              round(avg((p.outcome = 'win')::int)
                filter (where p.gap >= 0.1)::numeric, 3) as wr_when_ahead,
              round(avg((p.outcome = 'win')::int)
                filter (where p.gap > -0.1 and p.gap < 0.1)::numeric, 3) as wr_when_even,
              count(*) filter (where p.gap >= 0.1)::int as n_ahead,
              count(*) filter (where p.gap > -0.1 and p.gap < 0.1)::int as n_even
       from pairs p
       join curve c on c.bin = width_bucket(p.gap, array[-2.5,-1.5,-1.0,-0.6,-0.3,-0.1,0.1,0.3,0.6,1.0,1.5,2.5])
       where p.player_tag = any($1)
         and p.battle_time > now() - interval '60 days'
       group by p.player_tag`,
      [tags],
    );
    const { rows: rivals } = await db.query(
      `with bracket as (
         select participant_clan_tag, participant_name
         from war_week_clan
         where clan_tag = $1 and participant_clan_tag <> $1
           and (season_id, section_index) = (
             select season_id, section_index from war_week
             where clan_tag = $1
             order by season_id desc, section_index desc limit 1)),
       races as (
         select distinct w.season_id, w.section_index, w.participant_clan_tag,
                max(w.fame) as fame
         from war_week_clan w
         join bracket bk on bk.participant_clan_tag = w.participant_clan_tag
         group by w.season_id, w.section_index, w.participant_clan_tag)
       select b.participant_clan_tag as clan_tag, b.participant_name as name,
              count(r.fame)::int as races_observed,
              round(avg(r.fame) filter (where (r.season_id, r.section_index) <> (
                select season_id, section_index from war_week where clan_tag = $1
                order by season_id desc, section_index desc limit 1))::numeric)::int
                as mean_fame_finished,
              max(r.fame)::int as max_fame,
              min(r.season_id)::int as first_season,
              max(r.season_id)::int as last_season
       from bracket b left join races r on r.participant_clan_tag = b.participant_clan_tag
       group by 1, 2 order by races_observed desc`,
      [clan],
    );
    return { curve, players: me, rivals };
  } finally {
    await db.end();
  }
}
