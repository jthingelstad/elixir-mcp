/**
 * Scheduler tick: plan -> enqueue into the job ledger, ONE transaction
 * (0040). There is no send step to partially fail - the sol-6 F5 class
 * (planned-but-unsent reconciliation) is structurally gone. After
 * commit, ledger health is emitted for the alarms.
 */

import pg from "pg";
import { planTick } from "./plan.mjs";
import { enqueueJob, settleLeases, ledgerStats } from "./ledger.mjs";

export function makeHandler({ databaseUrl, emitMetrics = () => {} }) {
  return async function handler() {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query("begin");
      const result = await planTick(client, new Date());
      for (const job of result.jobs) {
        await enqueueJob(client, job);
      }
      await client.query("commit");
      // Backstop settle (the door settles too; this covers idle fleets).
      const settled = await settleLeases(client);
      const stats = await ledgerStats(client);
      // Metric emission is best-effort and MUST NOT hold the tick open
      // (issue #1): never await it. The default sink is synchronous EMF, but
      // we also defend structurally so a future network-bound sink cannot
      // reintroduce the 50s hang.
      try {
        const pending = emitMetrics(stats);
        if (pending && typeof pending.then === "function")
          pending.catch(() => {});
      } catch {
        // metrics are advisory; a failure never fails a committed tick
      }
      return {
        planned: result.jobs.length,
        settled,
        ledger: stats,
      };
    } catch (err) {
      await client.query("rollback").catch(() => {});
      throw err;
    } finally {
      await client.end();
    }
  };
}
