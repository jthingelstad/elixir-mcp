import { responseMeta } from "@elixir-mcp/contracts";
import { silentSince } from "@elixir-mcp/ingest/fleet";
import { ensureGatewayCards } from "@elixir-mcp/record/gateway-cards";
import { docsRef, notes } from "../shared.mjs";

export const elixir_collectors = {
  description:
    "The collector fleet: operator-run machines that fetch from the CR API, each named for a Clash Royale card. More collectors mean resilience, never more CR budget. Running an active collector earns its operator the Family tier, and nothing else; points and quota_credits are retired and always 0.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  async handler(ctx) {
    await ensureGatewayCards(ctx.db).catch(() => {});
    const { rows } = await ctx.db.query(
      `select status, card_name, card_icon, last_success_at,
                last_heartbeat_at, enrolled_at
         from gateway where status <> 'revoked'
         order by enrolled_at`,
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
        // Retired with the points economy (#539) and kept, constant, so
        // a reader of the 11.x shape still parses; dropping them is a
        // major, which is Jamie's call.
        points: 0,
        quota_credits: 0,
        last_seen: g.last_heartbeat_at?.toISOString() ?? null,
        last_success: g.last_success_at?.toISOString() ?? null,
        ...(silent ? { silent_since: silent.toISOString() } : {}),
      };
    });
    const silentCount = collectors.filter((c) => c.status === "silent").length;
    return {
      collectors,
      notes: notes(
        "Running a collector earns the Family tier while it is active; there are no points, credits or bonus slots. A machine with a static IP is all it takes.",
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
