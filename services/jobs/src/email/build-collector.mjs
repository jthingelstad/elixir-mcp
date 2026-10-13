/** collector_activity: one mail per ACCOUNT, every collector it runs
 *  pooled (Jamie, 2026-09-18). Fetches from api_receipt (the ledger the
 *  fleet pages read), pacing and gaps from the receipt times, and the
 *  tier: an active collector earns the Family tier, and nothing else
 *  (#539; points, credits and bonus slots retired). Only accounts with
 *  a collector get one. */
import {
  RELEASE_SIGNED_SQL,
  signatureState,
} from "@elixir-mcp/collector-door/signature";
import { chargedRejectionSql } from "@elixir-mcp/ingest/admission";
import { silentSince } from "@elixir-mcp/ingest/fleet";

const QUIET_GAP_MS = 3 * 3600_000;

export async function buildCollector({ db, account, week, now = new Date() }) {
  const { rows: gws } = await db.query(
    // The card a collector is named for, by id, for its art (the
    // elixir_collectors tool lists the whole fleet and no owner, so the
    // account's own collectors are read here, the way the console does).
    `select g.gateway_id, g.name, g.card_name, g.status, g.enrolled_at,
            g.last_seen_sha, g.binary_sha256, ${RELEASE_SIGNED_SQL}, g.missed_streak, g.last_heartbeat_at, c.card_id
       from gateway g
       left join card c on c.name = g.card_name and c.kind = 'card'
      where g.owner_account_id = $1 and g.status <> 'revoked'
      order by g.enrolled_at`,
    [account.accountId],
  );
  if (gws.length === 0) return null;
  const ids = gws.map((g) => g.gateway_id);
  const from = week.from.toISOString();
  const to = week.to.toISOString();
  const { rows: per } = await db.query(
    `select gateway_id,
            count(*)::int as fetches,
            count(*) filter (where ${chargedRejectionSql()})::int as rejected,
            coalesce(sum(api_bytes), 0)::bigint as api_bytes,
            coalesce(sum(coalesce(observed, 0) - coalesce(filtered, 0)), 0)::bigint as kept,
            coalesce(sum(coalesce(filtered, 0)), 0)::bigint as filtered,
            coalesce(sum(new_facts), 0)::bigint as new_facts,
            -- Fetches that added to the record (ingest/pipeline.mjs,
            -- new_facts > 0), not the facts they added.
            count(*) filter (where admission <> 'rejected' and new_facts > 0)::int as adding_fetches
       from api_receipt
      where gateway_id = any($1) and fetched_at >= $2 and fetched_at < $3
      group by gateway_id`,
    [ids, from, to],
  );
  const { rows: fleet } = await db.query(
    `select count(*)::int as fetches from api_receipt where fetched_at >= $1 and fetched_at < $2`,
    [from, to],
  );
  const { rows: byEndpoint } = await db.query(
    `select endpoint, count(*)::int as n from api_receipt
      where gateway_id = any($1) and fetched_at >= $2 and fetched_at < $3
      group by endpoint order by n desc`,
    [ids, from, to],
  );
  // Quiet stretches: gaps of three hours or more between a collector's
  // receipts inside the week (a collector that leases nothing for three
  // hours is off, asleep, or blocked).
  const { rows: gaps } = await db.query(
    `select gateway_id, sum(gap)::float8 as quiet_ms, count(*)::int as stretches from (
       select gateway_id,
              extract(epoch from (fetched_at - lag(fetched_at) over (partition by gateway_id order by fetched_at))) * 1000 as gap
         from api_receipt where gateway_id = any($1) and fetched_at >= $2 and fetched_at < $3) g
      where gap >= $4 group by gateway_id`,
    [ids, from, to, QUIET_GAP_MS],
  );
  const perById = new Map(per.map((r) => [r.gateway_id, r]));
  const gapById = new Map(gaps.map((r) => [r.gateway_id, r]));
  const collectors = gws.map((g) => {
    const p = perById.get(g.gateway_id);
    const q = gapById.get(g.gateway_id);
    const quietHours = q ? Math.round(q.quiet_ms / 3600_000) : 0;
    // What it is doing now, the tool's rule (elixir_collectors): an
    // active one that has not checked in for an hour reads silent.
    const silent = silentSince(g, now.getTime());
    return {
      name: g.card_name ?? g.name,
      card_id: g.card_id ?? null,
      status: g.status,
      state: silent ? "silent" : g.status,
      since: silent
        ? silent.toISOString()
        : g.status === "active"
          ? null
          : (g.last_heartbeat_at?.toISOString?.() ?? null),
      version: g.last_seen_sha ?? null,
      signature_state: signatureState(g),
      fetches: p?.fetches ?? 0,
      errors: p?.rejected ?? 0,
      breaker_trips: 0,
      quiet_hours: quietHours,
      note: q
        ? `${q.stretches} quiet stretch${q.stretches === 1 ? "" : "es"} of 3 h or more`
        : null,
      adding_fetches: Number(p?.adding_fetches ?? 0),
    };
  });
  const fetches = collectors.reduce((s, c) => s + c.fetches, 0);
  const apiBytes = per.reduce((s, r) => s + Number(r.api_bytes), 0);
  const kept = per.reduce((s, r) => s + Number(r.kept), 0);
  const filtered = per.reduce((s, r) => s + Number(r.filtered), 0);
  const newFacts = per.reduce((s, r) => s + Number(r.new_facts), 0);
  // What running one earns (#539): the Family tier while one of the
  // account's collectors is active. A granted tier (partner, admin,
  // owner) already sits above it; account.role is the tier read now.
  const granted = ["partner", "admin", "owner"].includes(account.role);
  const tier = {
    role: account.role ?? "member",
    family_earned: gws.some((g) => g.status === "active"),
    granted,
  };
  return {
    week: { label: week.label, key: week.key },
    account: { name: account.email },
    collectors,
    totals: {
      fetches,
      of_fleet: fleet[0]?.fetches ? fetches / fleet[0].fetches : null,
      api_bytes: apiBytes || null,
      submitted_bytes: null,
      saved_share: kept + filtered > 0 ? filtered / (kept + filtered) : null,
      errors: collectors.reduce((s, c) => s + c.errors, 0),
      breaker_trips: 0,
      quiet_hours: collectors.reduce((s, c) => s + c.quiet_hours, 0),
    },
    by_endpoint: byEndpoint.map((r) => [endpointLabel(r.endpoint), r.n]),
    tier,
    fleet_note: `${newFacts.toLocaleString("en-US")} new facts entered the record through your collectors this week (battles, membership events, moved snapshots, changed cards).`,
    coverage:
      "Counted from the collector ledger: every fetch your collectors submitted from Saturday 00:00 UTC to the next Saturday 00:00 UTC. The edge filter share is what the collectors read and dropped as already recorded.",
  };
}

function endpointLabel(e) {
  return (
    {
      player_battlelog: "player battle logs",
      player: "player profiles",
      clan: "clan rosters",
      currentriverrace: "river race",
      riverracelog: "river race log",
      cards: "cards",
      rankings_players: "rankings",
      rankings_pol: "Path of Legends board",
      rankings_pol_season: "season finals",
      rankings_clans_loc: "clan ladders",
      rankings_clanwars: "clan war ladders",
      leaderboards: "leaderboards",
      leaderboard: "mode boards",
      events: "events",
      globaltournaments: "global tournaments",
    }[e] ?? e
  );
}
