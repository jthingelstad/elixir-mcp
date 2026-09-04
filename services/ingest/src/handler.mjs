/**
 * Lambda handler shape for the results queue (SQS partial-batch response).
 *
 * Outcomes and retry semantics:
 *  - admitted / rejected / duplicate / fetch_error: processed, deleted.
 *  - bad_message: reported as a batch item failure -> SQS redrives ->
 *    DLQ after maxReceiveCount (a malformed message never heals).
 *  - thrown errors (DB down, etc.): batch item failure -> retry is correct.
 */

import pg from "pg";
import { processResult } from "./pipeline.mjs";

export function makeHandler({ databaseUrl }) {
  return async function handler(event) {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    const batchItemFailures = [];
    try {
      for (const record of event.Records ?? []) {
        let outcome;
        try {
          const message = JSON.parse(record.body);
          outcome = await processResult(client, message);
          // One structured line per message: Logs Insights reads these
          // for live-path performance (the census, permanently on).
          if (outcome.timings) {
            console.log(
              JSON.stringify({
                perf: message?.job?.endpoint,
                ...outcome.timings,
                ...(outcome.projection?.phase_race_ms !== undefined
                  ? {
                      race_ms: outcome.projection.phase_race_ms,
                      stamp_ms: outcome.projection.phase_stamp_ms,
                    }
                  : {}),
              }),
            );
          }
        } catch {
          batchItemFailures.push({ itemIdentifier: record.messageId });
          continue;
        }
        if (outcome.outcome === "bad_message") {
          batchItemFailures.push({ itemIdentifier: record.messageId });
        }
      }
    } finally {
      await client.end();
    }
    return { batchItemFailures };
  };
}
