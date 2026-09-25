import { ledgerStats } from "../../../scheduler/src/ledger.mjs";
import {
  eligibleNow,
  queueSummary,
  BUCKET_CAP_SECONDS,
} from "../../../scheduler/src/plan.mjs";

import { json } from "../http.mjs";
import { DISCLAIMER, cardForms, cardType } from "@elixir-mcp/contracts";
import { RECORDED_PLAYERS_SQL } from "../../../mcp/src/tools/shared.mjs";

export function publicRoutes({ deadLetters }) {
  return {
    "GET /api/public/status": async (db) => {
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
      const collectors = await q(
        `select coalesce(g.card_name, 'unnamed') as name, g.card_icon, g.status,
                g.channel, g.last_success_at, g.last_heartbeat_at,
                g.last_seen_sha,
                op.name as operator,
                op.player_tag as operator_tag,
                (select count(*)::int from api_receipt ar
                 where ar.gateway_id = g.gateway_id
                   and ar.fetched_at > now() - interval '1 hour') as fetches_1h,
                (select round(avg(case when ar.new_facts > 0 then 1 else 0 end), 3)
                   from api_receipt ar where ar.gateway_id = g.gateway_id
                   and ar.fetched_at > now() - interval '24 hours'
                   and ar.new_facts is not null) as yield_24h,
                (select case when sum(ar.observed) > 0
                          then round(sum(ar.filtered)::numeric / sum(ar.observed), 3) end
                   from api_receipt ar where ar.gateway_id = g.gateway_id
                   and ar.endpoint = 'player_battlelog'
                   and ar.fetched_at > now() - interval '24 hours'
                   and ar.observed is not null) as edge_filtered_24h
         from gateway g
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
        `select count(*)::int as used,
                count(*) filter (where new_facts > 0)::int as useful,
                count(*) filter (where new_facts is not null)::int as measured
         from api_receipt
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
        // Of those, how many changed the record (0077) - the number that
        // says whether the budget bought information or repetition.
        useful_hour: usedRow[0]?.useful ?? 0,
        measured_hour: usedRow[0]?.measured ?? 0,
        expected_hour: Math.round(ratePerSec * 3600 * elapsed),
        hour_started_at: hourStart.toISOString(),
        live_reserve: Number(budgetRow[0]?.live_reserve ?? 0),
      };

      const dead = await deadLetters();
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
        next_tick_capacity: Math.max(
          0,
          Math.floor(tokensNow * (1 - liveReserve)),
        ),
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
          jobs,
          collectors: collectors.map((c) => ({
            name: c.name,
            card_icon: c.card_icon,
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
        },
        { "cache-control": "public, max-age=60" },
      );
    },

    // The card catalog and one card's record, PUBLIC and sign-in free
    // (docs/EMAIL.md, the Friday kind): this is where a forwarded Card
    // of the Week lands, and what the art mirror reads. The same
    // numbers the tools give, refreshed by the nightly rollup.
    "GET /api/public/cards": async (db) => {
      const { readCatalog } = await import("../../../mcp/src/tools/cards.mjs");
      const catalog = await readCatalog(db);
      if (!catalog) return json(503, { error: "catalog_empty" });
      return json(
        200,
        {
          cards: catalog.cards,
          as_of: catalog.as_of,
          disclaimer: DISCLAIMER,
        },
        { "cache-control": "public, max-age=3600" },
      );
    },

    "GET /api/public/cards/*": async (db, event) => {
      const cardId = Number(event.pathParam);
      if (!Number.isInteger(cardId)) return json(404, { error: "not_found" });
      const {
        rows: [card],
      } = await db.query(
        `select card_id, name, kind, rarity, elixir_cost, max_evolution_level,
                icon_medium, icon_evolution_medium, icon_hero_medium
           from card where card_id = $1 and kind = 'card'`,
        [cardId],
      );
      if (!card) return json(404, { error: "not_found" });
      // Season by season, from the same rollup cards_card reads.
      const { rows: history } = await db.query(
        `select cm.season_month, cm.battles, cm.wins, cm.losses, cm.players,
                t.decided
           from card_meta_season cm
           join meta_season_totals t
             on t.season_month = cm.season_month and t.mode_group = cm.mode_group
          where cm.card_id = $1 and cm.form = -1 and cm.mode_group = 'all'
          order by cm.season_month`,
        [cardId],
      );
      const current = history.at(-1)?.season_month ?? null;
      const { rows: modes } = await db.query(
        `select cm.mode_group, cm.battles, cm.wins, cm.losses, cm.players,
                t.decided
           from card_meta_season cm
           join meta_season_totals t
             on t.season_month = cm.season_month and t.mode_group = cm.mode_group
          where cm.card_id = $1 and cm.form = -1 and cm.season_month = $2
            and cm.mode_group <> 'all'
          order by cm.battles desc`,
        [cardId, current],
      );
      // The latest issue about this card, when one has actually sent.
      const {
        rows: [issue],
      } = await db.query(
        `select f.period_key, f.sent_at, i.subject_line
           from email_featured_card f
           left join email_issue i
             on i.kind = 'card_of_week' and i.period_key = f.period_key
          where f.card_id = $1 and f.sent_at is not null
          order by f.sent_at desc limit 1`,
        [cardId],
      );
      const rate = (w, l) =>
        w + l > 0 ? Number((w / (w + l)).toFixed(3)) : null;
      const share = (n, d) => (d > 0 ? Number((n / d).toFixed(4)) : null);
      const row = (r) => ({
        battles: r.battles,
        players: r.players,
        decided_battles: Number(r.decided),
        usage_share: share(r.battles, Number(r.decided)),
        win_rate: rate(r.wins, r.losses),
      });
      return json(
        200,
        {
          card: {
            id: card.card_id,
            name: card.name,
            rarity: card.rarity,
            elixir_cost: card.elixir_cost,
            forms_available: cardForms(card.max_evolution_level),
            type: cardType(card.card_id),
          },
          season: current,
          history: history.map((h) => ({
            season_month: h.season_month,
            ...row(h),
          })),
          by_mode: modes.map((m) => ({ mode_group: m.mode_group, ...row(m) })),
          issue: issue
            ? {
                period_key: issue.period_key,
                subject: issue.subject_line,
                sent_at: issue.sent_at,
              }
            : null,
          disclaimer: DISCLAIMER,
        },
        { "cache-control": "public, max-age=900" },
      );
    },

    "GET /api/public/efficiency": async (db) => {
      // The session clock's cost and loss, per day (0145; Jamie,
      // 2026-09-19: the breakage belongs on the collector pages).
      // PUBLIC like the status page: aggregates only, no player named.
      // The closed days come from the nightly table; the current UTC
      // day is read live from the receipts (polls, what they found,
      // gaps) - its loss cannot be known until its snapshot intervals
      // close, so it carries lost_battles: null.
      const q = async (sql, params = []) => (await db.query(sql, params)).rows;
      const days = await q(
        `select day::text, computed_at, battlelog_polls, productive_polls,
                nothing_new_polls, battles_captured, audited_polls, gaps,
                intervals, gap_intervals, expected_gap, captured_gap,
                shortfall_gap, expected_no_gap, shortfall_no_gap, noise_rate,
                lost_battles, players_with_gaps
           from capture_efficiency_daily
          where day >= (now() at time zone 'UTC')::date - 28
          order by day`,
      );
      const [today] = await q(
        `select (now() at time zone 'UTC')::date::text as day,
                count(*)::int as battlelog_polls,
                count(*) filter (where r.new_facts > 0)::int as productive_polls,
                count(*) filter (where r.observed is not null and r.observed = r.filtered)::int as nothing_new_polls,
                coalesce(sum(r.new_facts), 0)::int as battles_captured,
                count(ca.receipt_id)::int as audited_polls,
                count(ca.receipt_id) filter (where ca.gap)::int as gaps
           from api_receipt r
           join gateway g on g.gateway_id = r.gateway_id
           left join capture_audit ca on ca.receipt_id = r.receipt_id
          where g.name <> 'backfill-elixir-bot'
            and r.endpoint = 'player_battlelog' and r.admission = 'admitted'
            and r.fetched_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'`,
      );
      const [hour] = await q(
        `select count(*)::int as battlelog_polls,
                count(*) filter (where r.observed is not null and r.observed = r.filtered)::int as nothing_new_polls,
                count(ca.receipt_id) filter (where ca.gap)::int as gaps
           from api_receipt r
           join gateway g on g.gateway_id = r.gateway_id
           left join capture_audit ca on ca.receipt_id = r.receipt_id
          where g.name <> 'backfill-elixir-bot'
            and r.endpoint = 'player_battlelog' and r.admission = 'admitted'
            and r.fetched_at > now() - interval '1 hour'`,
      );
      return json(
        200,
        {
          as_of: new Date().toISOString(),
          rule: {
            followup_minutes: 30,
            ceiling_minutes: 120,
            profile_daily: true,
            since: "2026-09-19",
          },
          days: days.map((d) => ({
            ...d,
            noise_rate: d.noise_rate === null ? null : Number(d.noise_rate),
            computed_at: d.computed_at?.toISOString?.() ?? d.computed_at,
          })),
          today: { ...today, lost_battles: null },
          last_hour: hour,
          note: "Battles lost are measured nightly against the game's own lifetime battle counter over profile snapshot intervals; intervals without a capture gap set the noise floor (modes the battle log never shows). The current day's loss is known the morning after.",
        },
        { "cache-control": "public, max-age=300" },
      );
    },

    "GET /api/public/stats": async (db) => {
      // The public data story (docs/archive/SITE-IA.md, 2026-09-05): corpus scale and
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
                -- Recorded players as the tools count them: recorded
                -- directly or as a member of a comprehensively recorded
                -- clan. A player known only from a battle stub is a ghost
                -- entry and never the headline (Jamie, 2026-09-23).
                (select count(distinct player_tag)::int
                 from (${RECORDED_PLAYERS_SQL}) rp) as players_recording,
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
