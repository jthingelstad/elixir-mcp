/**
 * Scheduler tick: plan -> enqueue into the job ledger, ONE transaction
 * (0040). There is no send step to partially fail - the sol-6 F5 class
 * (planned-but-unsent reconciliation) is structurally gone. After
 * commit, ledger health goes to CloudWatch for the alarms.
 */

import pg from "pg";
import { planTick } from "./plan.mjs";
import { enqueueJob, settleLeases, ledgerStats } from "./ledger.mjs";

export function makeHandler({ databaseUrl, putMetrics = async () => {} }) {
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
      await putMetrics(stats).catch(() => {});
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
