import pg from "pg";

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

/** The acceptance catalogue ({acceptance_catalogue: {days?, per_tool?}}):
 *  what agents actually call, as the input the acceptance suite's generic
 *  rules run over (acceptance/README.md). Per read-only tool on the MCP
 *  surface, the most frequent distinct argument sets among calls that
 *  answered, with their counts, and the tool's duration percentiles. The
 *  audit keeps bounded, redacted arguments for 90 days; this drops the
 *  caller-identity ones (on_behalf_of, display_name) and any set asking
 *  for a live read, and never returns values beyond the arguments. */
export async function acceptanceCatalogue(databaseUrl, spec) {
  const days = Math.min(Math.max(Number(spec?.days ?? 7), 1), 90);
  const perTool = Math.min(Math.max(Number(spec?.per_tool ?? 3), 1), 10);
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const { rows: sets } = await db.query(
      `with calls as (
         select tool,
                (coalesce(args, '{}'::jsonb) - 'on_behalf_of' - 'display_name') as args,
                duration_ms
           from mcp_call_audit
          where created_at > now() - make_interval(days => $1)
            and surface = 'mcp' and error_code is null
            and coalesce(args->>'live', 'false') <> 'true'),
       ranked as (
         select tool, args, count(*)::int as calls,
                row_number() over (partition by tool order by count(*) desc, args::text) as rn
           from calls group by tool, args)
       select tool, args, calls from ranked where rn <= $2 order by tool, calls desc`,
      [days, perTool],
    );
    const { rows: timing } = await db.query(
      `select tool, count(*)::int as calls,
              percentile_cont(0.5) within group (order by duration_ms)::int as p50_ms,
              percentile_cont(0.95) within group (order by duration_ms)::int as p95_ms,
              max(duration_ms)::int as max_ms
         from mcp_call_audit
        where created_at > now() - make_interval(days => $1)
          and surface = 'mcp' and error_code is null and duration_ms is not null
        group by tool order by tool`,
      [days],
    );
    return { days, per_tool: perTool, sets, timing };
  } finally {
    await db.end();
  }
}

/**
 * The session clock replayed over a week of battlelog polls, and what
 * the week lost ({poll_replay: {days?, to?}}). Read-only, aggregates only.
 * Written 2026-09-19 when the rhythm-placed design was scored and
 * rejected (NOTES that day) and Jamie asked for the KISS rule instead:
 * after a poll that found battles wait F, after an empty one double the
 * wait up to a ceiling C, and (optionally) leave a player with fewer than
 * A battles in the last seven days on the 24-hour floor.
 *
 * Two answers. (1) The replay: each polled player's week from their
 * first actual poll, the rule's polls judged against the battles the
 * record holds per hour (an hour's battles split across the polls its
 * span overlaps; "over capacity" is more than `capacity` battles between
 * two polls, the gap shape), for every F × C × A, beside the actual polls
 * judged the same way. (2) The loss: the profile's lifetime battleCount
 * is the one ground truth the API gives, so every snapshot interval in
 * the window is read as expected (the counter's delta) against captured
 * (battle_participant rows inside it), split by whether an audited gap
 * fell inside. Intervals without a gap that still come up short measure
 * the modes the battle log never shows; that rate, taken off the gap
 * intervals, leaves the battles the recorder lost. A control beside
 * both: whether the previous poll delivered battles.
 */
