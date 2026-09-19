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
           select r.receipt_id, r.endpoint, r.entity_key, r.fetched_at, r.new_facts
           from api_receipt r
           join gateway g on g.gateway_id = r.gateway_id
           where g.name <> 'backfill-elixir-bot'
             and r.fetched_at >= $1::timestamptz
             and r.fetched_at < $1::timestamptz + make_interval(hours => $2))
         select
           (select count(*)::int from live) as fetches,
           (select count(*)::int from live where endpoint = 'player_battlelog') as battlelog_fetches,
           (select count(distinct entity_key)::int from live
            where endpoint = 'player_battlelog') as battlelog_subjects,
           (select count(*)::int from live
            where endpoint in ('currentriverrace', 'riverracelog')) as war_fetches,
           -- Battles this window's polls added: the receipt's own count
           -- (0077; null before 2026-09-11). battle_observation is no
           -- longer written.
           (select coalesce(sum(new_facts), 0)::int from live
            where endpoint = 'player_battlelog') as battles_captured`,
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
           select r.receipt_id, r.entity_key, r.fetched_at, r.payload_hash, r.new_facts,
                  lag(r.payload_hash) over (partition by r.entity_key order by r.fetched_at) as prev_hash
           from api_receipt r
           join gateway g on g.gateway_id = r.gateway_id
           where g.name <> 'backfill-elixir-bot'
             and r.endpoint = 'player_battlelog'
             and r.fetched_at >= $1::timestamptz - interval '2 days'
             and r.fetched_at < $1::timestamptz + make_interval(hours => $2)),
         win as (select * from seq where fetched_at >= $1::timestamptz)
         select w.entity_key,
                count(*)::int as fetches,
                count(*) filter (where w.prev_hash = w.payload_hash)::int as zero_yield,
                count(ca.receipt_id)::int as audited,
                count(ca.receipt_id) filter (where ca.gap)::int as gaps,
                coalesce(sum(w.new_facts), 0)::int as battles
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
  // A window is days back from now, or an explicit from/to (3.18.0,
  // review Part 7.2): fourteen days that span a redesign cannot be
  // split, and every phase's before/after is one number without this.
  const days = Math.min(Math.max(Number(spec?.days ?? 7), 1), 90);
  const toTs = spec?.to ? new Date(spec.to) : new Date();
  const fromTs = spec?.from
    ? new Date(spec.from)
    : new Date(toTs.getTime() - days * 86_400_000);
  if (Number.isNaN(fromTs.getTime()) || Number.isNaN(toTs.getTime()))
    return { error: "from/to must be ISO instants" };
  if (fromTs >= toTs) return { error: "from must be before to" };
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
              round(avg(db_ms))::int as avg_db_ms,
              round(percentile_cont(0.95) within group (order by duration_ms))::int as p95_ms,
              max(duration_ms)::int as max_ms,
              round(avg(result_bytes))::int as avg_bytes,
              max(result_bytes)::int as max_bytes,
              count(*) filter (where truncated)::int as truncated,
              max(created_at) as last_called
       from mcp_call_audit
       where created_at > $1::timestamptz and created_at <= $2::timestamptz
       group by tool order by calls desc`,
      [fromTs, toTs],
    );
    const { rows: perSurface } = await db.query(
      `select surface, count(*)::int as calls,
              count(*) filter (where error_code is not null)::int as errors
       from mcp_call_audit
       where created_at > $1::timestamptz and created_at <= $2::timestamptz
       group by surface order by calls desc`,
      [fromTs, toTs],
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
       where created_at > $1::timestamptz and created_at <= $2::timestamptz
       group by client_name, surface order by calls desc`,
      [fromTs, toTs],
    );
    const { rows: errors } = await db.query(
      `select tool, error_code, count(*)::int as n
       from mcp_call_audit
       where created_at > $1::timestamptz and created_at <= $2::timestamptz
         and error_code is not null
       group by tool, error_code order by n desc limit 30`,
      [fromTs, toTs],
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
         and created_at > $1::timestamptz and created_at <= $2::timestamptz
       group by 1 order by calls desc`,
      [fromTs, toTs],
    );
    const {
      rows: [liveShare],
    } = await db.query(
      `select count(*) filter (where tool = 'live_fetch')::int as live_calls,
              count(*)::int as calls
       from mcp_call_audit
       where created_at > $1::timestamptz and created_at <= $2::timestamptz`,
      [fromTs, toTs],
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
    // 0063: which KIND of principal made the calls, and how the cold
    // starts fall. principal_kind is null on rows older than the column;
    // those show as '(unknown)' rather than being folded into person.
    const { rows: perPrincipalKind } = await db.query(
      `select coalesce(principal_kind, '(unknown)') as principal_kind,
              count(*)::int as calls,
              count(distinct account_id)::int as accounts,
              count(*) filter (where error_code is not null)::int as errors,
              count(*) filter (where rpc_error_code is not null)::int as rpc_refusals,
              count(*) filter (where on_behalf_of is not null)::int as delegated,
              round(avg(duration_ms))::int as avg_ms
       from mcp_call_audit
       where created_at > $1::timestamptz and created_at <= $2::timestamptz
       group by 1 order by calls desc`,
      [fromTs, toTs],
    );
    const {
      rows: [coldStarts],
    } = await db.query(
      `select count(*) filter (where cold_start)::int as cold,
              count(*) filter (where cold_start is not null)::int as measured,
              round(avg(duration_ms) filter (where cold_start))::int as cold_avg_ms,
              round(avg(duration_ms) filter (where cold_start = false))::int as warm_avg_ms
       from mcp_call_audit
       where created_at > $1::timestamptz and created_at <= $2::timestamptz`,
      [fromTs, toTs],
    );
    // Where the wall time goes, per tool: the database, the live lane,
    // or the answer's own size. Rows without db_ms predate the column.
    const { rows: timings } = await db.query(
      `select tool,
              count(*)::int as calls,
              round(avg(duration_ms))::int as avg_ms,
              round(avg(db_ms))::int as avg_db_ms,
              round(percentile_cont(0.95) within group (order by db_ms))::int as p95_db_ms,
              round(avg(db_queries))::int as avg_db_queries,
              count(*) filter (where live_wait_ms is not null)::int as live_calls,
              round(avg(live_wait_ms))::int as avg_live_wait_ms,
              round(percentile_cont(0.95) within group (order by live_wait_ms))::int as p95_live_wait_ms,
              round(avg(serialize_ms))::int as avg_serialize_ms
       from mcp_call_audit
       where created_at > $1::timestamptz and created_at <= $2::timestamptz
         and db_ms is not null
       group by tool order by calls desc`,
      [fromTs, toTs],
    );
    // The manual over the wire (3.18.0): resources/read and prompts/get
    // rows, by page and by client.
    const { rows: reads } = await db.query(
      `select tool as method,
              coalesce(args->>'uri', args->>'name') as name,
              count(*)::int as calls,
              count(distinct account_id)::int as accounts,
              count(distinct coalesce(client_name, '(unnamed)'))::int as clients,
              count(*) filter (where error_code is not null)::int as not_found
       from mcp_call_audit
       where tool in ('resources/read', 'prompts/get')
         and created_at > $1::timestamptz and created_at <= $2::timestamptz
       group by 1, 2 order by calls desc limit 60`,
      [fromTs, toTs],
    );
    const called = new Set(perTool.map((r) => r.tool));
    const never_called = Object.keys(TOOL_GROUPS).filter((t) => !called.has(t));
    return {
      days: spec?.from ? null : days,
      window: { from: fromTs.toISOString(), to: toTs.toISOString() },
      per_tool: perTool,
      per_surface: perSurface,
      per_client: perClient,
      per_principal_kind: perPrincipalKind,
      cold_starts: coldStarts,
      timings,
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
      resources_and_prompts: reads,
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
