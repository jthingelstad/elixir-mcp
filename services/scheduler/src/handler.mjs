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
      if (result.jobs.length > 0) await sendJobs(result.jobs);
      return { planned: result.jobs.length };
    } finally {
      await client.end();
    }
  };
}
