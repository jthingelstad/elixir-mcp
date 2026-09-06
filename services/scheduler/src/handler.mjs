/**
 * EventBridge-scheduled Lambda shape (reserved concurrency 1 — the "one
 * planner" guarantee). sendJobs is injected: SQS SendMessageBatch to the
 * bulk request queue in production, a fake in tests.
 */

import pg from "pg";
import { planTick } from "./plan.mjs";

export function makeHandler({ databaseUrl, sendJobs }) {
  return async function handler() {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const result = await planTick(client, new Date());
      let sendFailed = [];
      if (result.jobs.length > 0)
        sendFailed = (await sendJobs(result.jobs)) ?? [];
      // A planned-but-unsent subject would otherwise wait a full
      // cadence for its next chance: clear the plan stamp so the next
      // tick retries it (sol-6 F5).
      for (const job of sendFailed) {
        await client.query(
          `update poll_state set last_planned_at = null
           where subject_tag = $1 and endpoint = $2`,
          [job.entity_key, job.endpoint],
        );
      }
      return { planned: result.jobs.length, send_failed: sendFailed.length };
    } finally {
      await client.end();
    }
  };
}
