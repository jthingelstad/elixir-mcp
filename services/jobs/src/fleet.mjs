/**
 * The fleet's silence (2026-09-19). Collectors long-poll the door, so an
 * active one's heartbeat is never more than about a minute old; one
 * that has not checked in for an hour is not fetching, whatever its
 * lifecycle status says. Quarantine (ten expired leases) told the owner;
 * silence did not, because a silent collector never reaches the door
 * that would notice. The hourly sweep notices instead, tells the owner
 * once per silence, and a heartbeat after the notice makes the next
 * silence news again.
 *
 * `draining` and `revoked` are intentional stops and never silent.
 */
import pg from "pg";
import { silentSince } from "../../ingest/src/fleet.mjs";

/** Tell the owner about every collector that went silent since it was
 *  last told; stamp the row so it is said once. Returns what was said. */
export async function sweepSilentCollectors(
  databaseUrl,
  { enqueue, nowMs = Date.now(), ownerEmail } = {},
) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const { rows } = await db.query(
      `select gateway_id, name, card_name, status, enrolled_at,
              last_heartbeat_at, last_success_at, silent_notified_at
       from gateway
       where status in ('active', 'probation')
       order by enrolled_at`,
    );
    const said = [];
    for (const g of rows) {
      const since = silentSince(g, nowMs);
      if (!since) continue;
      // Already said for THIS silence: the notice is newer than the last
      // heartbeat, so nothing has happened since.
      if (
        g.silent_notified_at &&
        new Date(g.silent_notified_at).getTime() >= since.getTime()
      )
        continue;
      const hours = Math.floor((nowMs - since.getTime()) / 3600_000);
      const label = g.card_name ?? g.name;
      if (enqueue)
        await enqueue({
          v: 1,
          kind: "owner_notify",
          to:
            ownerEmail ??
            process.env.OWNER_NOTIFY_EMAIL ??
            "elixir@poapkings.com",
          notify_kind: "gateway_silent",
          note: `Collector "${label}" has not checked in since ${since.toISOString()} (${hours} h). Its lifecycle status is still ${g.status}; drain it in Admin if the stop is intended.`,
          detail: {
            collector: label,
            status: g.status,
            last_heartbeat_at: g.last_heartbeat_at
              ? new Date(g.last_heartbeat_at).toISOString()
              : null,
            last_success_at: g.last_success_at
              ? new Date(g.last_success_at).toISOString()
              : null,
          },
          link: "https://elixir.poapkings.com/admin",
        });
      await db.query(
        `update gateway set silent_notified_at = $2 where gateway_id = $1`,
        [g.gateway_id, new Date(nowMs).toISOString()],
      );
      said.push({ collector: label, since: since.toISOString(), hours });
    }
    return { silent: said };
  } finally {
    await db.end();
  }
}
