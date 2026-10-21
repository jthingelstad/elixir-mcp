import { gatewayCardIcon } from "@elixir-mcp/record/gateway-cards";
import { ledgerStats } from "@elixir-mcp/ledger";
import {
  eligibleNow,
  queueSummary,
  bulkAllowance,
  BUCKET_CAP_SECONDS,
} from "@elixir-mcp/ledger/plan";
import { chargedRejectionSql } from "@elixir-mcp/ingest/admission";
import {
  RELEASE_SIGNED_SQL,
  signatureState,
} from "@elixir-mcp/collector-door/signature";

/**
 * The body of GET /api/public/status, the public operational dashboard.
 * It lives in a package, beside public-stats, so the migrate Lambda's
 * {profile_read} op can run and EXPLAIN the exact reads the door serves
 * (DECISIONS: "Live diagnostics only through migrate ops"). The door
 * adds only the response and its cache header.
 *
 * `deadLetters` is the door's outbox reader (S3, not the database): the
 * count of messages that ran out of retries, or null when unknown.
 */
export async function readPublicStatus(db, { deadLetters }) {
  // The operational dashboard (Jamie, 2026-09-06): current system
  // health, PUBLIC by design - dead letters, collectors, an hour of
  // capture. Nothing confidential: no IPs, no machine labels, no
  // account data; collectors go by their card names.
  // One pg.Client per invocation: queries run sequentially by design.
  const q = async (sql, params = []) => (await db.query(sql, params)).rows;
  // Operators are credited by name on the public page - Jamie's
  // call, 2026-09-06, asked for and reaffirmed: running a collector
  // is volunteer work and the page should say whose. The credit is
  // the operator's claimed PLAYER, which is public game data
  // already. The account never appears: its email hash has no
  // business on an unauthenticated page. A collector with no owner,
  // or an owner who has claimed no player, simply shows no credit.
  // A collector's last hour and day come from ONE pass over the day's
  // receipts, grouped by collector, on api_receipt_fetched. Three
  // subqueries per collector used to answer it, and from 2026-10-15 to
  // 10-17 the planner walked each collector's whole history through the
  // idempotency index instead: 50 runs over a second, p50 3.6 s
  // (platform review §3). Same filters, same rounding.
  const collectors = await q(
    `with recent as (
       select ar.gateway_id,
              count(*) filter (where ar.fetched_at > now() - interval '1 hour')::int as fetches_1h,
              round(avg(case when ar.new_facts > 0 then 1 else 0 end)
                      filter (where ar.new_facts is not null), 3) as yield_24h,
              sum(ar.observed) filter (where ar.endpoint = 'player_battlelog'
                                         and ar.observed is not null) as observed_24h,
              sum(ar.filtered) filter (where ar.endpoint = 'player_battlelog'
                                         and ar.observed is not null) as filtered_24h
       from api_receipt ar
       where ar.fetched_at > now() - interval '24 hours'
       group by ar.gateway_id
     )
     select coalesce(g.card_name, 'unnamed') as name, avatar.card_id, avatar.icon_medium, g.status,
            g.channel, g.last_success_at, g.last_heartbeat_at,
            g.last_seen_sha, g.binary_sha256,
            ${RELEASE_SIGNED_SQL},
            op.name as operator,
            op.player_tag as operator_tag,
            coalesce(rc.fetches_1h, 0) as fetches_1h,
            rc.yield_24h,
            case when rc.observed_24h > 0
                 then round(rc.filtered_24h::numeric / rc.observed_24h, 3) end as edge_filtered_24h
     from gateway g
     left join recent rc on rc.gateway_id = g.gateway_id
     left join card avatar on avatar.name = g.card_name and avatar.kind = 'card'
     left join lateral (
       select p.name, p.player_tag
       from claim c join player p on p.player_tag = c.player_tag
       -- Public operator credit is the PRIMARY player only (DECISIONS:
       -- privacy): no primary, no name, never another claimed player.
       where c.account_id = g.owner_account_id and c.is_primary
       limit 1
     ) op on true
     where g.status in ('active', 'probation', 'pending')
       and g.name <> 'backfill-elixir-bot'
     order by g.enrolled_at`,
  );
  // Stack order and colour follow the COLLECTOR, never its rank:
  // keyed on enrolled_at, which never changes, so a new collector
  // appends a colour instead of repainting everyone else's.
  const captureSeries = (
    await q(
      `select coalesce(card_name, 'unnamed') as name
       from gateway
       where name <> 'backfill-elixir-bot'
       order by enrolled_at, gateway_id`,
    )
  ).map((r) => r.name);
  // Capture is charted STACKED BY COLLECTOR, so both series carry a
  // per-collector breakdown. Empty slots are generated rather than
  // omitted: a quiet stretch is a real zero on a time axis, not a
  // gap that silently compresses it.
  const captureRows = async (truncSql, sinceSql, stepSql) =>
    q(
      `with slots as (
         select generate_series(${truncSql("$since$")}, ${truncSql("now()")},
                                interval '${stepSql}') as slot
       ),
       agg as (
         select ${truncSql("r.fetched_at")} as slot,
                coalesce(g.card_name, 'unnamed') as name,
                count(*)::int as fetches,
                count(*) filter (where r.admission = 'admitted')::int as admitted,
                count(*) filter (where ${chargedRejectionSql("r")})::int as rejected
         from api_receipt r
         join gateway g on g.gateway_id = r.gateway_id
         where r.fetched_at >= ${truncSql("$since$")}
           and g.name <> 'backfill-elixir-bot'
         group by 1, 2
       )
       select to_char(s.slot, 'HH24:MI') as bucket, a.name,
              coalesce(a.fetches, 0) as fetches,
              coalesce(a.admitted, 0) as admitted,
              coalesce(a.rejected, 0) as rejected
       from slots s
       left join agg a on a.slot = s.slot
       order by s.slot, a.name`.replaceAll("$since$", sinceSql),
    );
  // Fold (slot, collector) rows into one object per bucket carrying a
  // `by` map the chart stacks.
  const foldCapture = (rows) => {
    const out = new Map();
    for (const r of rows) {
      let b = out.get(r.bucket);
      if (!b) {
        b = {
          bucket: r.bucket,
          fetches: 0,
          admitted: 0,
          rejected: 0,
          by: {},
        };
        out.set(r.bucket, b);
      }
      if (!r.name) continue; // generated empty slot
      b.fetches += r.fetches;
      b.admitted += r.admitted;
      b.rejected += r.rejected;
      b.by[r.name] = (b.by[r.name] ?? 0) + r.fetches;
    }
    return [...out.values()];
  };
  const FIVE_MIN = (col) =>
    `(date_trunc('minute', ${col}) - make_interval(mins => extract(minute from ${col})::int % 5))`;
  const HOURLY = (col) => `date_trunc('hour', ${col})`;
  const hour = foldCapture(
    await captureRows(FIVE_MIN, "(now() - interval '70 minutes')", "5 minutes"),
  );
  const day = foldCapture(
    await captureRows(HOURLY, "(now() - interval '23 hours')", "1 hour"),
  );
  // Two freshness counters, each one probe of api_receipt_fetched from
  // the newest end. They used to share one aggregate, and a FILTERed
  // max cannot use an index: every status read scanned all of
  // api_receipt (about 18,000 blocks from disk, 700 ms), the largest
  // reader in pg_stat_statements since 2026-09-06 (41.7M blocks over
  // 4,838 calls). The same maxima, and null when there is none.
  const latest = await q(
    `select extract(epoch from now() - (select max(fetched_at) from api_receipt))::int as last_fetch_s,
            extract(epoch from now() - (select max(fetched_at) from api_receipt
                                         where admission = 'admitted'))::int as last_admit_s`,
  );
  const hourTotals = await q(
    `select count(*)::int as battles_1h from battle
     where created_at > now() - interval '1 hour'`,
  );
  const audit = await q(
    `select count(*)::int as polls,
            count(*) filter (where gap)::int as gaps
     from capture_audit where fetched_at > now() - interval '24 hours'`,
  );
  // The global Clash Royale request budget.
  //
  // The headline is the last 24 hours against the BULK share of a
  // day's budget (rate x 86,400 x (1 - live_reserve)): consumed load
  // against the capacity the planner may actually spend. The hour
  // beside it is a rolling 60 minutes. Until 2026-09-27 the hour was
  // the calendar hour against an elapsed-fraction "expected", so a
  // read at 05:10Z said "152 of 636" while the rolling hour was 28%.
  // charged_24h is what the bucket was charged, by lane (0187): the
  // tick's inserted bulk rows and one token per live mint.
  const budgetRow = await q(
    `select rate_per_sec, live_reserve, tokens, settled_at from budget_state`,
  );
  const usedRow = await q(
    `select count(*)::int as used_24h,
            count(*) filter (where r.fetched_at > now() - interval '1 hour')::int as used,
            count(*) filter (where r.fetched_at > now() - interval '1 hour'
                               and r.new_facts > 0)::int as useful,
            count(*) filter (where r.fetched_at > now() - interval '1 hour'
                               and r.new_facts is not null)::int as measured
     from api_receipt r join gateway g on g.gateway_id = r.gateway_id
     where r.fetched_at > now() - interval '24 hours'
       and g.name <> 'backfill-elixir-bot'`,
  );
  const chargedRows = await q(
    `select lane, sum(charged)::int as charged from budget_charge
     where hour >= date_trunc('hour', now() - interval '23 hours')
     group by lane`,
  );
  const charged = Object.fromEntries(
    chargedRows.map((r) => [r.lane, r.charged]),
  );
  const ratePerSec = Number(budgetRow[0]?.rate_per_sec ?? 1);
  const liveReserve = Number(budgetRow[0]?.live_reserve ?? 0);
  const nowMs = Date.now();
  const settledAt = budgetRow[0]?.settled_at
    ? new Date(budgetRow[0].settled_at)
    : null;
  const tokensNow = Math.min(
    ratePerSec * BUCKET_CAP_SECONDS,
    Number(budgetRow[0]?.tokens ?? 0) +
      (settledAt ? ((nowMs - settledAt.getTime()) / 1000) * ratePerSec : 0),
  );
  const bulkCapacity24h = Math.round(ratePerSec * 86400 * (1 - liveReserve));
  const fetches24h = usedRow[0]?.used_24h ?? 0;
  const budget = {
    rate_per_sec: ratePerSec,
    live_reserve: liveReserve,
    fetches_24h: fetches24h,
    bulk_capacity_24h: bulkCapacity24h,
    share_24h:
      bulkCapacity24h > 0
        ? Math.round((fetches24h / bulkCapacity24h) * 1000) / 1000
        : null,
    capacity_24h: Math.round(ratePerSec * 86400),
    // The last 60 minutes, rolling.
    used_hour: usedRow[0]?.used ?? 0,
    capacity_hour: Math.round(ratePerSec * 3600),
    // Of those, how many changed the record (0077) - the number that
    // says whether the budget bought information or repetition.
    useful_hour: usedRow[0]?.useful ?? 0,
    measured_hour: usedRow[0]?.measured ?? 0,
    charged_24h: { bulk: charged.bulk ?? 0, live: charged.live ?? 0 },
    tokens: Math.floor(tokensNow),
  };

  const dead = await deadLetters();
  const jobs = await ledgerStats(db).catch(() => null);
  // Work waiting, as a pipeline: due for the next tick (the scheduler
  // only plans every SCHEDULER_TICK_MINUTES, so due-ness accumulates
  // between ticks), queued for a collector, leased (being fetched),
  // done in the last hour. The next tick can plan at most the bulk
  // allowance, which is what the gauge fills against.
  const tickMinutes =
    Number(process.env.SCHEDULER_TICK_MINUTES ?? 5) > 0
      ? Number(process.env.SCHEDULER_TICK_MINUTES ?? 5)
      : 5;
  let due = null;
  try {
    due = queueSummary(await eligibleNow(db, new Date(nowMs)));
  } catch (err) {
    console.error("status_queue_failed", err?.message);
  }
  const queue = {
    due_now: due?.due ?? null,
    due_starved: due?.starved ?? null,
    due_by_endpoint: due?.by_endpoint ?? null,
    queued: (jobs?.queued_bulk ?? 0) + (jobs?.queued_live ?? 0),
    leased: jobs?.leased ?? 0,
    done_hour: budget.used_hour,
    last_tick_at: settledAt?.toISOString() ?? null,
    next_tick_at: settledAt
      ? new Date(settledAt.getTime() + tickMinutes * 60_000).toISOString()
      : null,
    tick_minutes: tickMinutes,
    // What the next tick may add: the bulk share of the tokens, less
    // what is already queued (the planner's own bulkAllowance).
    next_tick_capacity: bulkAllowance({
      tokens: tokensNow,
      cap: ratePerSec * BUCKET_CAP_SECONDS,
      liveReserve,
      queuedBulk: jobs?.queued_bulk ?? 0,
    }),
  };
  // Health verdict derived from data, never vibes: pipeline is OK
  // when something was admitted recently, no message has run out of
  // retries (an outbox object past its lane's last retry), and no
  // ledger job has died (0040).
  const dlqDepth = dead ?? 0;
  const lastAdmit = latest[0]?.last_admit_s;
  const healthy =
    dlqDepth === 0 &&
    (jobs?.dead ?? 0) === 0 &&
    lastAdmit !== null &&
    lastAdmit < 1800;
  return {
    as_of: new Date().toISOString(),
    health: {
      ok: healthy,
      last_fetch_seconds: latest[0]?.last_fetch_s ?? null,
      last_admission_seconds: lastAdmit ?? null,
      dlq_messages: dlqDepth,
      battles_last_hour: hourTotals[0]?.battles_1h ?? 0,
      capture_audit_24h: {
        polls: audit[0]?.polls ?? 0,
        gaps: audit[0]?.gaps ?? 0,
      },
    },
    budget,
    queue,
    jobs,
    collectors: collectors.map((c) => ({
      name: c.name,
      card_icon: gatewayCardIcon(c),
      status: c.status,
      last_success_at: c.last_success_at?.toISOString() ?? null,
      last_heartbeat_at: c.last_heartbeat_at?.toISOString() ?? null,
      operator: c.operator ?? null,
      operator_tag: c.operator_tag ?? null,
      // The client version the collector last submitted with
      // (x-collector-version; the column predates the rename).
      // Public because the client is: a fleet that has not all
      // picked up a named release is visible at a glance.
      version: c.last_seen_sha ?? null,
      // Whether that version is byte for byte a release the hub
      // named (0184): signed, dev_build, unverified (the collector
      // sent no hash) or mismatch. The state only; the hash is the
      // operator's and Admin's.
      signature: signatureState(c),
      // Which lane this collector drains. The live lane is what serves
      // an interactive live_fetch, so "who can answer a request right
      // now" is a different question from "who is capturing", and the
      // page could not previously tell them apart.
      channel: c.channel ?? "bulk",
      fetches_1h: c.fetches_1h,
      // What the fetches were worth (0077): share of the last day's
      // that changed the record, and the share of battle-log
      // entries dropped at the edge. Null until receipts carry it.
      yield_24h: c.yield_24h === null ? null : Number(c.yield_24h),
      edge_filtered_24h:
        c.edge_filtered_24h === null ? null : Number(c.edge_filtered_24h),
    })),
    capture_series: captureSeries,
    capture_5m: hour,
    capture_24h: day,
    note: "Live operational snapshot, ~60s cache. Collectors go by their card names; the backfill lane is excluded.",
  };
}
