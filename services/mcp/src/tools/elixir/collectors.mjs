import { responseMeta } from "@elixir-mcp/contracts";
import { silentSince } from "../../../../ingest/src/fleet.mjs";
import { ensureGatewayCards } from "../../gateway-cards.mjs";
import { docsRef, notes } from "../shared.mjs";

export const elixir_collectors = {
  description:
    "The collector fleet: operator-run machines that fetch from the CR API, each named for a Clash Royale card. More collectors mean resilience, never more CR budget; what operators earn is quota (10 points = +1 daily tool call, a point being a fetch that added to the record; capped at 4x base) and bonus recording slots.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  async handler(ctx) {
    await ensureGatewayCards(ctx.db).catch(() => {});
    const { rows } = await ctx.db.query(
      `select status, fetch_points, card_name, card_icon, last_success_at,
                last_heartbeat_at, enrolled_at
         from gateway where status <> 'revoked'
         order by fetch_points desc, enrolled_at`,
    );
    // No machine label here (#28): the operator-chosen name is private.
    // status is what the collector is DOING: an active one that has
    // not checked in for an hour reads silent (2026-09-19: Hog Rider
    // was forty hours quiet under "active"); lifecycle keeps the
    // enrolment state the door acts on.
    const nowMs = Date.now();
    const collectors = rows.map((g) => {
      const silent = silentSince(g, nowMs);
      return {
        name: g.card_name ?? "Collector",
        card: g.card_name,
        status: silent ? "silent" : g.status,
        lifecycle: g.status,
        points: Number(g.fetch_points),
        quota_credits: Math.floor(Number(g.fetch_points) / 10),
        last_seen: g.last_heartbeat_at?.toISOString() ?? null,
        last_success: g.last_success_at?.toISOString() ?? null,
        ...(silent ? { silent_since: silent.toISOString() } : {}),
      };
    });
    const silentCount = collectors.filter((c) => c.status === "silent").length;
    return {
      collectors,
      notes: notes(
        "Running one earns real quota (every 10 points adds +1 daily tool call, capped at 4x base; a point is a fetch that added something to the record, so a fetch that returned nothing new earns none) plus bonus recording slots; a machine with a static IP is all it takes.",
        "status is what the collector is doing now: active (checked in within the hour), silent (enrolled to run but not checked in for over an hour), probation, pending or draining (stopped on purpose); lifecycle is the enrolment state.",
        silentCount > 0
          ? `${silentCount} collector${silentCount === 1 ? " is" : "s are"} silent; the fleet's budget is one whatever the count, so silence costs redundancy, not throughput.`
          : null,
      ),
      docs: docsRef("operators"),
      meta: responseMeta({ as_of: new Date().toISOString() }),
    };
  },
};
