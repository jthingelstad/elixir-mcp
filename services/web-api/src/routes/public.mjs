import { ledgerStats } from "../../../scheduler/src/ledger.mjs";
import {
  eligibleNow,
  queueSummary,
  lossBoundArm,
  BUCKET_CAP_SECONDS,
} from "../../../scheduler/src/plan.mjs";

import { json } from "../http.mjs";

export function publicRoutes({ queueStats }) {
  return {
    "GET /api/public/status": async (db) => {
      // The operational dashboard (Jamie, 2026-09-06): current system
      // health, PUBLIC by design - queues, collectors, an hour of
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
      const collectors = await q(
        `select coalesce(g.card_name, 'unnamed') as name, g.card_icon, g.status,
                g.channel, g.last_success_at, g.last_heartbeat_at,
                op.name as operator,
                op.player_tag as operator_tag,
                (select count(*)::int from api_receipt ar
                 where ar.gateway_id = g.gateway_id
                   and ar.fetched_at > now() - interval '1 hour') as fetches_1h
         from gateway g
         left join lateral (
           select p.name, p.player_tag
           from claim c join player p on p.player_tag = c.player_tag
           where c.account_id = g.owner_account_id
           order by c.is_primary desc, (c.status = 'verified') desc, c.created_at
           limit 1
         ) op on true
         where g.status in ('active', 'probation', 'pending')
           and g.name <> 'backfill-elixir-bot'
         order by g.fetch_points desc`,
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
                    count(*) filter (where r.admission = 'rejected')::int as rejected
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
        await captureRows(
          FIVE_MIN,
          "(now() - interval '70 minutes')",
          "5 minutes",
        ),
      );
      const day = foldCapture(
        await captureRows(HOURLY, "(now() - interval '23 hours')", "1 hour"),
      );
      const latest = await q(
        `select extract(epoch from now() - max(fetched_at))::int as last_fetch_s,
                extract(epoch from now() - max(fetched_at)
                  filter (where admission = 'admitted'))::int as last_admit_s
         from api_receipt`,
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
      // The global Clash Royale request budget, sliced to the calendar hour.
      //
      // It is really a continuous token bucket (rate_per_sec, burst), not an
      // hourly allowance — but "how much of this hour have we spent" is the
      // question an operator actually has, and a bucket is unreadable at a
      // glance. `expected` is elapsed-fraction of capacity: level with `used`
      // means on pace, well under means idle, over means a burst. Without it
      // 500 spent at ten past and 500 at five to look identical.
      const budgetRow = await q(
        `select rate_per_sec, burst, live_reserve, tokens, settled_at from budget_state`,
      );
      const usedRow = await q(
        `select count(*)::int as used from api_receipt
         where fetched_at >= date_trunc('hour', now())`,
      );
      const ratePerSec = Number(budgetRow[0]?.rate_per_sec ?? 1);
      const nowMs = Date.now();
      const hourStart = new Date(nowMs);
      hourStart.setUTCMinutes(0, 0, 0);
      const elapsed = (nowMs - hourStart.getTime()) / 3_600_000;
      const budget = {
        rate_per_sec: ratePerSec,
        capacity_hour: Math.round(ratePerSec * 3600),
        used_hour: usedRow[0]?.used ?? 0,
        expected_hour: Math.round(ratePerSec * 3600 * elapsed),
        hour_started_at: hourStart.toISOString(),
        live_reserve: Number(budgetRow[0]?.live_reserve ?? 0),
      };

      const queues = await queueStats();
      const jobs = await ledgerStats(db).catch(() => null);
      // Work waiting, as a pipeline: due for the next tick (the scheduler
      // only plans every SCHEDULER_TICK_MINUTES, so due-ness accumulates
      // between ticks), queued for a collector, leased (being fetched),
      // done this hour. The next tick can plan at most the bulk share of
      // the token bucket, which is what the gauge fills against.
      const tickMinutes =
        Number(process.env.SCHEDULER_TICK_MINUTES ?? 5) > 0
          ? Number(process.env.SCHEDULER_TICK_MINUTES ?? 5)
          : 5;
      const settledAt = budgetRow[0]?.settled_at
        ? new Date(budgetRow[0].settled_at)
        : null;
      const liveReserve = Number(budgetRow[0]?.live_reserve ?? 0);
      const tokensNow = Math.min(
        ratePerSec * BUCKET_CAP_SECONDS,
        Number(budgetRow[0]?.tokens ?? 0) +
          (settledAt ? ((nowMs - settledAt.getTime()) / 1000) * ratePerSec : 0),
      );
      let due = null;
      try {
        due = queueSummary(
          await eligibleNow(db, new Date(nowMs), lossBoundArm()),
        );
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
        next_tick_capacity: Math.max(
          0,
          Math.floor(tokensNow * (1 - liveReserve)),
        ),
      };
      // Health verdict derived from data, never vibes: pipeline is OK
      // when something was admitted recently, no DLQ holds messages,
      // and no ledger job has died (0040).
      const dlqDepth = ["live_dlq", "bulk_dlq", "results_dlq", "email_dlq"]
        .map((k) => queues?.[k]?.depth ?? 0)
        .reduce((a, b) => a + b, 0);
      const lastAdmit = latest[0]?.last_admit_s;
      const healthy =
        dlqDepth === 0 &&
        (jobs?.dead ?? 0) === 0 &&
        lastAdmit !== null &&
        lastAdmit < 1800;
      return json(
        200,
        {
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
          queues,
          jobs,
          collectors: collectors.map((c) => ({
            name: c.name,
            card_icon: c.card_icon,
            status: c.status,
            last_success_at: c.last_success_at?.toISOString() ?? null,
            last_heartbeat_at: c.last_heartbeat_at?.toISOString() ?? null,
            operator: c.operator ?? null,
            operator_tag: c.operator_tag ?? null,
            // Which lane this collector drains. The live lane is what serves
            // an interactive live_fetch, so "who can answer a request right
            // now" is a different question from "who is capturing", and the
            // page could not previously tell them apart.
            channel: c.channel ?? "bulk",
            fetches_1h: c.fetches_1h,
          })),
          capture_series: captureSeries,
          capture_5m: hour,
          capture_24h: day,
          note: "Live operational snapshot, ~60s cache. Collectors go by their card names; the backfill lane is excluded.",
        },
        { "cache-control": "public, max-age=60" },
      );
    },

    "GET /api/public/stats": async (db) => {
      // The public data story (SITE-IA 2026-09-05): corpus scale and
      // full-history daily series. No auth, no account data - the
      // universal-reads boundary applied to aggregates. CloudFront
      // caches it for an hour.
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
                (select count(*) filter (where subject_type = 'player')::int
                 from recording where status = 'active') as players_recording,
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
      const fetchesDaily = await q(
        `select (r.fetched_at at time zone 'UTC')::date::text as day,
                count(*)::int as fetches,
                count(distinct r.gateway_id)::int as collectors
         from api_receipt r join gateway g on g.gateway_id = r.gateway_id
         where g.name <> 'backfill-elixir-bot'
         group by 1 order by 1`,
      );
      return json(
        200,
        {
          totals: {
            ...totals,
            oldest_battle: totals.oldest_battle?.toISOString() ?? null,
            newest_battle: totals.newest_battle?.toISOString() ?? null,
          },
          series: {
            battles_daily: battlesDaily,
            players_observed_daily: observedDaily,
            fetches_daily: fetchesDaily,
          },
          note: "Recorded history only - the corpus began 2026-09-03 plus imported archives; battle days predate observation days where archives were replayed.",
        },
        { "cache-control": "public, max-age=3600" },
      );
    },
  };
}