export async function pollReplay(databaseUrl, spec = {}) {
  const days = Math.min(Math.max(Number(spec.days ?? 7), 1), 14);
  const toTs = spec.to ? new Date(spec.to) : new Date();
  if (Number.isNaN(toTs.getTime()))
    return { error: "to must be an ISO instant" };
  const fromTs = new Date(toTs.getTime() - days * 86_400_000);
  const capacity = Number(spec.capacity ?? 25);
  const followups = Array.isArray(spec.followups) ? spec.followups : [20, 30];
  const ceilings = Array.isArray(spec.ceilings)
    ? spec.ceilings
    : [180, 240, 360];
  // A player is HOT when the record holds at least `active_min` battles
  // for them in the last seven days; anyone else sits on the cold
  // ceiling (today's 24-hour floor). 0 means one ceiling for everyone.
  const actives = Array.isArray(spec.active_min)
    ? spec.active_min
    : [0, 1, 20, 50];
  const coldCeiling = Number(spec.cold_ceiling ?? 1440);
  const started = Date.now();
  const DAY = 86_400_000;
  const HOUR = 3600_000;
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const { rows: polls } = await db.query(
      `with seq as (
         select r.receipt_id, r.entity_key, r.fetched_at, r.new_facts, r.observed, r.filtered,
                lag(r.fetched_at) over (partition by r.entity_key order by r.fetched_at) as prev_at,
                lag(r.new_facts) over (partition by r.entity_key order by r.fetched_at) as prev_new_facts
         from api_receipt r
         join gateway g on g.gateway_id = r.gateway_id
         where g.name <> 'backfill-elixir-bot'
           and r.endpoint = 'player_battlelog' and r.admission = 'admitted'
           and r.fetched_at >= $1::timestamptz - interval '3 days'
           and r.fetched_at < $2::timestamptz)
       select s.entity_key, s.fetched_at, s.prev_at, s.prev_new_facts, s.new_facts, s.observed, s.filtered,
              ca.gap, (ca.receipt_id is not null) as audited
       from seq s
       left join capture_audit ca on ca.receipt_id = s.receipt_id
       where s.fetched_at >= $1::timestamptz
       order by s.entity_key, s.fetched_at`,
      [fromTs, toTs],
    );
    const tags = [...new Set(polls.map((p) => p.entity_key))];
    // Hours from a week before the window: the week inside it is judged,
    // the week before it only counts toward "battles in the last 7 days".
    const { rows: hourRows } = await db.query(
      `select bp.player_tag, date_trunc('hour', bp.battle_time) as hour, count(*)::int as n
         from battle_participant bp
        where bp.player_tag = any($1::text[])
          and bp.battle_time > $2::timestamptz - interval '7 days'
          and bp.battle_time <= $3::timestamptz
        group by 1, 2`,
      [tags, fromTs, toTs],
    );
    // Snapshot intervals ending inside the window: the counter's delta
    // against the battles the record holds, and whether a gap fell inside.
    const { rows: intervals } = await db.query(
      `with s as (
         select player_tag, profile_observed_at as observed_at,
                lag(profile_observed_at) over w as observed_from,
                battle_count - lag(battle_count) over w as expected
           from player_snapshot_daily
          where player_tag = any($1::text[])
            and profile_observed_at is not null and battle_count is not null
            and snapshot_date >= ($2::timestamptz - interval '3 days')::date
          window w as (partition by player_tag order by profile_observed_at)
       )
       select s.player_tag, s.observed_from, s.observed_at, s.expected,
              (select count(*)::int from battle_participant bp
                where bp.player_tag = s.player_tag
                  and bp.battle_time > s.observed_from
                  and bp.battle_time <= s.observed_at) as captured,
              (select count(*)::int from capture_audit ca
                where ca.subject_tag = s.player_tag and ca.gap
                  and ca.fetched_at > s.observed_from
                  and ca.fetched_at <= s.observed_at) as gaps,
              (select max(ca.fetched_at) from capture_audit ca
                where ca.subject_tag = s.player_tag and ca.gap
                  and ca.fetched_at > s.observed_from
                  and ca.fetched_at <= s.observed_at) as last_gap_at
         from s
        where s.observed_from is not null
          and s.observed_at > $2::timestamptz and s.observed_at <= $3::timestamptz
          and s.expected is not null and s.expected >= 0`,
      [tags, fromTs, toTs],
    );

    const hours = new Map();
    for (const r of hourRows) {
      if (!hours.has(r.player_tag)) hours.set(r.player_tag, []);
      hours.get(r.player_tag).push([new Date(r.hour).getTime(), r.n]);
    }
    for (const list of hours.values()) list.sort((a, b) => a[0] - b[0]);
    const byTag = new Map();
    for (const p of polls) {
      if (!byTag.has(p.entity_key)) byTag.set(p.entity_key, []);
      byTag.get(p.entity_key).push(p);
    }

    const battlesIn = (tag, aMs, bMs) => {
      const h = hours.get(tag);
      if (!h) return 0;
      let sum = 0;
      for (const [hr, n] of h) {
        if (hr + HOUR <= aMs) continue;
        if (hr >= bMs) break;
        const lo = Math.max(hr, aMs);
        const hi = Math.min(hr + HOUR, bMs);
        if (hi > lo) sum += n * ((hi - lo) / HOUR);
      }
      return sum;
    };
    /** Battles the record could know at `ref` from the seven days before it. */
    const battlesLast7d = (tag, ref) => {
      const h = hours.get(tag);
      if (!h) return 0;
      let n = 0;
      for (const [hr, k] of h) {
        if (hr >= ref) break;
        if (hr >= ref - 7 * DAY) n += k;
      }
      return n;
    };
    const tally = () => ({ polls: 0, empty: 0, over_capacity: 0, battles: 0 });
    const judge = (t, tag, a, b) => {
      const n = battlesIn(tag, a, b);
      t.polls += 1;
      if (n < 0.5) t.empty += 1;
      if (n > capacity) t.over_capacity += 1;
      t.battles += n;
      return n;
    };
    const session = {
      prev_productive: { n: 0, productive: 0, nothing_new: 0 },
      prev_empty: { n: 0, productive: 0, nothing_new: 0 },
    };
    const actual = { ...tally(), nothing_new: 0, gaps: 0 };
    const grid = [];
    for (const f of followups)
      for (const c of ceilings)
        for (const a of actives)
          grid.push({
            followup_min: f,
            ceiling_min: c,
            active_min: a,
            ...tally(),
            cold_polls: 0,
          });
    const endMs = toTs.getTime();
    for (const [tag, list] of byTag) {
      const t0 = new Date(list[0].fetched_at).getTime();
      let prev = t0;
      for (const poll of list.slice(1)) {
        const t = new Date(poll.fetched_at).getTime();
        judge(actual, tag, prev, t);
        if (poll.observed !== null && poll.observed === poll.filtered)
          actual.nothing_new += 1;
        if (poll.gap) actual.gaps += 1;
        if (poll.prev_new_facts !== null) {
          const c =
            poll.prev_new_facts > 0
              ? session.prev_productive
              : session.prev_empty;
          c.n += 1;
          if ((poll.new_facts ?? 0) > 0) c.productive += 1;
          if (poll.observed !== null && poll.observed === poll.filtered)
            c.nothing_new += 1;
        }
        prev = t;
      }
      for (const cell of grid) {
        let ref = t0;
        let streak = (list[0].new_facts ?? 0) > 0 ? 0 : 1;
        for (;;) {
          let wait = Math.min(
            cell.ceiling_min,
            cell.followup_min * 2 ** Math.min(streak, 12),
          );
          let cold = false;
          if (
            cell.active_min > 0 &&
            battlesLast7d(tag, ref) < cell.active_min
          ) {
            wait = Math.max(wait, coldCeiling);
            cold = true;
          }
          const due = ref + wait * 60_000;
          if (due >= endMs) break;
          const n = judge(cell, tag, ref, due);
          if (cold) cell.cold_polls += 1;
          streak = n >= 0.5 ? 0 : streak + 1;
          ref = due;
        }
      }
    }

    // The loss.
    // spec.cutoff (ISO): split the gapped intervals by whether their
    // newest gap fell before or after it - the deploy that changed the
    // schedule, so a day's loss can be read as the old clock's or the
    // new one's (2026-09-21, acceptance part two).
    const cutoffMs = spec.cutoff ? Date.parse(spec.cutoff) : null;
    const loss = {
      intervals: 0,
      players: new Set(),
      gap: { intervals: 0, expected: 0, captured: 0, shortfall: 0, over: 0 },
      no_gap: { intervals: 0, expected: 0, captured: 0, shortfall: 0, over: 0 },
      gap_before_cutoff: { intervals: 0, expected: 0, shortfall: 0, hours: [] },
      gap_after_cutoff: { intervals: 0, expected: 0, shortfall: 0, hours: [] },
      shortfalls: [],
      by_player: new Map(),
    };
    for (const r of intervals) {
      loss.intervals += 1;
      loss.players.add(r.player_tag);
      const side = r.gaps > 0 ? loss.gap : loss.no_gap;
      const expected = Number(r.expected);
      const captured = Number(r.captured);
      side.intervals += 1;
      side.expected += expected;
      side.captured += captured;
      const short = Math.max(0, expected - captured);
      side.shortfall += short;
      side.over += Math.max(0, captured - expected);
      if (r.gaps > 0 && cutoffMs !== null) {
        const part =
          new Date(r.last_gap_at).getTime() < cutoffMs
            ? loss.gap_before_cutoff
            : loss.gap_after_cutoff;
        part.intervals += 1;
        part.expected += expected;
        part.shortfall += short;
        part.hours.push(
          Math.round(
            (new Date(r.observed_at) - new Date(r.observed_from)) / 3600e3,
          ),
        );
      }
      if (r.gaps > 0) {
        loss.shortfalls.push(short);
        const p = loss.by_player.get(r.player_tag) ?? {
          player_tag: r.player_tag,
          gap_intervals: 0,
          gaps: 0,
          expected: 0,
          captured: 0,
          shortfall: 0,
        };
        p.gap_intervals += 1;
        p.gaps += r.gaps;
        p.expected += expected;
        p.captured += captured;
        p.shortfall += short;
        loss.by_player.set(r.player_tag, p);
      }
    }
    const share = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 1000 : null);
    const pct = (xs, q) => {
      if (!xs.length) return null;
      const s = [...xs].sort((a, b) => a - b);
      return s[Math.min(s.length - 1, Math.floor(q * s.length))];
    };
    const noiseRate = share(loss.no_gap.shortfall, loss.no_gap.expected) ?? 0;
    const estimated = Math.max(
      0,
      Math.round(loss.gap.shortfall - noiseRate * loss.gap.expected),
    );
    const finishTally = (t) => ({
      polls: t.polls,
      empty: t.empty,
      over_capacity: t.over_capacity,
      battles: Math.round(t.battles),
      empty_share: share(t.empty, t.polls),
      over_capacity_share: share(t.over_capacity, t.polls),
      polls_ratio: share(t.polls, actual.polls),
      empty_ratio: share(t.empty, actual.empty),
      over_capacity_ratio: share(t.over_capacity, actual.over_capacity),
      polls_per_hour: Math.round(t.polls / (days * 24)),
    });
    return {
      window: { from: fromTs.toISOString(), to: toTs.toISOString(), days },
      params: {
        capacity,
        followups,
        ceilings,
        active_min: actives,
        cold_ceiling: coldCeiling,
      },
      polls: {
        total: polls.length,
        players: tags.length,
        per_hour: Math.round(polls.length / (days * 24)),
        nothing_new: polls.filter(
          (p) => p.observed !== null && p.observed === p.filtered,
        ).length,
        productive: polls.filter((p) => (p.new_facts ?? 0) > 0).length,
        battles: polls.reduce((a, p) => a + (p.new_facts ?? 0), 0),
        audited: polls.filter((p) => p.audited).length,
        gaps: polls.filter((p) => p.gap).length,
      },
      session_control: Object.fromEntries(
        Object.entries(session).map(([k, c]) => [
          k,
          {
            n: c.n,
            productive_share: share(c.productive, c.n),
            nothing_new_share: share(c.nothing_new, c.n),
          },
        ]),
      ),
      replay: {
        actual: {
          ...finishTally(actual),
          nothing_new: actual.nothing_new,
          gaps: actual.gaps,
        },
        rule: grid.map((cell) => ({
          followup_min: cell.followup_min,
          ceiling_min: cell.ceiling_min,
          active_min: cell.active_min,
          cold_polls: cell.cold_polls,
          ...finishTally(cell),
        })),
      },
      loss: {
        intervals: loss.intervals,
        players: loss.players.size,
        gap_intervals: {
          ...loss.gap,
          shortfall_share: share(loss.gap.shortfall, loss.gap.expected),
          shortfall_median: pct(loss.shortfalls, 0.5),
          shortfall_p90: pct(loss.shortfalls, 0.9),
          shortfall_max: pct(loss.shortfalls, 1),
        },
        no_gap_intervals: {
          ...loss.no_gap,
          shortfall_share: noiseRate,
        },
        estimated_lost_battles: estimated,
        by_cutoff:
          cutoffMs === null
            ? null
            : Object.fromEntries(
                ["gap_before_cutoff", "gap_after_cutoff"].map((k) => {
                  const part = loss[k];
                  return [
                    k,
                    {
                      intervals: part.intervals,
                      expected: part.expected,
                      shortfall: part.shortfall,
                      estimated_lost: Math.max(
                        0,
                        Math.round(part.shortfall - noiseRate * part.expected),
                      ),
                      interval_hours_median: pct(part.hours, 0.5),
                      interval_hours_max: pct(part.hours, 1),
                    },
                  ];
                }),
              ),
        estimated_lost_share: share(
          estimated,
          estimated + loss.gap.captured + loss.no_gap.captured,
        ),
        estimated_per_gap_interval: share(estimated, loss.gap.intervals),
        top_players: [...loss.by_player.values()]
          .sort((a, b) => b.shortfall - a.shortfall)
          .slice(0, 12),
      },
      elapsed_ms: Date.now() - started,
    };
  } finally {
    await db.end();
  }
}
