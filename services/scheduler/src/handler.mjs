/**
 * Scheduler tick: plan -> enqueue into the job ledger, ONE transaction
 * (0040). There is no send step to partially fail - the sol-6 F5 class
 * (planned-but-unsent reconciliation) is structurally gone. After
 * commit, ledger health is emitted for the alarms.
 */

import pg from "pg";
import { planTick, chargeBudget } from "./plan.mjs";
import { enqueueJob, settleLeases, ledgerStats } from "./ledger.mjs";

/**
 * One tick's work inside the caller's transaction: plan, enqueue, and
 * charge the bucket for the rows the enqueue really INSERTED. A planned
 * subject that already had a queued job (a live row, or a bulk row a
 * dark fleet never leased) upgrades or folds into it and costs nothing:
 * charging every plan spent tokens on work that was never added (review
 * 2026-09-27 §4.1). The charge settles the bucket in the same statement,
 * last, so the budget row is locked only for the commit.
 */
export async function tickOnce(client, now) {
  const result = await planTick(client, now);
  let inserted = 0;
  for (const job of result.jobs) {
    const row = await enqueueJob(client, job);
    if (row?.inserted) inserted += 1;
  }
  const tokensAfter = await chargeBudget(client, now, inserted);
  return { ...result, inserted, tokensAfter };
}

export function makeHandler({ databaseUrl, emitMetrics = () => {} }) {
  return async function handler() {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query("begin");
      const result = await tickOnce(client, new Date());
      await client.query("commit");
      // Settle expired leases. This tick is the only settler: the door
      // stopped settling on lease on 2026-09-11 (83f0a6c5), so an
      // abandoned lease waits at most one tick past its 90 s TTL.
      const settled = await settleLeases(client);
      const stats = await ledgerStats(client);
      // Metric emission is best-effort and MUST NOT hold the tick open
      // (issue #1): never await it. The default sink is synchronous EMF, but
      // we also defend structurally so a future network-bound sink cannot
      // reintroduce the 50s hang.
      try {
        const pending = emitMetrics(stats, {
          planned: result.jobs.length,
          charged: result.inserted,
          followup: result.followup,
          read_capped: result.readCapped,
          requested: result.requested,
          retried: result.retried,
          not_found_held: result.notFoundHeld,
        });
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
