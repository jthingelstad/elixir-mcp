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

/**
 * Score the nightly rhythm against a week of battlelog polls
 * ({rhythm_score: {days?, to?}}) BEFORE the planner reads it (adaptive
 * polling step two, NOTES 2026-09-13 "Adaptive polling, step one": "its
 * placement changes after a week of nightly histograms has been read
 * against the capture audit"). Read-only, aggregates only.
 *
 * The rhythm scored is OUT OF SAMPLE: rebuilt here from battle_participant
 * with the histogram job's own formula (365-day window, 28-day half-life)
 * as of the window's START, so no poll is judged by battles it delivered
 * itself. The stored `player_activity.rhythm` (which includes the week)
 * is scored beside it for the size of that leak. For every admitted
 * battlelog poll in the window: the mass the player's rhythm puts on the
 * poll's own hour, the battles it expected since the previous poll, and
 * the largest hourly mass the wait crossed; then the same for the polls
 * of cold-start players (fewer than `cold` battles in the year) under the
 * fleet's mean rhythm. Last, a replay: the placement rule (next poll when
 * the expected count crosses `target`, bounded 15 min .. 1440 min) walked
 * over each player's week against the battles the record holds per hour,
 * against the polls that actually happened on the same footing.
 */
export async function rhythmScore(databaseUrl, spec = {}) {
  const {
    normalize,
    bucketOf,
    expectedBattles,
    peakMassBetween,
    nextDueMs,
    fleetMass,
    BUCKETS,
  } = await import("../../scheduler/src/rhythm.mjs");
  const days = Math.min(Math.max(Number(spec.days ?? 7), 1), 14);
  const toTs = spec.to ? new Date(spec.to) : new Date();
  if (Number.isNaN(toTs.getTime()))
    return { error: "to must be an ISO instant" };
  const fromTs = new Date(toTs.getTime() - days * 86_400_000);
  const quiet = Number(spec.quiet ?? 0.05);
  const peak = Number(spec.peak ?? 0.2);
  const cold = Number(spec.cold ?? 20);
  const target = Number(spec.target ?? 5);
  const capacity = Number(spec.capacity ?? 25);
  const floorMs = 15 * 60_000;
  const ceilingMs = 1440 * 60_000;
  const started = Date.now();
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    // 1. The polls, with each one's predecessor (the previous admitted
    //    poll may sit up to a day and a half before the window).
    const { rows: polls } = await db.query(
      `with seq as (
         select r.receipt_id, r.entity_key, r.fetched_at, r.new_facts, r.observed, r.filtered,
                lag(r.fetched_at) over (partition by r.entity_key order by r.fetched_at) as prev_at
         from api_receipt r
         join gateway g on g.gateway_id = r.gateway_id
         where g.name <> 'backfill-elixir-bot'
           and r.endpoint = 'player_battlelog' and r.admission = 'admitted'
           and r.fetched_at >= $1::timestamptz - interval '3 days'
           and r.fetched_at < $2::timestamptz)
       select s.entity_key, s.fetched_at, s.prev_at, s.new_facts, s.observed, s.filtered,
              ca.gap, (ca.receipt_id is not null) as audited
       from seq s
       left join capture_audit ca on ca.receipt_id = s.receipt_id
       where s.fetched_at >= $1::timestamptz
       order by s.entity_key, s.fetched_at`,
      [fromTs, toTs],
    );
    const tags = [...new Set(polls.map((p) => p.entity_key))];
    // 2. Each polled player's rhythm as of the window start: the job's
    //    formula, decayed to `from`, over battles before it.
    const { rows: rhythmRows } = await db.query(
      `select bp.player_tag,
              ((extract(isodow from bp.battle_time at time zone 'UTC')::int - 1) * 24
                + extract(hour from bp.battle_time at time zone 'UTC')::int) as bucket,
              count(*)::int as n,
              sum(power(2, - extract(epoch from ($1::timestamptz - bp.battle_time)) / 86400.0 / 28))::float8 as w,
              count(*) filter (where bp.battle_time > $1::timestamptz - interval '28 days')::int as n_28d
         from battle_participant bp
        where bp.player_tag = any($2::text[])
          and bp.battle_time > $1::timestamptz - interval '365 days'
          and bp.battle_time <= $1::timestamptz
        group by 1, 2`,
      [fromTs, tags],
    );
    // 3. The stored row (in-sample): the leak's size, and coverage.
    const { rows: storedRows } = await db.query(
      `select player_tag, rhythm, rhythm_battles, battles_28d
         from player_activity where player_tag = any($1::text[])`,
      [tags],
    );
    // 4. The week's battles per player per hour, for the replay.
    const { rows: hourRows } = await db.query(
      `select bp.player_tag, date_trunc('hour', bp.battle_time) as hour, count(*)::int as n
         from battle_participant bp
        where bp.player_tag = any($1::text[])
          and bp.battle_time > $2::timestamptz and bp.battle_time <= $3::timestamptz
        group by 1, 2`,
      [tags, fromTs, toTs],
    );

    const players = new Map();
    for (const r of rhythmRows) {
      let p = players.get(r.player_tag);
      if (!p) {
        p = { rhythm: new Array(BUCKETS).fill(0), n: 0, n28: 0 };
        players.set(r.player_tag, p);
      }
      p.rhythm[r.bucket] += r.w;
      p.n += r.n;
      p.n28 += r.n_28d;
    }
    const stored = new Map(storedRows.map((r) => [r.player_tag, r]));
    const hours = new Map();
    for (const r of hourRows) {
      if (!hours.has(r.player_tag)) hours.set(r.player_tag, new Map());
      hours.get(r.player_tag).set(new Date(r.hour).getTime(), r.n);
    }

    // Warm players place their own polls; cold ones borrow the fleet.
    const warm = [];
    const weeklyOf = new Map();
    for (const [tag, p] of players) {
      if (p.n >= cold) {
        warm.push(p.rhythm);
        weeklyOf.set(tag, p.n28 / 4);
      }
    }
    const fleet = fleetMass(warm);
    const weeklies = [...weeklyOf.values()].sort((a, b) => a - b);
    const fleetWeekly = weeklies.length
      ? weeklies[Math.floor(weeklies.length / 2)]
      : 0;

    const thresholds = [0.5, 1, 2, target];
    const bucketStats = () => ({
      n: 0,
      quiet_bucket: 0,
      expected_lt: Object.fromEntries(thresholds.map((t) => [t, 0])),
      battles: 0,
      battles_in_expected_lt: Object.fromEntries(thresholds.map((t) => [t, 0])),
    });
    const crossStats = () => ({ n: 0, peak_crossed: 0, intervals_min: [] });
    const scoreSet = () => ({
      polls: 0,
      first_polls: 0,
      nothing_new: bucketStats(),
      productive: bucketStats(),
      gaps: crossStats(),
      audited_no_gap: crossStats(),
    });
    const own = scoreSet();
    const fleetOnCold = scoreSet();
    const storedSet = scoreSet();

    const score = (set, mass, weekly, poll) => {
      set.polls += 1;
      const t = new Date(poll.fetched_at).getTime();
      const prev = poll.prev_at ? new Date(poll.prev_at).getTime() : null;
      if (prev === null) set.first_polls += 1;
      const nothingNew =
        poll.observed !== null && poll.filtered !== null
          ? poll.observed === poll.filtered
          : null;
      const productive = (poll.new_facts ?? 0) > 0;
      const cls =
        nothingNew === true
          ? set.nothing_new
          : productive
            ? set.productive
            : null;
      if (cls) {
        cls.n += 1;
        if (mass[bucketOf(t)] < quiet) cls.quiet_bucket += 1;
        cls.battles += poll.new_facts ?? 0;
        if (prev !== null) {
          const e = expectedBattles(mass, weekly, prev, t);
          for (const th of thresholds)
            if (e < th) {
              cls.expected_lt[th] += 1;
              cls.battles_in_expected_lt[th] += poll.new_facts ?? 0;
            }
        }
      }
      if (poll.audited && prev !== null) {
        const c = poll.gap ? set.gaps : set.audited_no_gap;
        c.n += 1;
        if (peakMassBetween(mass, prev, t) > peak) c.peak_crossed += 1;
        c.intervals_min.push((t - prev) / 60_000);
      }
    };

    let coldPlayers = 0;
    let noHistoryPlayers = 0;
    let coldPolls = 0;
    let pollsWithRow = 0;
    const byTag = new Map();
    for (const p of polls) {
      if (!byTag.has(p.entity_key)) byTag.set(p.entity_key, []);
      byTag.get(p.entity_key).push(p);
    }
    for (const [tag, list] of byTag) {
      const p = players.get(tag);
      const s = stored.get(tag);
      if (s) pollsWithRow += list.length;
      const isWarm = p && p.n >= cold;
      if (!p) noHistoryPlayers += 1;
      if (!isWarm) {
        coldPlayers += 1;
        coldPolls += list.length;
      }
      const mass = isWarm ? normalize(p.rhythm) : fleet;
      const weekly = isWarm ? weeklyOf.get(tag) : fleetWeekly;
      if (!mass) continue;
      for (const poll of list)
        score(isWarm ? own : fleetOnCold, mass, weekly, poll);
      // The stored row, as the planner would read it tonight (in-sample).
      const sm = s ? normalize(s.rhythm) : null;
      if (sm && s.rhythm_battles >= cold)
        for (const poll of list)
          score(storedSet, sm, Number(s.battles_28d) / 4, poll);
    }

    // The replay. Each player's week from their first actual poll: the
    // rule's polls against the actual ones, both judged by the hourly
    // battle counts the record holds (an hour's battles split across the
    // polls its span overlaps).
    const battlesIn = (tag, aMs, bMs) => {
      const h = hours.get(tag);
      if (!h) return 0;
      let sum = 0;
      for (const [hr, n] of h) {
        const lo = Math.max(hr, aMs);
        const hi = Math.min(hr + 3600_000, bMs);
        if (hi > lo) sum += n * ((hi - lo) / 3600_000);
      }
      return sum;
    };
    const replay = { polls: 0, empty: 0, over_capacity: 0, battles: 0 };
    const actual = {
      polls: 0,
      empty: 0,
      over_capacity: 0,
      battles: 0,
      nothing_new: 0,
      gaps: 0,
    };
    const armed = { players: 0 };
    const endMs = toTs.getTime();
    for (const [tag, list] of byTag) {
      const p = players.get(tag);
      const isWarm = p && p.n >= cold;
      const mass = isWarm ? normalize(p.rhythm) : fleet;
      const weekly = isWarm ? weeklyOf.get(tag) : fleetWeekly;
      if (!mass) continue;
      armed.players += 1;
      const t0 = new Date(list[0].fetched_at).getTime();
      // actual, on the model's footing
      let prev = t0;
      for (const poll of list.slice(1)) {
        const t = new Date(poll.fetched_at).getTime();
        const b = battlesIn(tag, prev, t);
        actual.polls += 1;
        if (b < 0.5) actual.empty += 1;
        if (b > capacity) actual.over_capacity += 1;
        actual.battles += b;
        if (poll.observed !== null && poll.observed === poll.filtered)
          actual.nothing_new += 1;
        if (poll.gap) actual.gaps += 1;
        prev = t;
      }
      // the rule
      let ref = t0;
      for (;;) {
        const due = nextDueMs(mass, weekly, ref, target, {
          floorMs,
          ceilingMs,
        });
        if (due >= endMs) break;
        const b = battlesIn(tag, ref, due);
        replay.polls += 1;
        if (b < 0.5) replay.empty += 1;
        if (b > capacity) replay.over_capacity += 1;
        replay.battles += b;
        ref = due;
      }
    }

    const median = (xs) => {
      if (!xs.length) return null;
      const s = [...xs].sort((a, b) => a - b);
      return Math.round(s[Math.floor(s.length / 2)]);
    };
    const share = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 1000 : null);
    const finish = (set) => ({
      polls: set.polls,
      first_polls: set.first_polls,
      nothing_new: {
        n: set.nothing_new.n,
        quiet_bucket: set.nothing_new.quiet_bucket,
        quiet_share: share(set.nothing_new.quiet_bucket, set.nothing_new.n),
        expected_lt_share: Object.fromEntries(
          thresholds.map((t) => [
            t,
            share(set.nothing_new.expected_lt[t], set.nothing_new.n),
          ]),
        ),
      },
      productive: {
        n: set.productive.n,
        battles: set.productive.battles,
        quiet_bucket: set.productive.quiet_bucket,
        quiet_share: share(set.productive.quiet_bucket, set.productive.n),
        expected_lt_share: Object.fromEntries(
          thresholds.map((t) => [
            t,
            share(set.productive.expected_lt[t], set.productive.n),
          ]),
        ),
        battles_in_expected_lt_share: Object.fromEntries(
          thresholds.map((t) => [
            t,
            share(
              set.productive.battles_in_expected_lt[t],
              set.productive.battles,
            ),
          ]),
        ),
      },
      gaps: {
        n: set.gaps.n,
        peak_crossed: set.gaps.peak_crossed,
        peak_share: share(set.gaps.peak_crossed, set.gaps.n),
        median_interval_min: median(set.gaps.intervals_min),
      },
      audited_no_gap: {
        n: set.audited_no_gap.n,
        peak_crossed: set.audited_no_gap.peak_crossed,
        peak_share: share(
          set.audited_no_gap.peak_crossed,
          set.audited_no_gap.n,
        ),
        median_interval_min: median(set.audited_no_gap.intervals_min),
      },
    });
    const top = fleet
      ? fleet
          .map((m, i) => ({ bucket: i, mass: Math.round(m * 10000) / 10000 }))
          .sort((a, b) => b.mass - a.mass)
          .slice(0, 8)
      : [];
    return {
      window: { from: fromTs.toISOString(), to: toTs.toISOString(), days },
      params: { quiet, peak, cold, target, capacity },
      polls: {
        total: polls.length,
        players: tags.length,
        nothing_new: polls.filter(
          (p) => p.observed !== null && p.observed === p.filtered,
        ).length,
        productive: polls.filter((p) => (p.new_facts ?? 0) > 0).length,
        uncounted: polls.filter((p) => p.observed === null).length,
        audited: polls.filter((p) => p.audited).length,
        gaps: polls.filter((p) => p.gap).length,
      },
      coverage: {
        players_with_activity_row: stored.size,
        polls_with_activity_row: pollsWithRow,
        warm_players: warm.length,
        cold_players: coldPlayers,
        no_history_players: noHistoryPlayers,
        cold_polls: coldPolls,
      },
      own_rhythm: finish(own),
      stored_rhythm_in_sample: finish(storedSet),
      fleet_rhythm_on_cold: finish(fleetOnCold),
      fleet: {
        weekly_median: fleetWeekly,
        players: warm.length,
        top_buckets: top,
      },
      replay: {
        players: armed.players,
        actual: {
          ...actual,
          battles: Math.round(actual.battles),
          empty_share: share(actual.empty, actual.polls),
          over_capacity_share: share(actual.over_capacity, actual.polls),
        },
        rule: {
          ...replay,
          battles: Math.round(replay.battles),
          empty_share: share(replay.empty, replay.polls),
          over_capacity_share: share(replay.over_capacity, replay.polls),
          polls_ratio: share(replay.polls, actual.polls),
          empty_ratio: share(replay.empty, actual.empty),
        },
      },
      elapsed_ms: Date.now() - started,
    };
  } finally {
    await db.end();
  }
}
